import { Request, Response } from 'express'
import fs from 'fs/promises'
import path from 'path'

const VAULT_ROOT = process.env.VAULT_ROOT
  || (process.env.CLAUDE_MD_PATH ? path.dirname(process.env.CLAUDE_MD_PATH) : '/data/obsidian')

const EXCLUDED = new Set(['node_modules', 'dist', '.trash'])

function shouldExclude(name: string): boolean {
  return name.startsWith('.') || EXCLUDED.has(name)
}

function resolveVaultPath(relPath: string): string | null {
  const normalised = path.normalize(relPath || '')
  if (normalised.startsWith('..')) return null
  const abs = path.join(VAULT_ROOT, normalised)
  // Ensure resolved path is within vault root
  if (abs !== VAULT_ROOT && !abs.startsWith(VAULT_ROOT + path.sep)) return null
  return abs
}

export interface TreeNode {
  name: string
  path: string   // relative to VAULT_ROOT
  type: 'file' | 'dir'
  mtime: number
  children?: TreeNode[]
}

async function readDir(absDir: string, relDir: string, depth: number): Promise<TreeNode[]> {
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }

  const filtered = entries.filter(e => !shouldExclude(e.name))

  filtered.sort((a, b) => {
    const aDir = a.isDirectory()
    const bDir = b.isDirectory()
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const nodes: TreeNode[] = []

  for (const entry of filtered) {
    const absPath = path.join(absDir, entry.name)
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    let mtime = 0
    try {
      const stat = await fs.stat(absPath)
      mtime = stat.mtimeMs
    } catch {}

    if (entry.isDirectory()) {
      const node: TreeNode = { name: entry.name, path: relPath, type: 'dir', mtime }
      if (depth > 0) {
        node.children = await readDir(absPath, relPath, depth - 1)
      }
      nodes.push(node)
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relPath, type: 'file', mtime })
    }
  }

  return nodes
}

export async function getVaultTreeHandler(req: Request, res: Response): Promise<void> {
  const relPath = String((req.query as any).path ?? '')
  const rawDepth = parseInt(String((req.query as any).depth ?? '2'), 10)
  const depth = Math.min(Math.max(isNaN(rawDepth) ? 2 : rawDepth, 0), 5)

  const absPath = resolveVaultPath(relPath)
  if (!absPath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  try {
    const stat = await fs.stat(absPath)
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' })
      return
    }
    const children = await readDir(absPath, relPath, depth)
    res.json({ path: relPath, children })
  } catch {
    res.status(404).json({ error: 'Path not found' })
  }
}

export async function getVaultFileHandler(req: Request, res: Response): Promise<void> {
  const relPath = String((req.query as any).path ?? '')
  if (!relPath) {
    res.status(400).json({ error: 'path query param is required' })
    return
  }

  const absPath = resolveVaultPath(relPath)
  if (!absPath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  try {
    const content = await fs.readFile(absPath, 'utf8')
    res.json({ path: relPath, content })
  } catch {
    res.status(404).json({ error: 'File not found' })
  }
}

export async function saveVaultFileHandler(req: Request, res: Response): Promise<void> {
  const { path: relPath, content } = req.body ?? {}

  if (typeof relPath !== 'string' || !relPath) {
    res.status(400).json({ error: 'path is required' })
    return
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' })
    return
  }

  const absPath = resolveVaultPath(relPath)
  if (!absPath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  try {
    await fs.writeFile(absPath, content, 'utf8')
    res.json({ ok: true, saved_at: new Date().toISOString() })
  } catch {
    res.status(500).json({ error: 'Failed to write file' })
  }
}
