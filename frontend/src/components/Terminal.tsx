import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { supabase } from '../lib/supabase'
import { WS_URL } from '../lib/api'

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

export function Terminal({ className = '', isActive = true }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const isUnmountedRef = useRef(false)
  const reconnectTimerRef = useRef<number>()
  const countdownTimerRef = useRef<number>()
  const rafRef = useRef<number>()
  const connectRef = useRef<(() => Promise<void>) | null>(null)

  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [reconnectIn, setReconnectIn] = useState(0)

  const sendResize = useCallback(() => {
    const ws = wsRef.current
    const term = xtermRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return
    const { cols, rows } = term
    if (cols < 1 || rows < 1) return
    ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }, [])

  const safeFit = useCallback(() => {
    const container = containerRef.current
    const term = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!container || !term || !fitAddon) return
    const { width, height } = container.getBoundingClientRect()
    if (width < 2 || height < 2) return
    try {
      fitAddon.fit()
      sendResize()
    } catch {}
  }, [sendResize])

  const disconnect = useCallback(() => {
    const ws = wsRef.current
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
    wsRef.current = null
  }, [])

  const startReconnectCountdown = useCallback(() => {
    if (isUnmountedRef.current) return
    clearTimeout(reconnectTimerRef.current)
    clearInterval(countdownTimerRef.current)
    setReconnectIn(3)
    let remaining = 3
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1
      setReconnectIn(remaining)
      if (remaining <= 0) clearInterval(countdownTimerRef.current)
    }, 1000)
    reconnectTimerRef.current = window.setTimeout(() => {
      void connectRef.current?.()
    }, 3000)
  }, [])

  const connect = useCallback(async () => {
    if (isUnmountedRef.current) return
    setWsStatus('connecting')
    clearTimeout(reconnectTimerRef.current)
    clearInterval(countdownTimerRef.current)
    disconnect()

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token || isUnmountedRef.current) return

    const ws = new WebSocket(
      `${WS_URL}/terminal?token=${encodeURIComponent(session.access_token)}`,
    )
    wsRef.current = ws

    ws.onopen = () => {
      if (isUnmountedRef.current) { ws.close(); return }
      setWsStatus('connected')
      safeFit()
    }

    ws.onmessage = (event) => {
      xtermRef.current?.write(event.data as string)
    }

    ws.onclose = () => {
      if (isUnmountedRef.current) return
      wsRef.current = null
      setWsStatus('disconnected')
      startReconnectCountdown()
    }

    ws.onerror = () => {
      // onclose fires immediately after onerror — handled there
    }
  }, [disconnect, safeFit, startReconnectCountdown])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Re-fit when this tab becomes active after being hidden.
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

    // WebGL renderer — falls back to canvas silently if unavailable.
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {}

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    rafRef.current = window.requestAnimationFrame(() => safeFit())

    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    void connect()

    const resizeObserver = new ResizeObserver(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = window.requestAnimationFrame(() => safeFit())
    })
    resizeObserver.observe(containerRef.current)

    let resizeDebounce: number
    const handleResize = () => {
      clearTimeout(resizeDebounce)
      resizeDebounce = window.setTimeout(() => safeFit(), 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      isUnmountedRef.current = true
      resizeObserver.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearTimeout(reconnectTimerRef.current)
      clearInterval(countdownTimerRef.current)
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeDebounce)
      dataDisposable.dispose()
      disconnect()
      term.dispose()
    }
  }, [connect, disconnect, safeFit])

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
