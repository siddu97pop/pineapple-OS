import { IPty, spawn } from 'node-pty'
import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

const MAX_PTY_SESSIONS = parseInt(process.env.MAX_PTY_SESSIONS || '5')
const OBSIDIAN_PATH = process.env.CLAUDE_MD_PATH
  ? path.dirname(process.env.CLAUDE_MD_PATH)
  : '/data/obsidian'

const activeSessions = new Map<string, IPty>()

export function handleTerminalConnection(ws: WebSocket): void {
  if (activeSessions.size >= MAX_PTY_SESSIONS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session limit reached (max 5)' }))
    ws.close()
    return
  }

  const sessionId = uuidv4()

  const pty = spawn('/bin/bash', ['-c', 'claude; exec bash'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: OBSIDIAN_PATH,
    env: process.env as Record<string, string>,
  })

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }))
    }
  })

  pty.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }))
    }
    ws.close()
    activeSessions.delete(sessionId)
  })

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input') pty.write(msg.data)
      else if (msg.type === 'resize') pty.resize(msg.cols, msg.rows)
    } catch {}
  })

  ws.on('close', () => {
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  ws.on('error', () => {
    try { pty.kill('SIGHUP') } catch {}
    activeSessions.delete(sessionId)
  })

  activeSessions.set(sessionId, pty)
}
