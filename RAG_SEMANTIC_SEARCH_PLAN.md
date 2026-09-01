---
tags:
  - project
  - pineapple-os
created: 2026-09-01
status: planned
---

# Pineapple OS — Semantic Vault Search (pgvector RAG)

**Status:** Phases 1–3 and 5 implemented and verified 2026-09-01; Phase 4 code-complete but
unverified (no LLM API credit). Not yet deployed.
Build log: [[2026-09-01-pineapple-rag-phase1]], [[2026-09-01-pineapple-rag-phase2]],
[[2026-09-01-pineapple-rag-phase3-4-5]].

> **Changed during build:** embeddings run **locally** via transformers.js
> (`bge-small-en-v1.5`, **384 dims**), not Voyage — no API key existed, nothing leaves the
> host, and it costs nothing. Re-embedding the corpus takes ~2.5 min, so this is reversible.
**Builds on:** [[GRAPH_VIEW_PLAN]] (the vault walker this reuses)

---

## 1. Why this exists

The vault graph connects notes **you explicitly linked** — `[[wikilinks]]` and shared
frontmatter tags. `graphBuild.ts` walks `wiki/`, `raw/`, `memory/`, `logs/` and emits
those edges deterministically. It works well and costs nothing.

It has one blind spot, and it is structural rather than a bug: **a note you never linked
and never tagged is invisible to it.** If you wrote about Traefik cert renewal in a
Pineapple log in June and hit the same problem in a Wealth log in September, the graph
draws no edge between them. Nothing links them. Nothing tagged them the same. They are
about the same thing, and the graph cannot know that.

Semantic search fills exactly that gap: edges based on **what a note is about**, derived
from the text itself, with no linking or tagging effort from you.

This is additive. The wikilink graph stays as-is and remains the primary structure.

---

## 2. What an embedding actually is

Skip this if it's familiar.

An **embedding** is a list of numbers that represents the *meaning* of a piece of text.
A model reads a chunk of text and outputs, say, 1024 floating-point numbers — a
**vector**. The useful property is that **text with similar meaning produces vectors
that sit close together in that 1024-dimensional space**, even when the two pieces of
text share no words at all.

A deliberately tiny illustration in 2 dimensions instead of 1024:

```
                    ^
                    |          . "cert renewal failed"
      infrastructure|        . "letsencrypt error"
                    |      . "TLS handshake broke"
                    |
                    |                    . "net worth chart"
                    |                  . "portfolio value"
            finance |                . "EMI payoff"
                    +------------------------------------->
```

"cert renewal failed" and "TLS handshake broke" have **no words in common**. Keyword
search finds nothing. But the model has learned they mean nearly the same thing, so
their vectors land next to each other. Measure the distance between two vectors and you
have a similarity score.

That is the entire trick. Everything else is storage and indexing.

### Where the vectors come from

You send text to an **embedding model** and it returns the vector. Anthropic does not
sell one — [their docs](https://platform.claude.com/docs/en/build-with-claude/embeddings)
say so directly and point at **Voyage AI**. So the embedding step uses a different
provider from the answering step. That split is normal:

| Step | Job | Provider |
|---|---|---|
| Embed | text → vector | Voyage (or a local model) |
| Store + search | keep vectors, find nearest | **pgvector** in Postgres |
| Answer | read the retrieved notes, write a reply | Claude |

---

## 3. What pgvector is

**pgvector is a Postgres extension that adds a `vector` column type and the ability to
sort rows by distance between vectors.** That is genuinely all it is. It is not a
separate database, not a service, not something to deploy and babysit. It is
`CREATE EXTENSION vector;` and then Postgres has a new data type.

Before pgvector, a Postgres column could hold a number, text, a date, JSON. After it, a
column can hold `vector(1024)` — a fixed-length list of floats — and you can write:

```sql
SELECT content FROM chunks ORDER BY embedding <=> '[0.013, -0.271, ...]' LIMIT 5;
```

`<=>` is the cosine-distance operator pgvector adds. That query means *"give me the five
rows whose meaning is closest to this vector."* It is ordinary SQL against ordinary
Postgres, which is why this is a much smaller step than it sounds.

### You are already running it

This is not theoretical for you. On the UGREEN NAS:

```
Immich-DB   ghcr.io/immich-app/postgres:16-vectorchord0.3.0-pgvectors0.2.0
```

```
 Name    | Version |                    Description
---------+---------+----------------------------------------------------
 vector  |  0.8.0  | vector data type and ivfflat and hnsw access methods
 vchord  |  0.3.0  | vchord: Vector database plugin for Postgres
```

Two vector columns, live, with **1,866 embeddings** in `smart_search.embedding` right now:

```
  table_name  | column_name
--------------+-------------
 face_search  | embedding     <- face recognition: whose face is this
 smart_search | embedding     <- semantic photo search
```

Every time you open Immich and search your photos for "beach" and it finds beach photos
you never tagged, **that is pgvector doing a nearest-neighbour lookup on a vector**
produced by the `Immich-LEARNING` container. You already own a running production
example of the exact thing this plan builds. The only difference is that Immich embeds
*images* and this embeds *notes*.

### Indexes: ivfflat and hnsw

With a few thousand rows, Postgres compares your query vector against every row. That is
fine and fast. Past roughly 10,000 rows it gets slow, so pgvector offers two index types
(`ivfflat`, `hnsw`) that trade a little accuracy for a lot of speed.

**Your vault is ~228 markdown files, ~1.5 MB → roughly 600–900 chunks.** That is far
below where indexes matter. Build without one. Add `hnsw` later only if search feels
slow, and say so honestly in an interview — knowing *when not* to add an index is a
better signal than adding one reflexively.

---

## 4. What RAG is, in terms of what you already do

**RAG = Retrieval-Augmented Generation.** Three steps, and you already do two of them by
hand every day:

1. **Retrieval** — find the notes relevant to a question.
   *You do this now* by opening the graph, following wikilinks, or grepping.
2. **Augmentation** — paste those notes into the model's context.
   *You do this now* every time CLAUDE.md tells me to read `memory/projects/<slug>.md`
   before a task.
3. **Generation** — the model answers using that text.

CLAUDE.md's "Before Starting Any Task" section is a **hand-written retrieval rule.**
"Identify the project, read only that split file" is a routing heuristic you authored
because reading everything cost 17k tokens a session. RAG replaces the hand-written rule
with a learned one: instead of *"if the task mentions Wealth, read wealth.md"*, it
becomes *"embed the question, return the five closest chunks from anywhere in the vault."*

That reframing matters for how you talk about this. You did not skip RAG out of
ignorance — you built a **deterministic, zero-cost retrieval layer** (tags, wikilinks,
folder routing, a graph) that works well for a vault you wrote yourself and know by
heart. The honest gap is that it requires *you* to have done the linking. Vectors find
what you forgot to link.

### The three retrieval strategies you'll then have

| Layer | Finds | Cost | Fails when |
|---|---|---|---|
| Tags + folders | What you deliberately classified | Free | You forgot to tag it |
| Wikilink graph | What you explicitly connected | Free | You never linked it |
| **Vector search** | What is *about* the same thing | ~free to run | Query is a proper noun or exact string |

That last row is the real argument for keeping all three. Vector search is genuinely bad
at exact identifiers — searching `trig_01Mr2rcFV2ovYXxr8LSX2TD3` semantically returns
noise, while `grep` finds it instantly. Production systems run **hybrid search**: vector
similarity for meaning plus keyword/full-text for exact matches, results merged. Immich's
DB has `pg_trgm` installed alongside `vector` for exactly this reason.

---

## 5. Design decisions

### Where it goes

**Pineapple OS backend.** Not a new project. The reasons are concrete:

- `graphBuild.ts` **already walks the vault** — same folders, same exclusions, same
  frontmatter parsing. The ingestion half is written and tested.
- It already runs on a schedule (`pineapple-graph-rebuild.timer`) with a single-flight
  lock and a manual rebuild endpoint. The scheduling half is written too.
- The repo is already public, so the work is visible.
- The graph UI is the natural place to surface a "related notes" result.

### Which database

**Supabase Postgres**, the project Pineapple OS already authenticates against. `vector`
is available as an extension — enable it and you are done. No new infrastructure, no new
credentials, no new container.

The alternative — a Postgres container on the VPS — is worth *not* doing. It adds a
service to run, back up and patch, in exchange for nothing this needs.

### Which embedding model

Two viable paths. **Start with Voyage.**

| | Voyage `voyage-4-lite` | Local `all-MiniLM-L6-v2` |
|---|---|---|
| Quality | Higher | Adequate |
| Cost | Fractions of a cent for the whole vault | Free |
| Setup | API key | A container + model download |
| Privacy | Note text leaves your infrastructure | Nothing leaves the VPS |
| Speed on 2 vCPU | Instant (their compute) | ~2–4 min for a full rebuild |

Voyage is one env var and better quality, and the whole corpus costs less than a cent to
embed. `voyage-4-lite` returns 1024 dimensions by default.

**But start with a non-sensitive subset regardless of provider.** Scope v1 to `wiki/`,
`logs/` and `memory/` — your own technical writing. Explicitly exclude `projects/
Lighthouse`, `projects/HealthVault`, `projects/Wealth`, `projects/Credit Card Analysis`
and `Raghav Agent/grandad-book`. That is the right call on privacy grounds, and it also
keeps the demo corpus tight.

If you later want the sensitive folders included, switch to the local model and nothing
leaves the box. Structure the code so the embedder is one swappable function — that
choice should be a config change, not a rewrite.

### Chunking

Do not embed whole files. A 400-line log note covers six unrelated things, and averaging
all of it into one vector produces a blurry meaningless point.

**Split on markdown headings**, then hard-split anything still over ~1500 characters.
Heading sections are already semantically coherent — your logs are written as
`## Context`, `## Decisions`, `## Delivered`. The document structure is doing the work
for you, which is a nice consequence of writing structured notes for years.

Keep a small overlap (~100 chars) between hard-split pieces so a sentence spanning a
boundary is not lost.

---

## 6. The schema

```sql
create extension if not exists vector;

create table vault_chunks (
  id           bigserial primary key,
  path         text        not null,          -- 'logs/2026/09/2026-09-01-....md'
  heading      text,                          -- '## Design decisions'
  chunk_index  int         not null,          -- 0,1,2... within the file
  content      text        not null,          -- the chunk text itself
  content_hash text        not null,          -- sha256, to skip unchanged chunks
  tags         text[]      default '{}',      -- frontmatter tags, for filtering
  embedding    vector(1024),                  -- voyage-4-lite default dimension
  updated_at   timestamptz default now(),
  unique (path, chunk_index)
);

create index on vault_chunks (path);
create index on vault_chunks using gin (tags);
-- No vector index yet. ~900 rows does not need one. Revisit past ~10k.
```

`content_hash` is the piece that keeps re-runs cheap: on rebuild, hash each chunk and
only call the embedding API for chunks whose hash changed. A nightly rebuild after
editing two notes should embed two chunks, not nine hundred.

`tags` earns its place by letting you combine both worlds in one query — *"notes
semantically near this question, **and** tagged `pineapple-os`"* is a plain `WHERE`
clause next to the `ORDER BY`. That is the practical advantage of vectors living in your
real database instead of a separate vector store: you can filter on ordinary columns in
the same query.

---

## 7. Phases

Each phase is independently verifiable and independently committable.

### Phase 1 — Schema + ingestion (no search yet)

- Enable `vector` in Supabase; create `vault_chunks`.
- New `backend/src/vectorIngest.ts`. **Reuse the file walker from `graphBuild.ts`** —
  extract the shared directory-walk into a small module rather than copy-pasting it.
- Chunk on headings, hard-split >1500 chars with ~100-char overlap.
- Hash each chunk; embed only new or changed ones; upsert on `(path, chunk_index)`.
- Delete rows whose source file no longer exists.
- Scope: `wiki/`, `logs/`, `memory/` only. Exclusion list for sensitive project folders.

**Verify:** `select count(*) from vault_chunks where embedding is not null;` returns a
few hundred. Run it twice — the second run should embed ~0 chunks and finish in seconds.
That second run is the real test; if it re-embeds everything, hashing is broken.

### Phase 2 — Search endpoint

- `POST /api/vault/search { query, limit, tags? }` on the existing authenticated router.
- Embed the query with `input_type: "query"` (Voyage distinguishes queries from
  documents and it measurably improves results — do not skip this).
- `ORDER BY embedding <=> $1 LIMIT $2`, optional `WHERE tags && $3`.
- Return path, heading, a snippet, and the distance score.

**Verify:** search a phrase that appears nowhere verbatim in the vault — "why did the
terminal keep reconnecting" — and confirm the Pineapple input-lag log comes back. If a
keyword query would have found it too, the test proves nothing; the whole point is
retrieval without shared words.

### Phase 3 — Surface it in the UI

- Search box in `GraphView.tsx`; matching nodes highlight, the rest dim.
- "Related notes" panel on node select — nearest neighbours of that note's own vector,
  which is the payoff: **suggested links you never made.**
- Distinguish the two edge types visually (wikilink = solid, semantic = dashed) so the
  graph stays honest about which connections you authored and which were inferred.

**Verify:** open a note, confirm the related panel surfaces something genuinely relevant
that has no wikilink to it. Screenshot that for the README — it is the single clearest
demonstration of what this adds.

### Phase 4 — Ask the vault (this is the RAG part)

Phases 1–3 are retrieval. This adds generation.

- `POST /api/vault/ask { question }`.
- Retrieve top ~8 chunks, concatenate with their paths as source labels.
- Send to Claude (`claude-opus-5`) with a system prompt: answer **only** from the
  provided notes, cite the path of each note used, and say plainly when the notes do not
  contain the answer.
- Return the answer plus the source list so every claim is traceable back to a file.

**Verify:** ask something answerable only by combining two notes that are not linked to
each other. Then ask something the vault genuinely does not cover and confirm it says so
rather than inventing an answer. **The second test matters more than the first** — a RAG
system that confabulates when retrieval misses is worse than no RAG system, and being
able to say you tested for that is worth more in an interview than the happy path.

### Phase 5 — Schedule + document

- Extend `rebuild-graph.sh` / the systemd timer to run the vector ingest after the graph
  build. One nightly job, two outputs.
- README section with an architecture diagram and the Phase 3 screenshot.

---

## 8. Cost

The whole corpus is ~1.5 MB of markdown, call it ~400k tokens. Embedding that once with
`voyage-4-lite` costs a fraction of a cent. Incremental rebuilds embed only changed
chunks, so ongoing cost rounds to zero.

The Claude call in Phase 4 is the only recurring cost and it is per-question, on the
order of 8 chunks of context.

---

## 8b. Phase 4 is parked until local inference (2026-09-01)

`/api/vault/ask` is committed and typechecks, but has never been run: the Anthropic key on
the VPS is valid and unfunded, OpenRouter is exhausted, and a Claude subscription bills
separately from the Messages API so it cannot fund these calls.

**No API credit is being bought.** A **Mac Mini M6 arrives end of September 2026**, which
will run a simple local model exposing an API key. Paying per token now would spend on a
gap that closes in weeks, and local inference keeps vault text on Sid's own hardware —
consistent with the Phase 1 decision to embed locally.

When it is live: point `ANTHROPIC_BASE_URL` at it (or swap the client in `vaultAsk.ts`) and
run both Phase 4 tests. Note that a small local model is *more* likely to confabulate on a
retrieval miss than Claude, so the refusal test matters more, not less, on that hardware.

What was already verified without a provider: retrieval returns the full answer for an
answerable question (0.688–0.754) and, for "what is my cat called", returns eight plainly
irrelevant notes topping out at 0.504 with nothing fabricated. The prompt inputs are sound;
the SDK call and the model's obedience to the refusal instruction are what remain untested.

Phases 1–3 and 5 need no LLM and are unaffected.

---

## 9. Known limits — state these rather than hide them

1. **Bad at exact strings.** Trigger IDs, error codes, filenames. Keep grep; consider
   hybrid search with `pg_trgm` if it becomes annoying.
2. **No vector index.** Deliberate at this corpus size; revisit past ~10k chunks.
3. **Chunk boundaries lose context.** A chunk saying "this fixed it" may not carry what
   "it" was. Voyage's `voyage-context-4` addresses this specifically by embedding chunks
   with document context — worth evaluating if quality disappoints.
4. **Note text leaves the VPS** with the hosted embedder. Mitigated by scoping to
   non-sensitive folders; fully solved by switching to the local model.
5. **Retrieval quality is unmeasured.** There is no eval set. Building one — 20 questions
   with known-correct source notes — is the honest next step before claiming it "works."
