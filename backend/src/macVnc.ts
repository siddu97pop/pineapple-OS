import net from 'net'
import { WebSocket } from 'ws'

// WebSocket <-> TCP bridge to macOS Screen Sharing (like websockify).
// VNC auth (Apple ARD) runs end to end between noVNC and macOS; this
// module only pipes bytes and never sees the Mac credentials in plaintext.

const IDLE_TIMEOUT_MS = 15 * 60 * 1000

let active: { ws: WebSocket; sock: net.Socket } | null = null

export function macVncTarget(): { host: string; port: number } | null {
  const raw = process.env.MAC_VNC_HOST?.trim()
  if (!raw) return null
  const idx = raw.lastIndexOf(':')
  const host = idx > 0 ? raw.slice(0, idx) : raw
  const port = idx > 0 ? parseInt(raw.slice(idx + 1)) : 5900
  if (!host || !Number.isFinite(port)) return null
  return { host, port }
}

export function handleMacConnection(ws: WebSocket, email: string): void {
  const target = macVncTarget()
  if (!target) {
    ws.close(1011, 'MAC_VNC_HOST not configured')
    return
  }

  // One session at a time: a new connection kicks the old one.
  if (active) {
    console.log('[mac] replacing existing session')
    active.ws.close(4000, 'Replaced by a newer session')
    active.sock.destroy()
  }

  const sock = net.connect(target.port, target.host)
  const session = { ws, sock }
  active = session
  console.log(`[mac] connect ${email} -> ${target.host}:${target.port}`)

  let idleTimer: NodeJS.Timeout
  const resetIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      console.log(`[mac] idle timeout ${email}`)
      ws.close(4001, 'Idle timeout')
      sock.destroy()
    }, IDLE_TIMEOUT_MS)
  }
  resetIdle()

  let closed = false
  const cleanup = (reason: string) => {
    if (closed) return
    closed = true
    clearTimeout(idleTimer)
    if (active === session) active = null
    sock.destroy()
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, reason)
    console.log(`[mac] disconnect ${email} (${reason})`)
  }

  sock.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true })
  })
  sock.on('error', (err) => cleanup(`tcp error: ${err.message}`))
  sock.on('close', () => cleanup('tcp closed'))

  ws.on('message', (data) => {
    resetIdle()
    if (Array.isArray(data)) data.forEach((d) => sock.write(d))
    else sock.write(Buffer.from(data as ArrayBuffer))
  })
  ws.on('error', () => cleanup('ws error'))
  ws.on('close', () => cleanup('ws closed'))
}
