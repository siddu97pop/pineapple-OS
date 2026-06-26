import { Request, Response } from 'express'
import fs from 'fs/promises'
import path from 'path'

const VAULT_ROOT = process.env.VAULT_ROOT
  || (process.env.CLAUDE_MD_PATH ? path.dirname(process.env.CLAUDE_MD_PATH) : '/data/obsidian')

// The layered memory stack surfaced in the cockpit (relative to the vault root).
const STACK_FILES: { key: string; label: string; rel: string }[] = [
  { key: 'claude',   label: 'CLAUDE.md',        rel: 'CLAUDE.md' },
  { key: 'context',  label: 'context.md',       rel: '_system/context.md' },
  { key: 'projects', label: 'projects.md',      rel: 'memory/projects.md' },
  { key: 'decisions',label: 'decisions.md',     rel: 'memory/decisions.md' },
  { key: 'sessions', label: 'sessions.md',      rel: 'logs/sessions.md' },
]

export interface MemoryFile {
  key: string
  label: string
  path: string
  exists: boolean
  mtime: number
  lines: number
  preview: string
}

export interface MemoryTimelineItem {
  date: string
  title: string
  path: string
}

export interface MemoryData {
  stack: MemoryFile[]
  timeline: MemoryTimelineItem[]
}

function firstMeaningfulLine(content: string): string {
  const lines = content.split('\n')
  let inFrontmatter = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (i === 0 && t === '---') { inFrontmatter = true; continue }
    if (inFrontmatter) { if (t === '---') inFrontmatter = false; continue }
    if (!t) continue
    return t.replace(/^#+\s*/, '').replace(/^>\s*/, '').slice(0, 160)
  }
  return ''
}

async function buildStack(): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  for (const f of STACK_FILES) {
    const abs = path.join(VAULT_ROOT, f.rel)
    const entry: MemoryFile = {
      key: f.key, label: f.label, path: f.rel,
      exists: false, mtime: 0, lines: 0, preview: '',
    }
    try {
      const stat = await fs.stat(abs)
      entry.exists = true
      entry.mtime = stat.mtimeMs
      const content = await fs.readFile(abs, 'utf8')
      entry.lines = content.split('\n').length
      entry.preview = firstMeaningfulLine(content)
    } catch {}
    out.push(entry)
  }
  return out
}

// Recursively collect dated daily logs: logs/YYYY/MM/YYYY-MM-DD-title.md
async function collectDailyLogs(absDir: string, relDir: string, acc: MemoryTimelineItem[]): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const abs = path.join(absDir, e.name)
    const rel = relDir ? `${relDir}/${e.name}` : e.name
    if (e.isDirectory()) {
      await collectDailyLogs(abs, rel, acc)
    } else if (e.isFile()) {
      const m = e.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/)
      if (m) {
        const title = m[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        acc.push({ date: m[1], title, path: rel })
      }
    }
  }
}

export async function getMemoryHandler(_req: Request, res: Response): Promise<void> {
  try {
    const stack = await buildStack()
    const timeline: MemoryTimelineItem[] = []
    await collectDailyLogs(path.join(VAULT_ROOT, 'logs'), 'logs', timeline)
    timeline.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    res.json({ stack, timeline: timeline.slice(0, 15) } as MemoryData)
  } catch {
    res.status(500).json({ error: 'Failed to read memory' })
  }
}
