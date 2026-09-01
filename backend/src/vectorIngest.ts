// Semantic vault search — ingestion pass.
//
// Walks the same vault roots as graphBuild.ts (via the shared vaultWalk module),
// splits each note into heading-scoped chunks, embeds the ones whose content has
// changed, and upserts them into Supabase `public.vault_chunks`.
//
// Embeddings run locally via transformers.js (bge-small-en-v1.5, 384 dims). No
// embedding API key, no cost, and no vault text ever leaves this machine.
//
// Run directly: node dist/vectorIngest.js
// Plan: projects/Pineapple OS/RAG_SEMANTIC_SEARCH_PLAN.md (Phase 1)

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { createClient } from '@supabase/supabase-js'

import {
  VAULT_ROOT,
  SCOPED_TOP_DIRS,
  collectMarkdownFiles,
  parseFrontmatter,
} from './vaultWalk'

export const EMBED_MODEL = 'Xenova/bge-small-en-v1.5'
export const EMBED_DIMS = 384

const MAX_CHUNK_CHARS = 1500
const CHUNK_OVERLAP_CHARS = 100
const MIN_CHUNK_CHARS = 40
const EMBED_BATCH = 8
const WRITE_BATCH = 32

// Personal-sensitive notes are kept out of the index. Embedding is local so
// nothing leaves the box either way, but these have no business being
// retrievable by a vault-wide search.
const EXCLUDED_PATH_PATTERNS = [/(^|\/)lighthouse\.md$/i, /(^|\/)credit-card-analysis\.md$/i]

export interface Chunk {
  path: string
  heading: string | null
  chunk_index: number
  content: string
  content_hash: string
  tags: string[]
}

function hash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/**
 * Split note body into heading-scoped sections, then hard-split any section
 * still over MAX_CHUNK_CHARS with a small overlap so a sentence spanning a
 * boundary survives in one of the two pieces.
 */
export function chunkMarkdown(body: string): Array<{ heading: string | null; content: string }> {
  const lines = body.split('\n')
  const sections: Array<{ heading: string | null; lines: string[] }> = []
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] }

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      if (current.lines.some(l => l.trim())) sections.push(current)
      current = { heading: m[2].trim(), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.some(l => l.trim())) sections.push(current)

  const out: Array<{ heading: string | null; content: string }> = []
  for (const s of sections) {
    const text = s.lines.join('\n').trim()
    if (text.length < MIN_CHUNK_CHARS) continue
    if (text.length <= MAX_CHUNK_CHARS) {
      out.push({ heading: s.heading, content: text })
      continue
    }
    let start = 0
    while (start < text.length) {
      const piece = text.slice(start, start + MAX_CHUNK_CHARS)
      if (piece.trim().length >= MIN_CHUNK_CHARS) {
        out.push({ heading: s.heading, content: piece.trim() })
      }
      if (start + MAX_CHUNK_CHARS >= text.length) break
      start += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS
    }
  }
  return out
}

export async function collectChunks(): Promise<Chunk[]> {
  const files: string[] = []
  for (const dir of SCOPED_TOP_DIRS) {
    await collectMarkdownFiles(path.join(VAULT_ROOT, dir), dir, files)
  }

  const chunks: Chunk[] = []
  for (const rel of files) {
    if (EXCLUDED_PATH_PATTERNS.some(re => re.test(rel))) continue
    let raw: string
    try {
      raw = await fs.readFile(path.join(VAULT_ROOT, rel), 'utf8')
    } catch {
      continue
    }
    const { fm, body } = parseFrontmatter(raw)
    const tags = Array.from(new Set(fm.tags.map(t => t.trim().replace(/^#/, '')).filter(Boolean)))

    chunkMarkdown(body).forEach((c, i) => {
      // The heading is prepended to the embedded text so a chunk carries a
      // little of its own context — "## Design decisions" meaningfully changes
      // what the body underneath is about.
      const embedText = c.heading ? `${c.heading}\n\n${c.content}` : c.content
      chunks.push({
        path: rel,
        heading: c.heading,
        chunk_index: i,
        content: c.content,
        content_hash: hash(embedText),
        tags,
      })
    })
  }
  return chunks
}

let extractorPromise: Promise<any> | null = null

export async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    const { pipeline } = await import('@huggingface/transformers')
    extractorPromise = pipeline('feature-extraction', EMBED_MODEL)
  }
  return extractorPromise
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor()
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const res = await extractor(batch, { pooling: 'mean', normalize: true })
    const dims = res.dims as number[]
    const data = res.data as Float32Array
    const rows = dims[0]
    const cols = dims[dims.length - 1]
    for (let r = 0; r < rows; r++) {
      out.push(Array.from(data.slice(r * cols, (r + 1) * cols)))
    }
  }
  return out
}

function supabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run the vector ingest')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export interface IngestStats {
  files: number
  chunks: number
  embedded: number
  unchanged: number
  deleted: number
  ms: number
}

export async function ingest(): Promise<IngestStats> {
  const started = Date.now()
  const db = supabase()

  const chunks = await collectChunks()
  const files = new Set(chunks.map(c => c.path)).size

  // Existing (path, chunk_index) -> hash, so unchanged chunks are never re-embedded.
  const existing = new Map<string, string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('vault_chunks')
      .select('path, chunk_index, content_hash')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`select failed: ${error.message}`)
    for (const r of data ?? []) existing.set(`${r.path}::${r.chunk_index}`, r.content_hash)
    if (!data || data.length < PAGE) break
  }

  const stale = chunks.filter(c => existing.get(`${c.path}::${c.chunk_index}`) !== c.content_hash)
  const unchanged = chunks.length - stale.length

  // Embed and write one batch at a time rather than embedding everything first.
  // Holding ~900 x 384 floats plus the model was enough to get this OOM-killed on
  // a 2 vCPU / 8 GB VPS, and an all-or-nothing pass loses every embedding when it
  // dies. Writing per batch means a killed run keeps its progress, and because
  // completed chunks now match on content_hash, re-running resumes where it stopped.
  for (let i = 0; i < stale.length; i += WRITE_BATCH) {
    const batch = stale.slice(i, i + WRITE_BATCH)
    const vectors = await embedTexts(
      batch.map(c => (c.heading ? `${c.heading}\n\n${c.content}` : c.content)),
    )
    const rows = batch.map((c, j) => ({
      ...c,
      embedding: JSON.stringify(vectors[j]),
      updated_at: new Date().toISOString(),
    }))
    const { error } = await db.from('vault_chunks').upsert(rows, { onConflict: 'path,chunk_index' })
    if (error) throw new Error(`upsert failed: ${error.message}`)
    if (process.env.VECTOR_INGEST_QUIET !== '1') {
      console.log(`[vectorIngest] ${Math.min(i + WRITE_BATCH, stale.length)}/${stale.length} embedded`)
    }
  }

  // Drop rows whose source file or trailing chunks no longer exist.
  const live = new Set(chunks.map(c => `${c.path}::${c.chunk_index}`))
  const orphans = [...existing.keys()].filter(k => !live.has(k))
  for (const key of orphans) {
    const idx = key.lastIndexOf('::')
    const { error } = await db
      .from('vault_chunks')
      .delete()
      .eq('path', key.slice(0, idx))
      .eq('chunk_index', Number(key.slice(idx + 2)))
    if (error) throw new Error(`delete failed: ${error.message}`)
  }

  return {
    files,
    chunks: chunks.length,
    embedded: stale.length,
    unchanged,
    deleted: orphans.length,
    ms: Date.now() - started,
  }
}

async function main(): Promise<void> {
  const s = await ingest()
  console.log(
    `[vectorIngest] ${s.files} files, ${s.chunks} chunks — ` +
    `${s.embedded} embedded, ${s.unchanged} unchanged, ${s.deleted} deleted (${s.ms}ms)`,
  )
}

if (require.main === module) {
  main().catch(err => {
    console.error('[vectorIngest] failed:', err)
    process.exit(1)
  })
}
