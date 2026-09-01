// Semantic vault search — query side.
//
// Embeds the incoming question with the same local model used for ingestion and
// asks Postgres for the nearest chunks via the match_vault_chunks RPC.
//
// Plan: projects/Pineapple OS/RAG_SEMANTIC_SEARCH_PLAN.md (Phase 2)

import type { Request, Response } from 'express'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

import { embedTexts } from './vectorIngest'

// bge models are trained with an asymmetric retrieval prefix on the query side
// only — documents are embedded bare. Omitting it measurably degrades results,
// so it belongs here and nowhere near the ingest path.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 50

let client: SupabaseClient | null = null

function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for vault search')
    }
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}

export interface SearchHit {
  path: string
  heading: string | null
  chunk_index: number
  content: string
  tags: string[]
  similarity: number
}

export async function searchVault(
  query: string,
  limit = DEFAULT_LIMIT,
  tags?: string[],
): Promise<SearchHit[]> {
  const [vector] = await embedTexts([QUERY_PREFIX + query])
  const { data, error } = await db().rpc('match_vault_chunks', {
    query_embedding: JSON.stringify(vector),
    match_count: Math.min(Math.max(limit, 1), MAX_LIMIT),
    filter_tags: tags && tags.length ? tags : null,
  })
  if (error) throw new Error(`vault search failed: ${error.message}`)
  return (data ?? []) as SearchHit[]
}

export async function vaultSearchHandler(req: Request, res: Response): Promise<void> {
  const { query, limit, tags } = (req.body ?? {}) as {
    query?: unknown
    limit?: unknown
    tags?: unknown
  }

  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query is required' })
    return
  }

  const parsedLimit = typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_LIMIT
  const parsedTags = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === 'string' && !!t.trim())
    : undefined

  try {
    const started = Date.now()
    const results = await searchVault(query.trim(), parsedLimit, parsedTags)
    res.json({ query: query.trim(), count: results.length, ms: Date.now() - started, results })
  } catch (err) {
    console.error('[vectorSearch] failed:', err)
    res.status(500).json({ error: 'vault search failed' })
  }
}

export interface RelatedHit {
  path: string
  heading: string | null
  content: string
  similarity: number
}

/**
 * Notes semantically nearest to `path`, one row per note, excluding itself.
 * These are the suggestions the wikilink graph cannot produce — notes about the
 * same thing that were never linked or co-tagged.
 */
export async function relatedNotes(path: string, limit = DEFAULT_LIMIT): Promise<RelatedHit[]> {
  const { data, error } = await db().rpc('related_vault_notes', {
    source_path: path,
    match_count: Math.min(Math.max(limit, 1), 25),
  })
  if (error) throw new Error(`related notes failed: ${error.message}`)
  return (data ?? []) as RelatedHit[]
}

export async function vaultRelatedHandler(req: Request, res: Response): Promise<void> {
  const path = typeof req.query.path === 'string' ? req.query.path.trim() : ''
  if (!path) {
    res.status(400).json({ error: 'path is required' })
    return
  }
  const limitRaw = Number(req.query.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT

  try {
    const results = await relatedNotes(path, limit)
    res.json({ path, count: results.length, results })
  } catch (err) {
    console.error('[vectorSearch] related failed:', err)
    res.status(500).json({ error: 'related notes failed' })
  }
}
