// Ask the vault — the generation half of the RAG pipeline.
//
// Retrieves the nearest chunks via vectorSearch, then has Claude answer strictly
// from them and cite the notes it used. Retrieval without generation is Phase 2;
// this is what makes it RAG.
//
// Plan: projects/Pineapple OS/RAG_SEMANTIC_SEARCH_PLAN.md (Phase 4)

import type { Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'

import { searchVault, SearchHit } from './vectorSearch'

const MODEL = 'claude-opus-5'
const RETRIEVE_COUNT = 8
const MAX_TOKENS = 4096

const SYSTEM = `You answer questions about Siddharth's personal Obsidian vault using only the note excerpts provided.

Rules:
- Answer only from the excerpts. Do not use outside knowledge, and do not infer beyond what they say.
- Cite the source path of every note you draw on, inline, like [logs/2026/07/example.md].
- If the excerpts do not contain the answer, say so plainly and name what is missing. Do not guess, and do not pad a thin answer to sound complete. A short "the notes don't cover this" is the correct response when it is true.
- The excerpts are retrieved by semantic similarity, so some may be irrelevant. Ignore those rather than forcing them into the answer.
- Be concise and concrete. Prefer the specifics in the notes (dates, commit hashes, settings) over generalities.`

let client: Anthropic | null = null

function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY must be set to use /api/vault/ask')
    }
    client = new Anthropic()
  }
  return client
}

function renderContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => {
      const head = h.heading ? ` — ${h.heading}` : ''
      return `<note index="${i + 1}" path="${h.path}"${head ? ` heading="${h.heading}"` : ''}>\n${h.content}\n</note>`
    })
    .join('\n\n')
}

export interface AskResult {
  question: string
  answer: string
  sources: Array<{ path: string; heading: string | null; similarity: number }>
  ms: number
}

export async function askVault(question: string, limit = RETRIEVE_COUNT): Promise<AskResult> {
  const started = Date.now()
  const hits = await searchVault(question, limit)

  if (!hits.length) {
    return {
      question,
      answer: 'Nothing in the indexed vault matched that question.',
      sources: [],
      ms: Date.now() - started,
    }
  }

  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    // Grounded extraction over a handful of short excerpts — low effort keeps
    // latency and cost down without disabling thinking, which on Opus 5 has its
    // own failure modes.
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [
      {
        role: 'user',
        content: `Notes retrieved from the vault:\n\n${renderContext(hits)}\n\nQuestion: ${question}`,
      },
    ],
  })

  if (res.stop_reason === 'refusal') {
    throw new Error('request was declined by the model')
  }

  const answer = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  return {
    question,
    answer,
    sources: hits.map(h => ({ path: h.path, heading: h.heading, similarity: h.similarity })),
    ms: Date.now() - started,
  }
}

export async function vaultAskHandler(req: Request, res: Response): Promise<void> {
  const { question, limit } = (req.body ?? {}) as { question?: unknown; limit?: unknown }

  if (typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'question is required' })
    return
  }

  const parsedLimit =
    typeof limit === 'number' && Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : RETRIEVE_COUNT

  try {
    res.json(await askVault(question.trim(), parsedLimit))
  } catch (err) {
    console.error('[vaultAsk] failed:', err)
    res.status(500).json({ error: 'vault ask failed' })
  }
}
