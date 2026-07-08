import { Request, Response } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'

const GRAPH_CACHE_DIR = process.env.GRAPH_CACHE_DIR || '/opt/pineapple-api/graph-cache'
const GRAPH_JSON_PATH = path.join(GRAPH_CACHE_DIR, 'graph.json')

// dist/graphBuild.js sits alongside dist/graph.js after `tsc` build.
const BUILD_SCRIPT_PATH = path.join(__dirname, 'graphBuild.js')

interface RebuildStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

let status: RebuildStatus = { state: 'idle', startedAt: null, finishedAt: null, error: null }

export async function getVaultGraphHandler(_req: Request, res: Response): Promise<void> {
  try {
    const raw = await fs.readFile(GRAPH_JSON_PATH, 'utf8')
    res.type('application/json').send(raw)
  } catch {
    res.status(404).json({ error: 'Graph not built yet' })
  }
}

export function getGraphStatusHandler(_req: Request, res: Response): void {
  res.json(status)
}

export function rebuildVaultGraphHandler(_req: Request, res: Response): void {
  if (status.state === 'running') {
    res.status(409).json({ error: 'Rebuild already in progress', status })
    return
  }

  status = { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null }

  const child = spawn('node', [BUILD_SCRIPT_PATH], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.on('data', d => { stderr += d.toString() })

  child.on('error', err => {
    status = {
      state: 'error',
      startedAt: status.startedAt,
      finishedAt: new Date().toISOString(),
      error: `Failed to spawn graphBuild: ${err.message}`,
    }
  })

  child.on('close', code => {
    if (code === 0) {
      status = { state: 'done', startedAt: status.startedAt, finishedAt: new Date().toISOString(), error: null }
    } else {
      status = {
        state: 'error',
        startedAt: status.startedAt,
        finishedAt: new Date().toISOString(),
        error: stderr.trim() || `graphBuild exited with code ${code}`,
      }
    }
  })

  res.json({ ok: true, status })
}
