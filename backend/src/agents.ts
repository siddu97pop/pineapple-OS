import fs from 'fs'

export interface AgentProcess {
  pid: number
  name: string
  cmdline: string
  cwd: string
  project: string
  status: 'running' | 'sleeping'
  memMb: number
  cpuPercent: number
  runtimeSecs: number
}

interface ProcSnapshot { total: number; ts: number }
const prevSnapshots = new Map<number, ProcSnapshot>()

const CLOCK_TICKS = 100
const PATTERNS = ['claude', 'python3', 'python', 'node', 'ts-node', 'tsx', 'deno', 'bun']
const MY_PID = process.pid

function matchesPattern(cmdline: string): boolean {
  const lower = cmdline.toLowerCase()
  return PATTERNS.some(p => lower.includes(p))
}

function cwdToProject(cwd: string): string {
  const m = cwd.match(/projects\/([^/]+)/)
  if (m) return m[1]
  if (cwd.includes('/data/obsidian')) return 'vault'
  return cwd.split('/').filter(Boolean).pop() || cwd
}

function readUptimeSecs(): number {
  try {
    return parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0])
  } catch { return 0 }
}

export function getAgents(): AgentProcess[] {
  const agents: AgentProcess[] = []
  const now = Date.now()
  const uptime = readUptimeSecs()

  let pids: number[]
  try {
    pids = fs.readdirSync('/proc')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n) && n !== MY_PID)
  } catch { return [] }

  for (const pid of pids) {
    const base = `/proc/${pid}`
    try {
      const cmdlineBuf = fs.readFileSync(`${base}/cmdline`)
      const cmdline = cmdlineBuf.toString().replace(/\0/g, ' ').trim()
      if (!matchesPattern(cmdline)) continue

      const comm = fs.readFileSync(`${base}/comm`, 'utf8').trim()

      let cwd = ''
      try { cwd = fs.readlinkSync(`${base}/cwd`) } catch {}

      const statParts = fs.readFileSync(`${base}/stat`, 'utf8').split(' ')
      const state = statParts[2]
      const utime = parseInt(statParts[13], 10)
      const stime = parseInt(statParts[14], 10)
      const starttime = parseInt(statParts[21], 10)
      const totalTicks = utime + stime

      const runtimeSecs = Math.max(0, Math.round(uptime - starttime / CLOCK_TICKS))

      let cpuPercent = 0
      const prev = prevSnapshots.get(pid)
      if (prev) {
        const tickDelta = Math.max(0, totalTicks - prev.total)
        const timeDelta = (now - prev.ts) / 1000
        if (timeDelta > 0) {
          cpuPercent = Math.round((tickDelta / CLOCK_TICKS / timeDelta) * 1000) / 10
        }
      }
      prevSnapshots.set(pid, { total: totalTicks, ts: now })

      const statusText = fs.readFileSync(`${base}/status`, 'utf8')
      const vmRSS = statusText.match(/^VmRSS:\s+(\d+)/m)
      const memMb = vmRSS ? Math.round(parseInt(vmRSS[1], 10) / 102.4) / 10 : 0

      agents.push({
        pid,
        name: comm,
        cmdline: cmdline.slice(0, 120),
        cwd,
        project: cwdToProject(cwd),
        status: state === 'R' ? 'running' : 'sleeping',
        memMb,
        cpuPercent,
        runtimeSecs,
      })
    } catch {
      prevSnapshots.delete(pid)
    }
  }

  // Clean up stale snapshots
  const pidSet = new Set(pids)
  for (const pid of prevSnapshots.keys()) {
    if (!pidSet.has(pid)) prevSnapshots.delete(pid)
  }

  return agents.sort((a, b) => b.runtimeSecs - a.runtimeSecs)
}

export function killAgent(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch { return false }
}
