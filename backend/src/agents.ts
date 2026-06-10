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

export interface AgentGroup extends AgentProcess {
  procCount: number
  totalMemMb: number
  children: AgentProcess[]
}

interface ProcSnapshot { total: number; ts: number }
const prevSnapshots = new Map<number, ProcSnapshot>()

const CLOCK_TICKS = 100
const PATTERNS = ['claude', 'python3', 'python', 'node', 'ts-node', 'tsx', 'deno', 'bun']
// System processes that match PATTERNS by accident — never agents.
const DENY_PATTERNS = ['unattended-upgrade', 'docker-init', 'runuser ']
const MY_PID = process.pid

function matchesPattern(cmdline: string): boolean {
  const lower = cmdline.toLowerCase()
  if (DENY_PATTERNS.some(p => lower.includes(p))) return false
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

interface StatInfo {
  comm: string
  state: string
  ppid: number
  totalTicks: number
  starttime: number
}

// comm in /proc/<pid>/stat is parenthesised and may contain spaces,
// so split on the last ')' rather than naively on spaces.
function parseStat(raw: string): StatInfo | null {
  const close = raw.lastIndexOf(')')
  if (close === -1) return null
  const comm = raw.slice(raw.indexOf('(') + 1, close)
  const rest = raw.slice(close + 2).split(' ')
  return {
    comm,
    state: rest[0],
    ppid: parseInt(rest[1], 10),
    totalTicks: parseInt(rest[11], 10) + parseInt(rest[12], 10),
    starttime: parseInt(rest[19], 10),
  }
}

export function getAgents(): AgentGroup[] {
  const now = Date.now()
  const uptime = readUptimeSecs()

  let pids: number[]
  try {
    pids = fs.readdirSync('/proc')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n) && n !== MY_PID)
  } catch { return [] }

  // First pass: ppid for every pid so ancestry chains can pass through
  // unmatched intermediaries (bash/script wrappers), plus matched candidates.
  const pidToPpid = new Map<number, number>()
  const candidates = new Map<number, AgentProcess>()

  for (const pid of pids) {
    const base = `/proc/${pid}`
    try {
      const stat = parseStat(fs.readFileSync(`${base}/stat`, 'utf8'))
      if (!stat) continue
      pidToPpid.set(pid, stat.ppid)

      if (stat.state === 'Z' || stat.state === 'X') continue // defunct

      const cmdline = fs.readFileSync(`${base}/cmdline`).toString().replace(/\0/g, ' ').trim()
      if (!matchesPattern(cmdline)) continue

      let cwd = ''
      try { cwd = fs.readlinkSync(`${base}/cwd`) } catch {}

      const runtimeSecs = Math.max(0, Math.round(uptime - stat.starttime / CLOCK_TICKS))

      let cpuPercent = 0
      const prev = prevSnapshots.get(pid)
      if (prev) {
        const tickDelta = Math.max(0, stat.totalTicks - prev.total)
        const timeDelta = (now - prev.ts) / 1000
        if (timeDelta > 0) {
          cpuPercent = Math.round((tickDelta / CLOCK_TICKS / timeDelta) * 1000) / 10
        }
      }
      prevSnapshots.set(pid, { total: stat.totalTicks, ts: now })

      const statusText = fs.readFileSync(`${base}/status`, 'utf8')
      const vmRSS = statusText.match(/^VmRSS:\s+(\d+)/m)
      const memMb = vmRSS ? Math.round(parseInt(vmRSS[1], 10) / 102.4) / 10 : 0

      candidates.set(pid, {
        pid,
        name: stat.comm,
        cmdline: cmdline.slice(0, 120),
        cwd,
        project: cwdToProject(cwd),
        status: stat.state === 'R' ? 'running' : 'sleeping',
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

  // Second pass: attach each candidate to its topmost candidate ancestor,
  // so a claude session and its MCP/helper subprocesses form one group.
  const rootOf = (pid: number): number => {
    let topmost = pid
    let cursor = pidToPpid.get(pid)
    let hops = 0
    while (cursor !== undefined && cursor > 1 && hops < 50) {
      if (candidates.has(cursor)) topmost = cursor
      cursor = pidToPpid.get(cursor)
      hops++
    }
    return topmost
  }

  const groups = new Map<number, AgentProcess[]>()
  for (const pid of candidates.keys()) {
    const root = rootOf(pid)
    const members = groups.get(root) || []
    members.push(candidates.get(pid)!)
    groups.set(root, members)
  }

  // The group's face is its heaviest member (the actual agent, not the
  // script/bash wrapper it was launched through).
  const result: AgentGroup[] = []
  for (const members of groups.values()) {
    members.sort((a, b) => b.memMb - a.memMb)
    const primary = members[0]
    const children = members.slice(1)
    result.push({
      ...primary,
      cwd: primary.cwd || children.find(c => c.cwd)?.cwd || '',
      project: primary.cwd ? primary.project : (children.find(c => c.cwd)?.project || primary.project),
      status: members.some(m => m.status === 'running') ? 'running' : 'sleeping',
      cpuPercent: Math.round(members.reduce((s, m) => s + m.cpuPercent, 0) * 10) / 10,
      runtimeSecs: Math.max(...members.map(m => m.runtimeSecs)),
      procCount: members.length,
      totalMemMb: Math.round(members.reduce((s, m) => s + m.memMb, 0) * 10) / 10,
      children,
    })
  }

  return result.sort((a, b) => b.runtimeSecs - a.runtimeSecs)
}

export function killAgent(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch { return false }
}
