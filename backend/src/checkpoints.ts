import fs from 'fs'
import path from 'path'
import { Request, Response } from 'express'

const CHECKPOINTS_PATH =
  process.env.CHECKPOINTS_PATH || '/data/obsidian/_system/checkpoints.json'

const sseClients = new Set<Response>()

export interface Checkpoint {
  id: string
  ts: string
  agent: string
  action: string
  context: string
  risk: 'high' | 'medium' | 'low'
  status: 'pending' | 'approved' | 'denied'
}

function ensureFile(): void {
  const dir = path.dirname(CHECKPOINTS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(CHECKPOINTS_PATH)) fs.writeFileSync(CHECKPOINTS_PATH, '[]')
}

function read(): Checkpoint[] {
  try {
    ensureFile()
    const raw = fs.readFileSync(CHECKPOINTS_PATH, 'utf8').trim()
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function write(checkpoints: Checkpoint[]): void {
  ensureFile()
  fs.writeFileSync(CHECKPOINTS_PATH, JSON.stringify(checkpoints, null, 2))
}

function broadcast(checkpoints: Checkpoint[]): void {
  const payload = `data: ${JSON.stringify(checkpoints)}\n\n`
  for (const client of sseClients) {
    try { client.write(payload) } catch { sseClients.delete(client) }
  }
}

let watcher: fs.FSWatcher | null = null

export function initCheckpointWatcher(): void {
  ensureFile()
  // Watch for external agent writes
  watcher = fs.watch(CHECKPOINTS_PATH, () => {
    broadcast(read())
  })
}

export function getCheckpointsHandler(_req: Request, res: Response): void {
  res.json(read())
}

export function streamCheckpointsHandler(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify(read())}\n\n`)
  sseClients.add(res)
  req.on('close', () => { sseClients.delete(res) })
}

export function updateCheckpointHandler(req: Request, res: Response): void {
  const { id } = req.params
  const { status } = req.body as { status?: string }
  if (status !== 'approved' && status !== 'denied') {
    res.status(400).json({ error: 'status must be approved or denied' })
    return
  }
  const checkpoints = read()
  const idx = checkpoints.findIndex(c => c.id === id)
  if (idx === -1) {
    res.status(404).json({ error: 'checkpoint not found' })
    return
  }
  checkpoints[idx].status = status
  write(checkpoints)
  broadcast(checkpoints)
  res.json({ ok: true })
}
