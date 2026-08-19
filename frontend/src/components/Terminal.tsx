import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { supabase } from '../lib/supabase'
import { BASE_URL, WS_URL } from '../lib/api'

type WsStatus = 'connecting' | 'connected' | 'disconnected'
type Transport = 'ws' | 'http'

const WS_CONNECT_TIMEOUT_MS = 4000
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
}

export function Terminal({ className = '', isActive = true }: TerminalProps) {
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
    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    })
  }, [])

  const terminalFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {})
    headers.set('Content-Type', 'application/json')
    if (sessionCapabilityRef.current) {
      headers.set('X-Terminal-Capability', sessionCapabilityRef.current)
    } else if (tokenRef.current) {
      // Compatibility with older backend/frontend bundles during rollout.
      headers.set('Authorization', `Bearer ${tokenRef.current}`)
    }
    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    })
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

    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await terminalFetch('/api/terminal/resize', {
        method: 'POST',
        body: JSON.stringify({ sessionId, cols, rows }),
      })
    } catch {}
  }, [terminalFetch])

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
    inputInFlightRef.current = true
    try {
      await terminalFetch('/api/terminal/input', {
        method: 'POST',
        body: JSON.stringify({ sessionId, data: payload }),
      })
    } catch {}
    inputInFlightRef.current = false
    if (inputBufferRef.current) void flushInput()
  }, [terminalFetch])

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
      return
    }
    inputBufferRef.current += data
    void flushInput()
  }, [flushInput])

  const stopHttpSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    stopPolling()
    sessionIdRef.current = null
    sinceSeqRef.current = 0
    try {
      await terminalFetch('/api/terminal/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
    } catch {}
    sessionCapabilityRef.current = ''
  }, [terminalFetch, stopPolling])

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

  // Primary transport: WebSocket. Resolves true once the socket is open,
  // false if it fails to open within the timeout (caller falls back to HTTP).
  const tryWebSocket = useCallback((token: string) => {
    return new Promise<boolean>((resolve) => {
      const attemptId = ++wsAttemptRef.current
      const startedAt = performance.now()
      let settled = false
      let firstMessageAt: number | null = null
      let ws: WebSocket
      try {
        ws = new WebSocket(`${WS_URL}/terminal?token=${encodeURIComponent(token)}`)
      } catch {
        console.warn('[Terminal] WS construct failed', { attemptId })
        resolve(false)
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
          elapsedMs: Math.round(performance.now() - startedAt),
        })
        resolve(false)
      }, WS_CONNECT_TIMEOUT_MS)

      ws.onopen = () => {
        if (settled || attemptId !== wsAttemptRef.current) {
          try { ws.close(1000, 'stale') } catch {}
          return
        }
        settled = true
        clearTimeout(failTimer)
        if (isUnmountedRef.current) {
          ws.close()
          resolve(false)
          return
        }
        wsRef.current = ws
        transportRef.current = 'ws'
        setWsStatus('connected')
        console.info('[Terminal] WS open', {
          attemptId,
          elapsedMs: Math.round(performance.now() - startedAt),
        })
        safeFit()
        resolve(true)
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
          resolve(false)
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
  }, [authedFetch, runOutputStream, safeFit, startReconnectCountdown])

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

      const wsConnected = await tryWebSocket(session.access_token)
      if (wsConnected || isUnmountedRef.current) return
      await startHttpSession()
    } finally {
      connectingRef.current = false
    }
  }, [disconnectWs, startHttpSession, stopHttpSession, stopPolling, tryWebSocket])

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
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      fontSize: 14,
      lineHeight: 1.5,
      cursorBlink: true,
      scrollback: 5000,
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
      <div ref={containerRef} className="absolute inset-0 p-2" />

      {wsStatus === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-navy-950/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-electric border-t-transparent animate-spin" />
            <span className="text-sm text-slate-400 font-mono">Connecting to VPS...</span>
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
