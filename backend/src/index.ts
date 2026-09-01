import 'dotenv/config'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { requireAuth, extractAuthToken, isAllowedUser } from './auth'
import { handleTerminalConnection } from './terminal'
import {
  startTerminalSession,
  pollTerminalSession,
  sendTerminalInput,
  resizeTerminal,
  stopTerminalSession,
  authorizeTerminalSession,
  openTerminalStream,
} from './terminalHttp'
import { initFileWatcher, addSSEClient } from './fileWatch'
import { getStatusHandler, getSyncthingHandler } from './status'
import { getClaudeMdHandler, saveClaudeMdHandler } from './claudeMd'
import { getSessionsHandler } from './sessions'
import { getVaultTreeHandler, getVaultFileHandler, saveVaultFileHandler } from './vault'
import { getMemoryHandler } from './memory'
import { getVaultGraphHandler, rebuildVaultGraphHandler, getGraphStatusHandler } from './graph'
import { vaultSearchHandler, vaultRelatedHandler } from './vectorSearch'
import { vaultAskHandler } from './vaultAsk'
import { getAgents, killAgent } from './agents'
import {
  initCheckpointWatcher,
  getCheckpointsHandler,
  streamCheckpointsHandler,
  updateCheckpointHandler,
} from './checkpoints'

const app = express()
const server = http.createServer(app)

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'https://pineapple.lexitools.tech',
  methods: ['GET', 'POST', 'OPTIONS'],
}))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), service: 'pineapple-api' })
})

app.get('/api/status', requireAuth, getStatusHandler)
app.get('/api/syncthing', requireAuth, getSyncthingHandler)
app.get('/api/sessions', requireAuth, getSessionsHandler)

app.get('/api/sessions/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write('data: {"connected":true}\n\n')
  addSSEClient(res)
})

app.get('/api/claude-md', requireAuth, getClaudeMdHandler)
app.post('/api/claude-md', requireAuth, saveClaudeMdHandler)

app.get('/api/vault/tree', requireAuth, getVaultTreeHandler)
app.get('/api/vault/file', requireAuth, getVaultFileHandler)
app.post('/api/vault/file', requireAuth, saveVaultFileHandler)

app.get('/api/memory', requireAuth, getMemoryHandler)

app.get('/api/vault/graph', requireAuth, getVaultGraphHandler)
app.post('/api/vault/graph/rebuild', requireAuth, rebuildVaultGraphHandler)
app.get('/api/vault/graph/status', requireAuth, getGraphStatusHandler)

app.post('/api/vault/search', requireAuth, vaultSearchHandler)
app.get('/api/vault/related', requireAuth, vaultRelatedHandler)
app.post('/api/vault/ask', requireAuth, vaultAskHandler)

app.get('/api/agents', requireAuth, (_req, res) => {
  res.json(getAgents())
})

app.post('/api/agents/:pid/kill', requireAuth, (req, res) => {
  const pid = parseInt(req.params.pid, 10)
  if (isNaN(pid)) {
    res.status(400).json({ error: 'invalid pid' })
    return
  }
  const ok = killAgent(pid)
  res.json({ ok })
})

app.get('/api/checkpoints', requireAuth, getCheckpointsHandler)
app.get('/api/checkpoints/stream', requireAuth, streamCheckpointsHandler)
app.post('/api/checkpoints/:id', requireAuth, updateCheckpointHandler)

function terminalSessionId(req: express.Request): string {
  const bodyId = (req.body as any)?.sessionId
  const queryId = (req.query as any)?.sessionId
  return typeof bodyId === 'string' ? bodyId : typeof queryId === 'string' ? queryId : ''
}

// New clients use a short-lived per-terminal capability after the initial JWT-
// authenticated start. Keep JWT fallback compatibility for older frontend
// bundles during a rolling deploy.
function requireTerminalSession(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const capability = req.headers['x-terminal-capability']
  const value = Array.isArray(capability) ? capability[0] : capability
  if (typeof value === 'string' && authorizeTerminalSession(terminalSessionId(req), value)) {
    next()
    return
  }
  requireAuth(req, res, next)
}

// HTTP terminal fallback for environments that aggressively drop WebSockets.
app.post('/api/terminal/start', requireAuth, (_req, res) => {
  try {
    const started = startTerminalSession()
    res.json(started)
  } catch (err) {
    const message = (err as Error).message || 'Failed to start terminal session'
    if (message.includes('Session limit')) {
      res.status(429).json({ error: message })
      return
    }
    res.status(500).json({ error: message })
  }
})

app.get('/api/terminal/stream', requireTerminalSession, (req, res) => {
  const sessionId = terminalSessionId(req)
  const since = Number((req.query as any)?.since || '0')
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  if (!openTerminalStream(sessionId, since, res)) res.end()
})

app.get('/api/terminal/poll', requireTerminalSession, async (req, res) => {
  const sessionId = String((req.query as any)?.sessionId || '')
  const since = Number((req.query as any)?.since || '0')
  const waitMs = Number((req.query as any)?.waitMs || '25000')
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  const body = await pollTerminalSession(sessionId, since, waitMs)
  res.json(body)
})

app.post('/api/terminal/input', requireTerminalSession, (req, res) => {
  const { sessionId, data } = req.body || {}
  if (typeof sessionId !== 'string' || typeof data !== 'string') {
    res.status(400).json({ error: 'sessionId and data are required' })
    return
  }
  const ok = sendTerminalInput(sessionId, data)
  if (!ok) {
    res.status(404).json({ error: 'terminal session not found' })
    return
  }
  res.json({ ok: true })
})

// Streaming HTTP fallback input. The browser keeps one chunked request open
// and sends newline-delimited control frames, avoiding a request and CORS
// preflight for every key when WebSockets are unavailable.
app.post('/api/terminal/input-stream', requireTerminalSession, (req, res) => {
  const sessionId = terminalSessionId(req)
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }

  let buffer = ''
  let frameCount = 0
  const openedAt = Date.now()
  const handleFrame = (line: string) => {
    if (!line.trim()) return
    try {
      const message = JSON.parse(line)
      if (message.type === 'input' && typeof message.data === 'string') {
        frameCount += 1
        sendTerminalInput(sessionId, message.data)
      } else if (message.type === 'resize' && message.cols > 0 && message.rows > 0) {
        frameCount += 1
        resizeTerminal(sessionId, Number(message.cols), Number(message.rows))
      }
    } catch {}
  }

  req.setEncoding('utf8')
  console.log('[HTTP-PTY] input stream open', { sessionId })
  req.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) handleFrame(line)
  })
  req.on('end', () => {
    handleFrame(buffer)
    console.log('[HTTP-PTY] input stream close', { sessionId, frameCount, lifetimeMs: Date.now() - openedAt })
    if (!res.writableEnded) res.status(204).end()
  })
  req.on('aborted', () => {
    console.log('[HTTP-PTY] input stream aborted', { sessionId, frameCount, lifetimeMs: Date.now() - openedAt })
    if (!res.writableEnded) res.end()
  })
  req.on('error', () => {
    console.log('[HTTP-PTY] input stream error', { sessionId, frameCount, lifetimeMs: Date.now() - openedAt })
    if (!res.writableEnded) res.end()
  })
})

app.post('/api/terminal/resize', requireTerminalSession, (req, res) => {
  const { sessionId, cols, rows } = req.body || {}
  if (typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  const ok = resizeTerminal(sessionId, Number(cols), Number(rows))
  if (!ok) {
    res.status(404).json({ error: 'terminal session not found or invalid size' })
    return
  }
  res.json({ ok: true })
})

app.post('/api/terminal/stop', requireTerminalSession, (req, res) => {
  const { sessionId } = req.body || {}
  if (typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  stopTerminalSession(sessionId)
  res.json({ ok: true })
})

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/terminal')) {
    let token: string | null = null
    try {
      const urlParams = new URL(request.url, 'http://x').searchParams
      token = urlParams.get('token')
    } catch {}

    // Log JWT header algorithm for debugging
    if (token) {
      try {
        const headerB64 = token.split('.')[0]
        const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
        console.log('[WS] JWT header:', JSON.stringify(header))
      } catch {}
    }
    console.log('[WS] upgrade attempt, token present:', !!token)

    if (!token) {
      console.log('[WS] rejected: no token')
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    try {
      const decoded = jwt.verify(token, process.env.SUPABASE_JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'), { algorithms: ['ES256'], audience: 'authenticated' })
      if (!isAllowedUser(decoded)) {
        console.log('[WS] rejected: user not allowed')
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      console.log('[WS] JWT verified OK, upgrading')
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } catch (err) {
      console.error('[WS] JWT verify failed:', (err as Error).message)
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
    }
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws) => handleTerminalConnection(ws))

const PORT = parseInt(process.env.PORT || '3456')
const SESSIONS_PATH = process.env.SESSIONS_MD_PATH || '/data/obsidian/logs/sessions.md'

initFileWatcher(SESSIONS_PATH)
initCheckpointWatcher()

if (!process.env.ALLOWED_USER_EMAILS?.trim()) {
  console.warn('[auth] ALLOWED_USER_EMAILS is empty/unset — ALL requests will be rejected (403) until it is set')
}

server.listen(PORT, () => {
  console.log(`
  ____  _                              __  ____  ____
 |  _ \\(_)_ __   ___  __ _ _ __  _ __|  \\/  |\\ \\/ /
 | |_) | | '_ \\ / _ \\/ _\` | '_ \\| '_ \\ |\\/| | \\  /
 |  __/| | | | |  __/ (_| | |_) | |_) | |  | | /  \\
 |_|   |_|_| |_|\\___|\\__,_| .__/| .__/|_|  |_|/_/\\_\\
                            |_|  |_|
  Pineapple OS API — port ${PORT}
  `)
})
