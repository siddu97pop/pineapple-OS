import { IPty, spawn } from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

const MAX_PTY_SESSIONS = parseInt(process.env.MAX_PTY_SESSIONS || '5')
const OBSIDIAN_PATH = process.env.CLAUDE_MD_PATH
  ? path.dirname(process.env.CLAUDE_MD_PATH)
  : '/data/obsidian'
const MAX_BUFFERED_CHUNKS = 2000

interface OutputChunk {
  seq: number
  data: string
}

interface TerminalSession {
  id: string
  pty: IPty
  chunks: OutputChunk[]
  nextSeq: number
  alive: boolean
}

const sessions = new Map<string, TerminalSession>()

function trimChunks(session: TerminalSession): void {
  if (session.chunks.length > MAX_BUFFERED_CHUNKS) {
    session.chunks.splice(0, session.chunks.length - MAX_BUFFERED_CHUNKS)
  }
}

export function startTerminalSession(): { sessionId: string } {
  if (sessions.size >= MAX_PTY_SESSIONS) {
    throw new Error('Session limit reached')
  }

  const id = uuidv4()
  const pty = spawn('/bin/bash', [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: OBSIDIAN_PATH,
    env: process.env as Record<string, string>,
  })

  const session: TerminalSession = {
    id,
    pty,
    chunks: [],
    nextSeq: 1,
    alive: true,
  }

  console.log('[HTTP-PTY] started', {
    sessionId: id,
    cwd: OBSIDIAN_PATH,
  })

  pty.onData((data) => {
    session.chunks.push({ seq: session.nextSeq, data })
    session.nextSeq += 1
    trimChunks(session)
  })

  pty.onExit(({ exitCode, signal }) => {
    session.alive = false
    console.log('[HTTP-PTY] exited', {
      sessionId: id,
      exitCode,
      signal: signal ?? 'none',
    })
    session.chunks.push({
      seq: session.nextSeq,
      data: `\r\n[Terminal exited: code=${exitCode}, signal=${signal ?? 'none'}]\r\n`,
    })
    session.nextSeq += 1
    trimChunks(session)
    // Keep the closed session briefly so the client can read final output.
    setTimeout(() => {
      sessions.delete(id)
    }, 30_000)
  })

  sessions.set(id, session)
  return { sessionId: id }
}

export function pollTerminalSession(sessionId: string, since: number): {
  alive: boolean
  nextSeq: number
  events: OutputChunk[]
} {
  const session = sessions.get(sessionId)
  if (!session) {
    return { alive: false, nextSeq: since, events: [] }
  }

  const fromSeq = Number.isFinite(since) && since > 0 ? since : 0
  const events = session.chunks.filter((chunk) => chunk.seq > fromSeq)

  return {
    alive: session.alive,
    nextSeq: session.nextSeq - 1,
    events,
  }
}

export function sendTerminalInput(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId)
  if (!session || !session.alive) return false
  session.pty.write(data)
  return true
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId)
  if (!session || !session.alive) return false
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return false
  session.pty.resize(Math.floor(cols), Math.floor(rows))
  return true
}

export function stopTerminalSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  console.log('[HTTP-PTY] stopping', { sessionId })
  try {
    session.pty.kill('SIGHUP')
  } catch {}
  sessions.delete(sessionId)
}
