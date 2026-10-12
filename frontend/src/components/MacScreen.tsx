import { useCallback, useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { initLogging } from 'novnc-logging'
import { Clipboard, ClipboardPaste, Eye, Maximize, Plug, Unplug } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { MAC_DIRECT_WS_URL, MAC_WS_URL } from '../lib/api'

// Remote screen for the Mac Mini via macOS Screen Sharing.
// Layer 1: the backend's /mac upgrade checks the Supabase JWT + allowlist.
// Layer 2: macOS asks for the Mac username/password (ARD auth), which noVNC
// handles in the browser. Credentials are never stored.

const DIRECT_WS_CONNECT_TIMEOUT_MS = 1500

// noVNC reports why a connection failed only via console.error. Record the
// last such message so the UI can show it, then re-init noVNC's logger so it
// binds to the wrapper.
let lastNoVncError = ''
const consoleError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && /^(Failed |RFB failure)/.test(args[0])) lastNoVncError = args[0]
  consoleError(...args)
}
initLogging('warn')

type Status = 'connecting' | 'credentials' | 'connected' | 'authfailed' | 'disconnected'

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'Connecting…',
  credentials: 'Mac login required',
  connected: 'Connected',
  authfailed: 'Mac login failed',
  disconnected: 'Disconnected',
}

const STATUS_COLOR: Record<Status, string> = {
  connecting: 'var(--c-warning)',
  credentials: 'var(--c-warning)',
  connected: 'var(--c-success)',
  authfailed: 'var(--c-error)',
  disconnected: 'var(--c-faint)',
}

// Open the direct (Tailscale) socket if it opens fast enough; otherwise the
// caller hands noVNC the tunnel URL instead. Resolves null on failure.
function tryDirect(url: string): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      resolve(null)
      return
    }
    ws.binaryType = 'arraybuffer'
    const timer = window.setTimeout(() => {
      ws.onopen = ws.onerror = ws.onclose = null
      try { ws.close() } catch {}
      resolve(null)
    }, DIRECT_WS_CONNECT_TIMEOUT_MS)
    ws.onopen = () => {
      window.clearTimeout(timer)
      ws.onopen = ws.onerror = ws.onclose = null
      resolve(ws)
    }
    ws.onerror = ws.onclose = () => {
      window.clearTimeout(timer)
      ws.onopen = ws.onerror = ws.onclose = null
      resolve(null)
    }
  })
}

const btn = 'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors hover:bg-white/5 disabled:opacity-40'

export function MacScreen({ className = '' }: { className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const attemptRef = useRef(0)
  const [status, setStatus] = useState<Status>('connecting')
  const [detail, setDetail] = useState('')
  const [route, setRoute] = useState<'direct' | 'tunnel' | null>(null)
  const [viewOnly, setViewOnly] = useState(false)
  const [macClipboard, setMacClipboard] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const teardown = useCallback(() => {
    const rfb = rfbRef.current
    rfbRef.current = null
    if (rfb) {
      try { rfb.disconnect() } catch {}
    }
  }, [])

  const connect = useCallback(async () => {
    teardown()
    const attempt = ++attemptRef.current
    setStatus('connecting')
    setDetail('')
    setRoute(null)
    setMacClipboard(null)
    lastNoVncError = ''

    const { data: { session } } = await supabase.auth.getSession()
    if (attempt !== attemptRef.current) return
    if (!session?.access_token || !MAC_WS_URL) {
      setStatus('disconnected')
      setDetail(!MAC_WS_URL ? 'Mac backend is not configured.' : 'Not signed in.')
      return
    }
    const query = `/mac?token=${encodeURIComponent(session.access_token)}`

    let channel: WebSocket | string = `${MAC_WS_URL}${query}`
    let via: 'direct' | 'tunnel' = 'tunnel'
    if (MAC_DIRECT_WS_URL) {
      const direct = await tryDirect(`${MAC_DIRECT_WS_URL}${query}`)
      if (attempt !== attemptRef.current) {
        direct?.close()
        return
      }
      if (direct) {
        channel = direct
        via = 'direct'
      }
    }
    if (!screenRef.current) return

    let rfb: RFB
    try {
      rfb = new RFB(screenRef.current, channel)
    } catch (err) {
      setStatus('disconnected')
      setDetail((err as Error).message)
      return
    }
    rfbRef.current = rfb
    setRoute(via)
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.viewOnly = viewOnly
    rfb.background = 'rgb(var(--c-base))'

    const current = () => rfbRef.current === rfb
    rfb.addEventListener('connect', () => {
      if (!current()) return
      setStatus('connected')
      setDetail('')
      rfb.focus()
    })
    rfb.addEventListener('credentialsrequired', () => {
      if (current()) setStatus('credentials')
    })
    rfb.addEventListener('securityfailure', (e) => {
      if (!current()) return
      const reason = (e as CustomEvent).detail?.reason
      setStatus('authfailed')
      setDetail(reason || 'The Mac rejected the username or password.')
    })
    rfb.addEventListener('clipboard', (e) => {
      if (current()) setMacClipboard((e as CustomEvent).detail?.text ?? null)
    })
    rfb.addEventListener('disconnect', (e) => {
      if (!current()) return
      rfbRef.current = null
      setStatus(s => (s === 'authfailed' ? s : 'disconnected'))
      if (!(e as CustomEvent).detail?.clean) {
        const reason = lastNoVncError || 'Connection lost. The session may have been idle for 15 minutes or opened elsewhere.'
        setDetail(d => d || `${reason} (${via}, ${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? 'unknown browser'})`)
      }
    })
  }, [teardown, viewOnly])

  // Connect while this view is mounted; tear down on unmount (tab switch).
  useEffect(() => {
    void connect()
    return () => {
      attemptRef.current++
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitCredentials = (e: React.FormEvent) => {
    e.preventDefault()
    rfbRef.current?.sendCredentials({ username, password })
    setPassword('')
    setStatus('connecting')
  }

  const toggleViewOnly = () => {
    const next = !viewOnly
    setViewOnly(next)
    if (rfbRef.current) rfbRef.current.viewOnly = next
  }

  const pasteToMac = async () => {
    try {
      const text = await navigator.clipboard.readText()
      rfbRef.current?.clipboardPasteFrom(text)
      rfbRef.current?.focus()
    } catch {
      setDetail('The browser blocked clipboard access. Allow it for this site and try again.')
    }
  }

  const copyFromMac = async () => {
    if (macClipboard == null) return
    try {
      await navigator.clipboard.writeText(macClipboard)
    } catch {
      setDetail('The browser blocked clipboard access.')
    }
  }

  const connected = status === 'connected'
  const live = status === 'connected' || status === 'connecting' || status === 'credentials'

  return (
    <div ref={frameRef} className={`card flex flex-col overflow-hidden animate-fade-in ${className}`}>
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0 border-b border-navy-600/50"
        style={{ background: 'rgba(13,22,41,0.6)', minHeight: '36px', color: 'rgb(var(--c-muted))' }}
      >
        <span className="flex items-center gap-2 text-xs font-mono" role="status" aria-live="polite">
          <span className="w-2 h-2 rounded-full" style={{ background: `rgb(${STATUS_COLOR[status]})` }} aria-hidden />
          <span style={{ color: 'rgb(var(--c-text))' }}>{STATUS_LABEL[status]}</span>
          {route && live && <span style={{ color: 'rgb(var(--c-faint))' }}>· {route === 'direct' ? 'Tailscale' : 'tunnel'}</span>}
        </span>
        <div className="flex-1" />
        {live ? (
          <button className={btn} onClick={() => { attemptRef.current++; teardown(); setStatus('disconnected'); setDetail('') }} aria-label="Disconnect from the Mac">
            <Unplug size={13} /> Disconnect
          </button>
        ) : (
          <button className={btn} onClick={() => void connect()} aria-label="Reconnect to the Mac">
            <Plug size={13} /> Reconnect
          </button>
        )}
        <button className={btn} onClick={toggleViewOnly} aria-pressed={viewOnly} aria-label="View only"
          style={viewOnly ? { color: 'rgb(var(--c-accent-bright))' } : undefined}>
          <Eye size={13} /> View only
        </button>
        <button className={btn} onClick={() => void pasteToMac()} disabled={!connected || viewOnly} aria-label="Paste your clipboard to the Mac">
          <ClipboardPaste size={13} /> Paste to Mac
        </button>
        {macClipboard != null && (
          <button className={btn} onClick={() => void copyFromMac()} disabled={!connected} aria-label="Copy the Mac clipboard">
            <Clipboard size={13} /> Copy Mac clipboard
          </button>
        )}
        <button className={btn} onClick={() => void frameRef.current?.requestFullscreen()} aria-label="Fullscreen">
          <Maximize size={13} /> Fullscreen
        </button>
      </div>

      <div className="relative flex-1 min-h-0" style={{ background: 'rgb(var(--c-base))' }}>
        <div ref={screenRef} className="absolute inset-0" tabIndex={0} aria-label="Mac Mini screen" />

        {status === 'credentials' && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgb(var(--c-base) / 0.85)' }}>
            <form onSubmit={submitCredentials} className="card w-72 p-5 flex flex-col gap-3" autoComplete="off">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'rgb(var(--c-text))' }}>Mac Mini login</h2>
                <p className="text-xs mt-1" style={{ color: 'rgb(var(--c-muted))' }}>
                  Your macOS username and password. Sent straight to the Mac, never stored.
                </p>
              </div>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'rgb(var(--c-muted))' }}>
                Username
                <input
                  className="px-2 py-1.5 rounded-md text-sm outline-none"
                  style={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="off"
                  autoFocus
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'rgb(var(--c-muted))' }}>
                Password
                <input
                  type="password"
                  className="px-2 py-1.5 rounded-md text-sm outline-none"
                  style={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button
                type="submit"
                className="mt-1 py-1.5 rounded-md text-sm font-medium"
                style={{ background: 'rgb(var(--c-accent))', color: 'rgb(var(--c-base))' }}
              >
                Unlock screen
              </button>
            </form>
          </div>
        )}

        {(status === 'disconnected' || status === 'authfailed') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
            <p className="text-sm" style={{ color: 'rgb(var(--c-text))' }}>{STATUS_LABEL[status]}</p>
            {detail && <p className="text-xs max-w-md" style={{ color: 'rgb(var(--c-muted))' }}>{detail}</p>}
            <button className={`${btn} border`} style={{ borderColor: 'rgb(var(--c-border))' }} onClick={() => void connect()}>
              <Plug size={13} /> {status === 'authfailed' ? 'Try again' : 'Reconnect'}
            </button>
          </div>
        )}

        {connected && detail && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs px-3 py-1.5 rounded-md"
            style={{ background: 'rgb(var(--c-elevated))', color: 'rgb(var(--c-muted))', border: '1px solid rgb(var(--c-border))' }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}

export default MacScreen
