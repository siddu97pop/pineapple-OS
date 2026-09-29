import { Request, Response } from 'express'
import os from 'os'

const loadHistory: number[] = []
const MAX_HISTORY = 10

async function sampleLoad(): Promise<void> {
  try {
    const load1 = os.loadavg()[0]
    loadHistory.push(load1)
    if (loadHistory.length > MAX_HISTORY) loadHistory.splice(0, loadHistory.length - MAX_HISTORY)
  } catch {}
}

void sampleLoad()
setInterval(() => void sampleLoad(), 30_000)

export async function getStatusHandler(req: Request, res: Response): Promise<void> {
  try {
    const [load1, load5, load15] = os.loadavg()
    res.json({
      uptime_seconds: os.uptime(),
      load_1: load1,
      load_5: load5,
      load_15: load15,
      hostname: os.hostname(),
      load_history: [...loadHistory],
    })
  } catch {
    res.status(500).json({ error: 'Failed to read system status' })
  }
}

export async function getSyncthingHandler(req: Request, res: Response): Promise<void> {
  const url = `${process.env.SYNCTHING_URL || 'http://localhost:8384'}/rest/system/status`
  const apiKey = process.env.SYNCTHING_API_KEY || ''
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const resp = await fetch(url, {
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await resp.json() as any
    res.json({ state: 'idle', uptime: data.uptime, version: data.version, myID: data.myID })
  } catch {
    clearTimeout(timeout)
    res.json({ state: 'unavailable' })
  }
}
