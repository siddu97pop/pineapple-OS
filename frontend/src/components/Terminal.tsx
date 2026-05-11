import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
}

export function Terminal({ className = '' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number>()
  const countdownTimerRef = useRef<number>()

  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [reconnectIn, setReconnectIn] = useState(0)

  const connect = useCallback(async () => {
    setWsStatus('connecting')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    const ws = new WebSocket(`${WS_URL}/terminal?token=${session.access_token}`)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('connected')
      // Send initial size
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = xtermRef.current
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'output' && xtermRef.current) {
          xtermRef.current.write(msg.data)
        }
      } catch {}
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      startReconnectCountdown()
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  const startReconnectCountdown = useCallback(() => {
    clearTimeout(reconnectTimerRef.current)
    clearInterval(countdownTimerRef.current)
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
      connect()
    }, 3000)
  }, [connect])

  // Init xterm on mount
  useEffect(() => {
    if (!containerRef.current) return

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
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    connect()

    let resizeDebounce: number
    const handleResize = () => {
      clearTimeout(resizeDebounce)
      resizeDebounce = window.setTimeout(() => {
        fitAddon.fit()
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const { cols, rows } = term
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      }, 100)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeDebounce)
      clearTimeout(reconnectTimerRef.current)
      clearInterval(countdownTimerRef.current)
      wsRef.current?.close()
      term.dispose()
    }
  }, [connect])

  // Reconnect with new token on Supabase token refresh
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') {
        wsRef.current?.close()
        connect()
      }
    })
    return () => subscription.unsubscribe()
  }, [connect])

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
                connect()
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
