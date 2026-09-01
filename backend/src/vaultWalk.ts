// Shared vault traversal + frontmatter parsing.
//
// Extracted from graphBuild.ts so the graph builder and the vector ingest
// (vectorIngest.ts) walk the vault identically — same roots, same exclusions,
// same frontmatter handling. Two walkers that drift apart would mean the graph
// and semantic search silently disagree about what is in the vault.

import fs from 'fs/promises'
import path from 'path'

export const VAULT_ROOT = process.env.VAULT_ROOT
  || (process.env.CLAUDE_MD_PATH ? path.dirname(process.env.CLAUDE_MD_PATH) : '/data/obsidian')

export const SCOPED_TOP_DIRS = ['wiki', 'raw', 'memory', 'logs']
export const EXCLUDED = new Set(['node_modules', 'dist', '.trash', '.git'])

export function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || EXCLUDED.has(name)
}

// Recursively collect .md file relative paths (posix-style) under absDir.
export async function collectMarkdownFiles(absDir: string, relDir: string, acc: string[]): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name)) continue
      await collectMarkdownFiles(path.join(absDir, e.name), relDir ? `${relDir}/${e.name}` : e.name, acc)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      acc.push(relDir ? `${relDir}/${e.name}` : e.name)
    }
  }
}

export interface Frontmatter {
  aliases: string[]
  related: string[]
  tags: string[]
}

// Lightweight frontmatter parser: handles `key: value`, `key: [a, b]`,
// and block lists (`key:\n  - item`). Good enough for aliases/related/links.
export function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
  const fm: Frontmatter = { aliases: [], related: [], tags: [] }
  if (!content.startsWith('---')) return { fm, body: content }

  const lines = content.split('\n')
  if (lines[0].trim() !== '---') return { fm, body: content }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return { fm, body: content }

  const fmLines = lines.slice(1, end)
  const body = lines.slice(end + 1).join('\n')

  let currentKey: 'aliases' | 'related' | 'links' | 'tags' | null = null
  for (const raw of fmLines) {
    const listItem = raw.match(/^\s*-\s*(.+)$/)
    if (listItem && currentKey) {
      const val = listItem[1].trim().replace(/^["']|["']$/g, '')
      if (currentKey === 'aliases') fm.aliases.push(val)
      else if (currentKey === 'tags') fm.tags.push(val)
      else fm.related.push(val)
      continue
    }
    const kv = raw.match(/^(aliases|related|links|tags)\s*:\s*(.*)$/)
    if (kv) {
      const key = kv[1] as 'aliases' | 'related' | 'links' | 'tags'
      const rest = kv[2].trim()
      if (!rest) {
        currentKey = key
        continue
      }
      currentKey = null
      const inline = rest.match(/^\[(.*)\]$/)
      const items = inline
        ? inline[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [rest.replace(/^["']|["']$/g, '')]
      if (key === 'aliases') fm.aliases.push(...items)
      else if (key === 'tags') fm.tags.push(...items)
      else fm.related.push(...items)
      continue
    }
    currentKey = null
  }
  return { fm, body }
}
