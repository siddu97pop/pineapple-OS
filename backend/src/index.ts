import 'dotenv/config'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { requireAuth, extractAuthToken } from './auth'
import { handleTerminalConnection } from './terminal'
import { initFileWatcher, addSSEClient } from './fileWatch'
import { getStatusHandler, getSyncthingHandler } from './status'
import { getClaudeMdHandler, saveClaudeMdHandler } from './claudeMd'
import { getSessionsHandler } from './sessions'

const app = express()
const server = http.createServer(app)

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
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

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/terminal')) {
    // Extract token from query param (WS can't send custom headers)
    let token: string | null = null
    try {
      const urlParams = new URL(request.url, 'http://x').searchParams
      token = urlParams.get('token')
    } catch {}

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    try {
      jwt.verify(token, process.env.SUPABASE_JWT_SECRET!, { algorithms: ['HS256'] })
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } catch {
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
