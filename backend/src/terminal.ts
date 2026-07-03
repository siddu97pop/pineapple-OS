import { IPty, spawn } from 'node-pty'
import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { buildPtyEnv } from './ptyEnv'

const MAX_PTY_SESSIONS = parseInt(process.env.MAX_PTY_SESSIONS || '5')
// Traefik v3 closes connections it reads no client data from for 60s
// (entrypoint readTimeout default) — the cause of the 1006 closures that
// forced the May 21 revert to HTTP polling. Server pings make the browser
// reply with pongs, which reset the proxy's read timer.
const WS_PING_INTERVAL_MS = 30_000
const OBSIDIAN_PATH = process.env.CLAUDE_MD_PATH
  ? path.dirname(process.env.CLAUDE_MD_PATH)
  : '/data/obsidian'

const activeSessions = new Map<string, IPty>()

export function handleTerminalConnection(ws: WebSocket): void {
  if (activeSessions.size >= MAX_PTY_SESSIONS) {
    ws.close(1008, 'Session limit reached')
    return
  }

  const sessionId = uuidv4()

  let pty: IPty
  try {
    pty = spawn('/bin/bash', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: OBSIDIAN_PATH,
      env: buildPtyEnv(),
    })
  } catch (err) {
    console.error('[PTY] spawn failed:', err)
    ws.close(1011, 'PTY spawn failed')
    return
  }

  console.log('[PTY] spawned', { sessionId, cwd: OBSIDIAN_PATH })

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, WS_PING_INTERVAL_MS)

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, (err) => {
        if (err) console.error('[PTY] send error:', err.message)
      })
    }
  })

  pty.onExit(({ exitCode, signal }) => {
    console.log('[PTY] exit', { exitCode, signal, sessionId })
    clearInterval(pingTimer)
    ws.close()
    activeSessions.delete(sessionId)
  })

  // Receive JSON control messages from browser: {type:'resize',cols,rows} or {type:'input',data}
  ws.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input' && typeof msg.data === 'string') {
        pty.write(msg.data)
      } else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
        pty.resize(msg.cols, msg.rows)
      }
    } catch {}
  })

  ws.on('close', (code, reasonBuf) => {
    const reason = reasonBuf?.toString() || ''
    console.log('[WS] close', { code, reason, sessionId })
    clearInterval(pingTimer)
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  ws.on('error', (err) => {
    console.error('[WS] error:', err.message)
    clearInterval(pingTimer)
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  activeSessions.set(sessionId, pty)
}
