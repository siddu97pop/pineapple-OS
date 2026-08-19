import { IPty } from 'node-pty'
import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { buildPtyEnv } from './ptyEnv'
import { ptyScopeConfig, spawnPty } from './ptySpawn'

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
  const connectedAt = Date.now()
  let firstDataAt: number | null = null
  let firstMessageAt: number | null = null
  let lastPongAt: number | null = null

  let pty: IPty
  try {
    pty = spawnPty(sessionId, {
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

  console.log('[PTY] spawned', { sessionId, cwd: OBSIDIAN_PATH, scope: ptyScopeConfig() })

  // node-pty rethrows non-EIO/EAGAIN socket errors as uncaught exceptions
  // unless at least one external 'error' listener is attached — this listener
  // is required to prevent a single session's teardown race from crashing
  // the whole server process.
  ;(pty as unknown as { on(event: string, listener: (err: Error) => void): void }).on('error', (err: Error) => {
    console.error('[PTY] error', { sessionId, message: err.message })
  })

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, WS_PING_INTERVAL_MS)

  pty.onData((data) => {
    if (firstDataAt === null) {
      firstDataAt = Date.now()
      console.log('[PTY] first data', { sessionId, afterMs: firstDataAt - connectedAt })
    }
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
    if (firstMessageAt === null) {
      firstMessageAt = Date.now()
      console.log('[WS] first client message', { sessionId, afterMs: firstMessageAt - connectedAt })
    }
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input' && typeof msg.data === 'string') {
        pty.write(msg.data)
      } else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
        pty.resize(msg.cols, msg.rows)
      }
    } catch {}
  })

  ws.on('pong', () => {
    lastPongAt = Date.now()
  })

  ws.on('close', (code, reasonBuf) => {
    const reason = reasonBuf?.toString() || ''
    console.log('[WS] close', {
      code,
      reason,
      sessionId,
      lifetimeMs: Date.now() - connectedAt,
      firstDataMs: firstDataAt === null ? null : firstDataAt - connectedAt,
      firstMessageMs: firstMessageAt === null ? null : firstMessageAt - connectedAt,
      lastPongAgoMs: lastPongAt === null ? null : Date.now() - lastPongAt,
    })
    clearInterval(pingTimer)
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  ws.on('error', (err) => {
    console.error('[WS] error:', { sessionId, message: err.message })
    clearInterval(pingTimer)
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  activeSessions.set(sessionId, pty)
}
