import chokidar from 'chokidar'
import fs from 'fs/promises'
import { Response } from 'express'

const sseClients = new Set<Response>()
let sessionsPath: string

function readLastNLines(content: string, n: number): string[] {
  return content.split('\n').filter(l => l !== '').slice(-n)
}

export function initFileWatcher(sessionsPath_: string): void {
  sessionsPath = sessionsPath_
  const watcher = chokidar.watch(sessionsPath, {
    persistent: true,
    usePolling: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })
  watcher.on('change', () => broadcastUpdate())
  watcher.on('error', (err) => console.error('File watcher error:', err))
}

async function broadcastUpdate(): Promise<void> {
  try {
    const content = await fs.readFile(sessionsPath, 'utf8')
    const lines = readLastNLines(content, 20)
    const payload = `data: ${JSON.stringify({ lines, ts: Date.now() })}\n\n`
    for (const client of sseClients) {
      try {
        client.write(payload)
      } catch {
        sseClients.delete(client)
      }
    }
  } catch {}
}

export function addSSEClient(res: Response): void {
  sseClients.add(res)
  res.on('close', () => sseClients.delete(res))
}

export async function getLastLines(n = 20): Promise<string[]> {
  const content = await fs.readFile(sessionsPath, 'utf8')
  return readLastNLines(content, n)
}
