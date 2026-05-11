import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { supabase } from '../lib/supabase'
import { BASE_URL } from '../lib/api'

type WsStatus = 'connecting' | 'connected' | 'disconnected'

const XTERM_THEME = {
  background: '#0a0f1e',
  foreground: '#e2e8f0',
  cursor: '#0ea5e9',
  cursorAccent: '#0a0f1e',
  selectionBackground: 'rgba(14,165,233,0.2)',
  black: '#0a0f1e',
  brightBlack: '#1e3a5f',
  red: '#f87171',
  brightRed: '#ef4444',
  green: '#4ade80',
  brightGreen: '#22c55e',
  yellow: '#fbbf24',
  brightYellow: '#f59e0b',
  blue: '#0ea5e9',
  brightBlue: '#38bdf8',
  magenta: '#a78bfa',
  brightMagenta: '#8b5cf6',
  cyan: '#22d3ee',
  brightCyan: '#06b6d4',
  white: '#e2e8f0',
  brightWhite: '#f8fafc',
}

interface TerminalProps {
  className?: string
  isActive?: boolean
}

interface PollResponse {
  alive: boolean
  nextSeq: number
  events: Array<{ seq: number; data: string }>
}

export function Terminal({ className = '', isActive = true }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const tokenRef = useRef<string>('')
  const reconnectTimerRef = useRef<number>()
  const countdownTimerRef = useRef<number>()
  const pollAbortRef = useRef<AbortController | null>(null)
  const rafRef = useRef<number>()
  const inputTimerRef = useRef<number>()
  const inputBufferRef = useRef('')
  const isUnmountedRef = useRef(false)
  const connectRef = useRef<(() => Promise<void>) | null>(null)
  const sinceSeqRef = useRef(0)

  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [reconnectIn, setReconnectIn] = useState(0)

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
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

  const sendResize = useCallback(async () => {
    const term = xtermRef.current
    const sessionId = sessionIdRef.current
    if (!term || !sessionId) return
    const { cols, rows } = term
    if (cols < 1 || rows < 1) return
    try {
      await authedFetch('/api/terminal/resize', {
        method: 'POST',
        body: JSON.stringify({ sessionId, cols, rows }),
      })
    } catch {}
  }, [authedFetch])

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

  const flushInput = useCallback(async () => {
    inputTimerRef.current = undefined
    const payload = inputBufferRef.current
    const sessionId = sessionIdRef.current
    if (!payload || !sessionId) return
    inputBufferRef.current = ''
    try {
      await authedFetch('/api/terminal/input', {
        method: 'POST',
        body: JSON.stringify({ sessionId, data: payload }),
      })
    } catch {}
  }, [authedFetch])

  const queueInput = useCallback((data: string) => {
    inputBufferRef.current += data
    if (data.includes('\r')) {
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current)
        inputTimerRef.current = undefined
      }
      void flushInput()
      return
    }
    if (!inputTimerRef.current) {
      inputTimerRef.current = window.setTimeout(() => {
        void flushInput()
      }, 8)
    }
  }, [flushInput])

  const stopSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    stopPolling()
    sessionIdRef.current = null
    sinceSeqRef.current = 0
    try {
      await authedFetch('/api/terminal/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
    } catch {}
  }, [authedFetch, stopPolling])

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

  const runPollLoop = useCallback(async (sessionId: string) => {
    if (isUnmountedRef.current) return
    stopPolling()
    const controller = new AbortController()
    pollAbortRef.current = controller

    while (!isUnmountedRef.current && sessionIdRef.current === sessionId) {
      try {
        const resp = await authedFetch(
          `/api/terminal/poll?sessionId=${encodeURIComponent(sessionId)}&since=${sinceSeqRef.current}&waitMs=25000`,
          { method: 'GET', signal: controller.signal },
        )
        if (!resp.ok) throw new Error(`poll failed: ${resp.status}`)
        const body = await resp.json() as PollResponse

        for (const evt of body.events) {
          xtermRef.current?.write(evt.data)
        }
        sinceSeqRef.current = body.nextSeq

        if (!body.alive) {
          throw new Error('terminal session ended')
        }
      } catch {
        if (controller.signal.aborted || isUnmountedRef.current || sessionIdRef.current !== sessionId) return
        setWsStatus('disconnected')
        await stopSession()
        startReconnectCountdown()
        return
      }
    }
  }, [authedFetch, startReconnectCountdown, stopPolling, stopSession])

  const connect = useCallback(async () => {
    if (isUnmountedRef.current) return
    setWsStatus('connecting')
    clearTimeout(reconnectTimerRef.current)
    clearInterval(countdownTimerRef.current)
    stopPolling()

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token || isUnmountedRef.current) return
    tokenRef.current = session.access_token

    try {
      const startResp = await authedFetch('/api/terminal/start', { method: 'POST' })
      if (!startResp.ok) throw new Error(`start failed: ${startResp.status}`)
      const startBody = await startResp.json() as { sessionId: string }
      sessionIdRef.current = startBody.sessionId
      sinceSeqRef.current = 0
      setWsStatus('connected')
      safeFit()
      void runPollLoop(startBody.sessionId)
    } catch {
      if (isUnmountedRef.current) return
      setWsStatus('disconnected')
      startReconnectCountdown()
    }
  }, [authedFetch, runPollLoop, safeFit, startReconnectCountdown, stopPolling])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Re-fit when this tab becomes visible after being hidden.
  useEffect(() => {
    if (isActive) {
      const id = window.requestAnimationFrame(() => safeFit())
      return () => cancelAnimationFrame(id)
    }
  }, [isActive, safeFit])

  useEffect(() => {
    if (!containerRef.current) return
    isUnmountedRef.current = false

    const term = new XTerm({
      theme: XTERM_THEME,
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

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    rafRef.current = window.requestAnimationFrame(() => {
      safeFit()
    })

    const dataDisposable = term.onData((data) => {
      queueInput(data)
    })

    void connect()

    const resizeObserver = new ResizeObserver(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = window.requestAnimationFrame(() => {
        safeFit()
      })
    })
    resizeObserver.observe(containerRef.current)

    let resizeDebounce: number
    const handleResize = () => {
      clearTimeout(resizeDebounce)
      resizeDebounce = window.setTimeout(() => {
        safeFit()
      }, 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      isUnmountedRef.current = true
      resizeObserver.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
      stopPolling()
      clearTimeout(reconnectTimerRef.current)
      clearInterval(countdownTimerRef.current)
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeDebounce)
      dataDisposable.dispose()
      void stopSession()
      term.dispose()
    }
  }, [connect, queueInput, safeFit, stopPolling, stopSession])

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
