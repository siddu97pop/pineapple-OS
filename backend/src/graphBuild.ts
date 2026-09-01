// Standalone graph build script — deterministic wikilink/frontmatter parser.
//
// Phase 0 note: graphifyy's `extract` command requires ANTHROPIC_API_KEY, which
// is not present anywhere on this VPS (checked ~/.claude/settings.json, env,
// backend/.env, secrets/master.env). Falling back to this free, no-LLM parser
// per the plan's documented fallback path.
//
// Scans wiki/, raw/, memory/, logs/, and markdown under projects/ (excluding
// node_modules, dist, .git, .trash, hidden dirs) for [[wikilinks]] and
// frontmatter aliases/related/links, and emits graph-cache/graph.json.
//
// Run directly: node dist/graphBuild.js
// (invoked by deploy/rebuild-graph.sh and by graph.ts's rebuild endpoint)

import fs from 'fs/promises'
import path from 'path'

import {
  VAULT_ROOT,
  SCOPED_TOP_DIRS,
  collectMarkdownFiles,
  parseFrontmatter,
} from './vaultWalk'

const GRAPH_CACHE_DIR = process.env.GRAPH_CACHE_DIR || '/opt/pineapple-api/graph-cache'
const GRAPH_JSON_PATH = path.join(GRAPH_CACHE_DIR, 'graph.json')

// Tags too generic to be useful hubs — they'd connect half the vault.
const EXCLUDED_TAGS = new Set(['log', 'project', 'wiki'])

export interface GraphNode {
  id: string
  label: string
  folder: string
  community: string
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
  confidence: number
  sourceType: 'wikilink' | 'tag'
}

export interface GraphCommunity {
  name: string
  nodeCount: number
}

export interface GraphMeta {
  builtAt: string
  nodeCount: number
  edgeCount: number
  communities: GraphCommunity[]
  buildMethod: 'wikilink-parser'
  buildMs: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta: GraphMeta
}

// Normalize a raw frontmatter tag to a canonical form; null = drop it.
function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')
  if (!tag || EXCLUDED_TAGS.has(tag)) return null
  return tag
}

const WIKILINK_RE = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]+)?\]\]/g

function extractWikilinkTargets(body: string): string[] {
  const targets: string[] = []
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1].trim()
    if (target) targets.push(target)
  }
  return targets
}

function topFolder(relPath: string): string {
  return relPath.split('/')[0]
}

export async function buildGraph(): Promise<GraphData> {
  const start = Date.now()
  const files: string[] = []

  for (const dir of SCOPED_TOP_DIRS) {
    await collectMarkdownFiles(path.join(VAULT_ROOT, dir), dir, files)
  }
  // projects/: markdown only, any depth, same exclusions
  await collectMarkdownFiles(path.join(VAULT_ROOT, 'projects'), 'projects', files)

  const nodes = new Map<string, GraphNode>()
  const labelIndex = new Map<string, string[]>() // lowercased label/alias/path -> node ids
  const parsed = new Map<string, { targets: string[]; tags: string[] }>()

  function indexLabel(lower: string, id: string): void {
    const arr = labelIndex.get(lower) || []
    if (!arr.includes(id)) arr.push(id)
    labelIndex.set(lower, arr)
  }

  for (const rel of files) {
    const abs = path.join(VAULT_ROOT, rel)
    let content: string
    try {
      content = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }
    const id = rel
    const label = path.basename(rel, '.md')
    const folder = topFolder(rel)
    nodes.set(id, { id, label, folder, community: folder, degree: 0 })
    indexLabel(label.toLowerCase(), id)
    // Index the full relative path (with and without .md) so `related:`
    // entries can use exact vault paths and stay unambiguous.
    indexLabel(id.toLowerCase(), id)
    indexLabel(id.toLowerCase().replace(/\.md$/, ''), id)

    const { fm, body } = parseFrontmatter(content)
    for (const alias of fm.aliases) indexLabel(alias.toLowerCase(), id)

    const targets = [...extractWikilinkTargets(body), ...fm.related]
    const tags = fm.tags.map(normalizeTag).filter((t): t is string => t !== null)
    parsed.set(id, { targets, tags })
  }

  function resolveTarget(raw: string): string | null {
    const cleaned = raw.trim().toLowerCase()
    const direct = labelIndex.get(cleaned)
    if (direct && direct.length > 0) return direct[0]
    // try matching by basename if the wikilink included a path
    const base = cleaned.split('/').pop() || cleaned
    const byBase = labelIndex.get(base)
    if (byBase && byBase.length > 0) return byBase[0]
    return null
  }

  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  for (const [id, { targets }] of parsed) {
    for (const raw of targets) {
      const targetId = resolveTarget(raw)
      if (!targetId || targetId === id) continue
      const key = `${id}\u0000${targetId}`
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      edges.push({ source: id, target: targetId, confidence: 1, sourceType: 'wikilink' })
    }
  }

  // Tag nodes: Obsidian-style — each (non-generic) tag becomes a node and
  // every note carrying it links to it.
  for (const [id, { tags }] of parsed) {
    for (const tag of tags) {
      const tagId = `tag:${tag}`
      if (!nodes.has(tagId)) {
        nodes.set(tagId, { id: tagId, label: `#${tag}`, folder: 'tags', community: 'tags', degree: 0 })
      }
      const key = `${id}\u0000${tagId}`
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      edges.push({ source: id, target: tagId, confidence: 1, sourceType: 'tag' })
    }
  }

  for (const e of edges) {
    const s = nodes.get(e.source)
    const t = nodes.get(e.target)
    if (s) s.degree += 1
    if (t) t.degree += 1
  }

  const communityCounts = new Map<string, number>()
  for (const n of nodes.values()) {
    communityCounts.set(n.community, (communityCounts.get(n.community) || 0) + 1)
  }
  const communities: GraphCommunity[] = [...communityCounts.entries()]
    .map(([name, nodeCount]) => ({ name, nodeCount }))
    .sort((a, b) => b.nodeCount - a.nodeCount)

  const buildMs = Date.now() - start

  return {
    nodes: [...nodes.values()],
    edges,
    meta: {
      builtAt: new Date().toISOString(),
      nodeCount: nodes.size,
      edgeCount: edges.length,
      communities,
      buildMethod: 'wikilink-parser',
      buildMs,
    },
  }
}

async function main(): Promise<void> {
  const graph = await buildGraph()
  await fs.mkdir(GRAPH_CACHE_DIR, { recursive: true })
  await fs.writeFile(GRAPH_JSON_PATH, JSON.stringify(graph, null, 2))
  console.log(`[graphBuild] wrote ${GRAPH_JSON_PATH}: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges in ${graph.meta.buildMs}ms`)
}

if (require.main === module) {
  main().catch(err => {
    console.error('[graphBuild] failed:', err)
    process.exit(1)
  })
}
