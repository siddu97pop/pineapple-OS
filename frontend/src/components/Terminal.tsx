import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { supabase } from '../lib/supabase'
import { BASE_URL, MAC_BASE_URL, MAC_DIRECT_WS_URL, MAC_WS_URL, VPS_BASE_URL, VPS_WS_URL, WS_URL } from '../lib/api'

type WsStatus = 'connecting' | 'connected' | 'disconnected'
type Transport = 'ws' | 'http'
type WsResult = 'open' | 'timeout' | 'closed'

const WS_CONNECT_TIMEOUT_MS = 4000
// Short, because off the tailnet the direct Mac URL never answers.
const DIRECT_WS_CONNECT_TIMEOUT_MS = 1500
// A WebSocket that closes before opening (seen through the Cloudflare tunnel)
// is retried this many times before falling back to the slower HTTP stream.
const WS_EARLY_CLOSE_ATTEMPTS = 3
const FONT_FAMILY = 'JetBrains Mono, Fira Code, monospace'
const MAX_PENDING_OUTPUT_CHARS = 1_000_000

// xterm renders to canvas and parses colours itself, so it cannot use CSS
// variables directly. Resolve the active theme's tokens at construction time
// into legacy rgb()/rgba() strings that xterm's colour parser understands.
function triplet(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (v) return v.replace(/\s+/g, ',') // "124 108 255" -> "124,108,255"
  } catch {}
  return fallback
}

function buildXtermTheme() {
  const base = triplet('--c-base', '10,15,30')
  const accent = triplet('--c-accent', '14,165,233')
  const border = triplet('--c-border', '30,58,95')
  const bright = triplet('--c-accent-bright', '56,189,248')
  return {
    background: `rgb(${base})`,
    foreground: '#e2e8f0',
    cursor: `rgb(${accent})`,
    cursorAccent: `rgb(${base})`,
    selectionBackground: `rgba(${accent},0.25)`,
    black: `rgb(${base})`,
    brightBlack: `rgb(${border})`,
    red: '#f87171',
    brightRed: '#ef4444',
    green: '#4ade80',
    brightGreen: '#22c55e',
    yellow: '#fbbf24',
    brightYellow: '#f59e0b',
    blue: `rgb(${accent})`,
    brightBlue: `rgb(${bright})`,
    magenta: '#a78bfa',
    brightMagenta: '#8b5cf6',
    cyan: '#22d3ee',
    brightCyan: '#06b6d4',
    white: '#e2e8f0',
    brightWhite: '#f8fafc',
  }
}

interface TerminalProps {
  className?: string
  isActive?: boolean
  // Which machine's backend this terminal connects to.
  host?: 'vps' | 'mac'
}

export function Terminal({ className = '', isActive = true, host = 'mac' }: TerminalProps) {
  const apiBase = host === 'vps' && VPS_BASE_URL ? VPS_BASE_URL
    : host === 'mac' && MAC_BASE_URL ? MAC_BASE_URL : BASE_URL
  const wsBase = host === 'vps' && VPS_WS_URL ? VPS_WS_URL
    : host === 'mac' && MAC_WS_URL ? MAC_WS_URL : WS_URL
  const directWsBase = host === 'mac' ? MAC_DIRECT_WS_URL : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const transportRef = useRef<Transport>('ws')
  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const tokenRef = useRef<string>('')
  const reconnectTimerRef = useRef<number>()
  const countdownTimerRef = useRef<number>()
  const pollAbortRef = useRef<AbortController | null>(null)
  const inputStreamAbortRef = useRef<AbortController | null>(null)
  const inputStreamControllerRef = useRef<ReadableStreamDefaultController<Uint8Array> | null>(null)
  const inputStreamFailedRef = useRef(false)
  const inputFlushTimerRef = useRef<number>()
  const inputEncoderRef = useRef(new TextEncoder())
  const rafRef = useRef<number>()
  const inputBufferRef = useRef('')
  const inputInFlightRef = useRef(false)
  const sessionCapabilityRef = useRef('')
  const wsAttemptRef = useRef(0)
  const isActiveRef = useRef(isActive)
  const pendingOutputRef = useRef<string[]>([])
  const pendingOutputCharsRef = useRef(0)
  const isUnmountedRef = useRef(false)
  const connectRef = useRef<(() => Promise<void>) | null>(null)
  const connectingRef = useRef(false)
  const sinceSeqRef = useRef(0)
  const safeFitRef = useRef<() => void>(() => {})
  const sendInputRef = useRef<(data: string) => void>(() => {})
  const stopPollingRef = useRef<() => void>(() => {})
  const stopHttpSessionRef = useRef<() => Promise<void>>(async () => {})
  const disconnectWsRef = useRef<() => void>(() => {})

  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [reconnectIn, setReconnectIn] = useState(0)

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [])

  const disconnectWs = useCallback(() => {
    wsAttemptRef.current += 1
    const ws = wsRef.current
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close(1000, 'client')
    wsRef.current = null
  }, [])

  const authedFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!tokenRef.current) throw new Error('Missing auth token')
    const headers = new Headers(options.headers || {})
    headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${tokenRef.current}`)
    return fetch(`${apiBase}${path}`, {
      ...options,
      headers,
    })
  }, [apiBase])

  const terminalFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {})
    if (!headers.has('Content-Type') && options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }
    if (sessionCapabilityRef.current) {
      headers.set('X-Terminal-Capability', sessionCapabilityRef.current)
    } else if (tokenRef.current) {
      // Compatibility with older backend/frontend bundles during rollout.
      headers.set('Authorization', `Bearer ${tokenRef.current}`)
    }
    return fetch(`${apiBase}${path}`, {
      ...options,
      headers,
    })
  }, [apiBase])

  const enqueueInputMessage = useCallback((message: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }) => {
    const controller = inputStreamControllerRef.current
    if (!controller || inputStreamFailedRef.current) return false
    try {
      controller.enqueue(inputEncoderRef.current.encode(`${JSON.stringify(message)}\n`))
      return true
    } catch {
      inputStreamControllerRef.current = null
      inputStreamFailedRef.current = true
      return false
    }
  }, [])

  const stopInputStream = useCallback(() => {
    clearTimeout(inputFlushTimerRef.current)
    inputFlushTimerRef.current = undefined
    const controller = inputStreamControllerRef.current
    inputStreamControllerRef.current = null
    inputStreamFailedRef.current = false
    try { controller?.close() } catch {}
    inputStreamAbortRef.current?.abort()
    inputStreamAbortRef.current = null
  }, [])

  const writeOutput = useCallback((data: string) => {
    if (!isActiveRef.current) {
      pendingOutputRef.current.push(data)
      pendingOutputCharsRef.current += data.length
      while (pendingOutputCharsRef.current > MAX_PENDING_OUTPUT_CHARS && pendingOutputRef.current.length > 0) {
        const removed = pendingOutputRef.current.shift() || ''
        pendingOutputCharsRef.current -= removed.length
      }
      return
    }
    xtermRef.current?.write(data)
  }, [])

  const sendResize = useCallback(async () => {
    const term = xtermRef.current
    if (!term) return
    const { cols, rows } = term
    if (cols < 1 || rows < 1) return

    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      return
    }

    if (transportRef.current === 'http' && enqueueInputMessage({ type: 'resize', cols, rows })) {
      return
    }

    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await terminalFetch('/api/terminal/resize', {
        method: 'POST',
        body: JSON.stringify({ sessionId, cols, rows }),
      })
    } catch {}
  }, [enqueueInputMessage, terminalFetch])

  const safeFit = useCallback(() => {
    const container = containerRef.current
    const term = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!container || !term || !fitAddon) return
    const { width, height } = container.getBoundingClientRect()
    if (width < 2 || height < 2) return
    try {
      fitAddon.fit()
      void sendResize()
    } catch {}
  }, [sendResize])

  // HTTP fallback input: serialize POSTs so fast keystrokes can't be
  // delivered out of order by overlapping requests.
  const flushInput = useCallback(async () => {
    if (inputInFlightRef.current) return
    const sessionId = sessionIdRef.current
    if (!sessionId || !inputBufferRef.current) return
    const payload = inputBufferRef.current
    inputBufferRef.current = ''

    if (transportRef.current === 'http' && enqueueInputMessage({ type: 'input', data: payload })) {
      return
    }

    inputInFlightRef.current = true
    try {
      await terminalFetch('/api/terminal/input', {
        method: 'POST',
        body: JSON.stringify({ sessionId, data: payload }),
      })
    } catch {}
    inputInFlightRef.current = false
    if (inputBufferRef.current) void flushInput()
  }, [enqueueInputMessage, terminalFetch])

  const scheduleInputFlush = useCallback(() => {
    if (inputFlushTimerRef.current !== undefined) return
    inputFlushTimerRef.current = window.setTimeout(() => {
      inputFlushTimerRef.current = undefined
      void flushInput()
    }, 8)
  }, [flushInput])

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
      return
    }

    if (transportRef.current === 'http' && enqueueInputMessage({ type: 'input', data })) {
      return
    }

    inputBufferRef.current += data
    scheduleInputFlush()
  }, [enqueueInputMessage, scheduleInputFlush])

  const stopHttpSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    stopPolling()
    stopInputStream()
    sessionIdRef.current = null
    sinceSeqRef.current = 0
    try {
      await terminalFetch('/api/terminal/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
    } catch {}
    sessionCapabilityRef.current = ''
  }, [stopInputStream, stopPolling, terminalFetch])

  const startReconnectCountdown = useCallback(() => {
    if (isUnmountedRef.current) return
    clearTimeout(reconnectTimerRef.current)
    clearInterval(countdownTimerRef.current)
    stopPolling()
    setReconnectIn(3)
    let remaining = 3
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1
      setReconnectIn(remaining)
      if (remaining <= 0) {
        clearInterval(countdownTimerRef.current)
      }
    }, 1000)
    reconnectTimerRef.current = window.setTimeout(() => {
      void connectRef.current?.()
    }, 3000)
  }, [stopPolling])

  // Primary transport: WebSocket. Resolves 'open' once the socket is open,
  // 'closed' if it closes before opening (caller retries), or 'timeout' if it
  // never opens (caller falls back to HTTP).
  const tryWebSocket = useCallback((token: string, base: string, timeoutMs: number) => {
    return new Promise<WsResult>((resolve) => {
      const attemptId = ++wsAttemptRef.current
      const startedAt = performance.now()
      let settled = false
      let firstMessageAt: number | null = null
      let ws: WebSocket
      try {
        ws = new WebSocket(`${base}/terminal?token=${encodeURIComponent(token)}`)
      } catch {
        console.warn('[Terminal] WS construct failed', { attemptId })
        resolve('timeout')
        return
      }

      const failTimer = window.setTimeout(() => {
        if (settled) return
        settled = true
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        try { ws.close(1000, 'timeout') } catch {}
        console.warn('[Terminal] WS timeout', {
          attemptId,
          base,
          elapsedMs: Math.round(performance.now() - startedAt),
        })
        resolve('timeout')
      }, timeoutMs)

      ws.onopen = () => {
        if (settled || attemptId !== wsAttemptRef.current) {
          try { ws.close(1000, 'stale') } catch {}
          return
        }
        settled = true
        clearTimeout(failTimer)
        if (isUnmountedRef.current) {
          ws.close()
          resolve('closed')
          return
        }
        wsRef.current = ws
        transportRef.current = 'ws'
        setWsStatus('connected')
        console.info('[Terminal] WS open', {
          attemptId,
          base,
          elapsedMs: Math.round(performance.now() - startedAt),
        })
        safeFit()
        resolve('open')
      }

      ws.onmessage = (event) => {
        if (firstMessageAt === null) {
          firstMessageAt = performance.now()
          console.info('[Terminal] WS first output', {
            attemptId,
            elapsedMs: Math.round(firstMessageAt - startedAt),
          })
        }
        if (typeof event.data === 'string') writeOutput(event.data)
      }

      ws.onclose = (event) => {
        console.warn('[Terminal] WS close', {
          attemptId,
          code: event.code,
          reason: event.reason,
          elapsedMs: Math.round(performance.now() - startedAt),
          opened: settled,
          firstOutputMs: firstMessageAt === null ? null : Math.round(firstMessageAt - startedAt),
        })
        if (!settled) {
          settled = true
          clearTimeout(failTimer)
          resolve('closed')
          return
        }
        if (isUnmountedRef.current || wsRef.current !== ws) return
        wsRef.current = null
        setWsStatus('disconnected')
        startReconnectCountdown()
      }

      ws.onerror = () => {
        console.warn('[Terminal] WS error', {
          attemptId,
          elapsedMs: Math.round(performance.now() - startedAt),
        })
        // onclose fires after onerror — handled there
      }
    })
  }, [safeFit, startReconnectCountdown, writeOutput])

  const runOutputStream = useCallback(async (sessionId: string) => {
    if (isUnmountedRef.current) return
    stopPolling()
    const controller = new AbortController()
    pollAbortRef.current = controller

    try {
      const resp = await terminalFetch(
        `/api/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&since=${sinceSeqRef.current}`,
        { method: 'GET', signal: controller.signal },
      )
      if (!resp.ok) throw new Error(`stream failed: ${resp.status}`)
      if (!resp.body) throw new Error('stream body unavailable')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let terminalEnded = false

      const consumeBlock = (block: string) => {
        let eventName = 'message'
        const dataLines: string[] = []
        for (const rawLine of block.split(/\r?\n/)) {
          if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim()
          else if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trimStart())
        }
        if (eventName === 'output' && dataLines.length > 0) {
          const event = JSON.parse(dataLines.join('\n')) as { seq: number; data: string }
          writeOutput(event.data)
          sinceSeqRef.current = Math.max(sinceSeqRef.current, event.seq)
        } else if (eventName === 'exit') {
          terminalEnded = true
        }
      }

      while (!controller.signal.aborted && !isUnmountedRef.current && !terminalEnded) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          if (block.trim() && !block.trimStart().startsWith(':')) consumeBlock(block)
          if (terminalEnded) break
        }
      }
      if (buffer.trim() && !buffer.trimStart().startsWith(':')) consumeBlock(buffer)
      if (!terminalEnded && !controller.signal.aborted && !isUnmountedRef.current) {
        throw new Error('terminal stream ended unexpectedly')
      }
    } catch {
      if (controller.signal.aborted || isUnmountedRef.current || sessionIdRef.current !== sessionId) return
      setWsStatus('disconnected')
      await stopHttpSession()
      startReconnectCountdown()
      return
    }

    if (!isUnmountedRef.current && sessionIdRef.current === sessionId) {
      setWsStatus('disconnected')
      await stopHttpSession()
      startReconnectCountdown()
    }
  }, [startReconnectCountdown, stopHttpSession, stopPolling, terminalFetch, writeOutput])

  // HTTP fallback input stays open for the lifetime of the PTY. Each line is a
  // small NDJSON control frame, so typing does not create one fetch/preflight
  // round trip per key. Chrome requires duplex:'half' for a streaming request.
  const startInputStream = useCallback((sessionId: string) => {
    inputStreamFailedRef.current = false
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        streamController = controller
        inputStreamControllerRef.current = controller
      },
      cancel: () => {
        if (inputStreamControllerRef.current === streamController) {
          inputStreamControllerRef.current = null
        }
      },
    })
    const abort = new AbortController()
    inputStreamAbortRef.current = abort
    const options = {
      method: 'POST',
      body,
      signal: abort.signal,
      headers: { 'Content-Type': 'application/x-ndjson' },
      duplex: 'half' as const,
    } as RequestInit

    void terminalFetch(
      `/api/terminal/input-stream?sessionId=${encodeURIComponent(sessionId)}`,
      options,
    ).then((response) => {
      if (!response.ok) throw new Error(`input stream failed: ${response.status}`)
    }).catch(() => {
      if (isUnmountedRef.current || sessionIdRef.current !== sessionId) return
      inputStreamControllerRef.current = null
      inputStreamFailedRef.current = true
      // Continue with the compatibility POST path if streaming uploads are
      // unavailable in this browser or are rejected by the proxy.
      if (inputBufferRef.current) scheduleInputFlush()
    })
  }, [scheduleInputFlush, terminalFetch])

  // Fallback transport: authenticated HTTP output stream for networks that drop WebSockets.
  const startHttpSession = useCallback(async () => {
    try {
      const startResp = await authedFetch('/api/terminal/start', { method: 'POST' })
      if (!startResp.ok) throw new Error(`start failed: ${startResp.status}`)
      const startBody = await startResp.json() as { sessionId: string; capability?: string }
      sessionIdRef.current = startBody.sessionId
      sessionCapabilityRef.current = startBody.capability || ''
      sinceSeqRef.current = 0
      transportRef.current = 'http'
      setWsStatus('connected')
      startInputStream(startBody.sessionId)
      safeFit()
      console.info('[Terminal] HTTP fallback selected', {
        sessionId: startBody.sessionId,
        capability: !!startBody.capability,
      })
      void runOutputStream(startBody.sessionId)
    } catch {
      if (isUnmountedRef.current) return
      setWsStatus('disconnected')
      startReconnectCountdown()
    }
  }, [authedFetch, runOutputStream, safeFit, startInputStream, startReconnectCountdown])

  const connect = useCallback(async () => {
    if (isUnmountedRef.current || connectingRef.current) return
    connectingRef.current = true
    try {
      setWsStatus('connecting')
      clearTimeout(reconnectTimerRef.current)
      clearInterval(countdownTimerRef.current)
      stopPolling()
      disconnectWs()
      if (sessionIdRef.current) await stopHttpSession()

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token || isUnmountedRef.current) return
      tokenRef.current = session.access_token

      if (directWsBase) {
        const direct = await tryWebSocket(session.access_token, directWsBase, DIRECT_WS_CONNECT_TIMEOUT_MS)
        if (direct === 'open' || isUnmountedRef.current) return
      }
      for (let attempt = 1; ; attempt++) {
        const result = await tryWebSocket(session.access_token, wsBase, WS_CONNECT_TIMEOUT_MS)
        if (result === 'open' || isUnmountedRef.current) return
        if (result === 'timeout' || attempt >= WS_EARLY_CLOSE_ATTEMPTS) break
        await new Promise((r) => window.setTimeout(r, 500 * attempt))
        if (isUnmountedRef.current) return
      }
      await startHttpSession()
    } finally {
      connectingRef.current = false
    }
  }, [directWsBase, disconnectWs, startHttpSession, stopHttpSession, stopPolling, tryWebSocket, wsBase])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    safeFitRef.current = safeFit
  }, [safeFit])

  useEffect(() => {
    sendInputRef.current = sendInput
  }, [sendInput])

  useEffect(() => {
    stopPollingRef.current = stopPolling
  }, [stopPolling])

  useEffect(() => {
    stopHttpSessionRef.current = stopHttpSession
  }, [stopHttpSession])

  useEffect(() => {
    disconnectWsRef.current = disconnectWs
  }, [disconnectWs])

  // Re-fit when this tab becomes visible after being hidden.
  useEffect(() => {
    if (isActive) {
      const id = window.requestAnimationFrame(() => safeFit())
      return () => cancelAnimationFrame(id)
    }
  }, [isActive, safeFit])

  useEffect(() => {
    isActiveRef.current = isActive
    if (isActive && pendingOutputRef.current.length > 0) {
      const pending = pendingOutputRef.current.join('')
      pendingOutputRef.current = []
      pendingOutputCharsRef.current = 0
      xtermRef.current?.write(pending)
    }
  }, [isActive])

  useEffect(() => {
    if (!containerRef.current) return
    isUnmountedRef.current = false

    const term = new XTerm({
      theme: buildXtermTheme(),
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.5,
      cursorBlink: true,
      scrollback: 5000,
      // When an app has mouse tracking on (Claude Code's fullscreen mode),
      // Option-drag on macOS / Shift-drag elsewhere still makes a normal
      // browser selection.
      macOptionClickForcesSelection: true,
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {}

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    rafRef.current = window.requestAnimationFrame(() => {
      safeFitRef.current()
    })

    // The web font loads with display=swap, so xterm can measure its cells
    // against the fallback font. Remeasure once it arrives, or the grid
    // overflows the container and the bottom rows (Claude's status line) are
    // clipped until the window is resized. xterm ignores a same-value option
    // set, hence the toggle.
    void document.fonts?.load('14px "JetBrains Mono"').then(() => {
      if (isUnmountedRef.current) return
      term.options.fontFamily = 'monospace'
      term.options.fontFamily = FONT_FAMILY
      safeFitRef.current()
    }).catch(() => {})

    // Claude Code's fullscreen mode does its own mouse selection and copies it
    // with OSC 52, which xterm.js ignores by default. Write-only: a remote
    // program may set the browser clipboard but never read it.
    term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(';') + 1)
      if (!b64 || b64 === '?') return true
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        void navigator.clipboard?.writeText(new TextDecoder().decode(bytes)).catch(() => {})
      } catch {}
      return true
    })

    const dataDisposable = term.onData((data) => {
      sendInputRef.current(data)
    })

    void connectRef.current?.()

    const resizeObserver = new ResizeObserver(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = window.requestAnimationFrame(() => {
        safeFitRef.current()
      })
    })
    resizeObserver.observe(containerRef.current)

    let resizeDebounce: number
    const handleResize = () => {
      clearTimeout(resizeDebounce)
      resizeDebounce = window.setTimeout(() => {
        safeFitRef.current()
      }, 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      isUnmountedRef.current = true
      resizeObserver.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stopPollingRef.current()
      clearTimeout(reconnectTimerRef.current)
      clearInterval(countdownTimerRef.current)
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeDebounce)
      dataDisposable.dispose()
      disconnectWsRef.current()
      void stopHttpSessionRef.current()
      // xterm addons (notably @xterm/addon-webgl) can throw during teardown
      // if their internal disposal callbacks run against an already-detached
      // container — catch so one tab's dispose can't take down the whole app.
      try {
        term.dispose()
      } catch (err) {
        console.error('[Terminal] dispose error:', err)
      }
    }
  }, [])

  return (
    <div className={`relative card overflow-hidden ${className}`}>
      {/* Padding lives on a wrapper: FitAddon sizes the grid from the xterm
          parent's border-box height, so padding on the parent itself made
          the bottom row overflow and get clipped. */}
      <div className="absolute inset-0 p-2">
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {wsStatus === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-navy-950/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-electric border-t-transparent animate-spin" />
            <span className="text-sm text-slate-400 font-mono">Connecting to {host === 'vps' ? 'VPS' : 'Mac'}...</span>
          </div>
        </div>
      )}

      {wsStatus === 'disconnected' && (
        <div className="absolute inset-0 flex items-center justify-center bg-navy-950/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <span className="text-2xl">⚠</span>
            <span className="text-sm text-amber-400 font-mono">
              Connection lost — reconnecting in {reconnectIn}s
            </span>
            <button
              onClick={() => {
                clearTimeout(reconnectTimerRef.current)
                clearInterval(countdownTimerRef.current)
                void connect()
              }}
              className="btn-ghost text-xs border border-navy-600"
            >
              Retry now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
