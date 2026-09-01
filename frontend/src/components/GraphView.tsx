import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject } from 'react-force-graph-2d'
import { Search, RefreshCw, Sparkles, X } from 'lucide-react'
import {
  getVaultGraph, rebuildVaultGraph, getGraphStatus, searchVault, getRelatedNotes,
  type VaultGraphData, type GraphNode, type SearchHit, type RelatedHit,
} from '../lib/api'
import { cssRGB } from '../lib/graphColors'

// Theme-consistent categorical palette — pulled from the CSS variables so it
// follows the Indigo/Brass toggle automatically.
const COMMUNITY_VARS = [
  '--c-accent', '--c-success', '--c-warning', '--c-error', '--c-accent-bright', '--c-accent-dim',
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface FGNode extends GraphNode {
  x?: number
  y?: number
}

interface GraphViewProps {
  onOpenNote: (path: string) => void
  className?: string
}

export function GraphView({ onOpenNote, className = '' }: GraphViewProps) {
  const [graph, setGraph] = useState<VaultGraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  // Semantic layer. `semanticPaths` drives node highlighting; the panel shows
  // either search hits or the related notes for a selected node.
  const [semantic, setSemantic] = useState(false)
  const [panelBusy, setPanelBusy] = useState(false)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [related, setRelated] = useState<{ path: string; results: RelatedHit[] } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<FGNode, LinkObject> | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const data = await getVaultGraph()
      setGraph(data)
      setError('')
    } catch {
      setError('Failed to load graph')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ width: Math.max(width, 100), height: Math.max(height, 100) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const communityColors = useMemo(() => {
    const names = [...new Set((graph?.nodes ?? []).map(n => n.community))].sort()
    const map = new Map<string, string>()
    names.forEach((name, i) => map.set(name, cssRGB(COMMUNITY_VARS[i % COMMUNITY_VARS.length])))
    return map
  }, [graph])

  // Canvas can't resolve CSS variables — resolve to concrete colors up front.
  const dimColor = useMemo(() => cssRGB('--c-faint', 0.25), [graph])
  const linkBaseColor = useMemo(() => cssRGB('--c-border'), [graph])

  const neighborIds = useMemo(() => {
    if (!hoverId || !graph) return null
    const set = new Set<string>([hoverId])
    for (const e of graph.edges) {
      if (e.source === hoverId) set.add(e.target)
      if (e.target === hoverId) set.add(e.source)
    }
    return set
  }, [hoverId, graph])

  const searchMatchId = useMemo(() => {
    if (!search.trim() || !graph) return null
    const q = search.trim().toLowerCase()
    const match = graph.nodes.find(n => n.label.toLowerCase().includes(q))
    return match?.id ?? null
  }, [search, graph])

  useEffect(() => {
    if (!searchMatchId || !fgRef.current) return
    fgRef.current.zoomToFit(600, 80, (n: FGNode) => n.id === searchMatchId)
  }, [searchMatchId])

  const semanticPaths = useMemo(() => {
    if (hits) return new Set(hits.map(h => h.path))
    if (related) return new Set([related.path, ...related.results.map(r => r.path)])
    return null
  }, [hits, related])

  const runSemanticSearch = useCallback(async () => {
    const q = search.trim()
    if (!q) return
    setPanelBusy(true)
    setRelated(null)
    try {
      const { results } = await searchVault(q, 10)
      setHits(results)
    } catch {
      setError('Semantic search failed')
    } finally {
      setPanelBusy(false)
    }
  }, [search])

  const showRelated = useCallback(async (path: string) => {
    setPanelBusy(true)
    setHits(null)
    try {
      const { results } = await getRelatedNotes(path, 8)
      setRelated({ path, results })
    } catch {
      setError('Related notes failed')
    } finally {
      setPanelBusy(false)
    }
  }, [])

  const clearPanel = useCallback(() => { setHits(null); setRelated(null) }, [])

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] }
    return {
      nodes: graph.nodes as FGNode[],
      links: graph.edges.map(e => ({ ...e })),
    }
  }, [graph])

  const handleRebuild = useCallback(async () => {
    setRebuilding(true)
    try {
      await rebuildVaultGraph()
      // Poll until the rebuild finishes, then reload the graph.
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const status = await getGraphStatus()
        if (status.state === 'done') { await load(); break }
        if (status.state === 'error') { setError(status.error || 'Rebuild failed'); break }
      }
    } catch {
      setError('Failed to trigger rebuild')
    } finally {
      setRebuilding(false)
    }
  }, [load])

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-navy-600/50 flex-shrink-0 flex items-center gap-3">
        <span className="section-label">graph</span>
        <div className="flex-1 flex items-center gap-1.5 max-w-xs">
          <Search size={12} className="text-slate-600 flex-shrink-0" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); if (!semantic) clearPanel() }}
            onKeyDown={e => { if (e.key === 'Enter' && semantic) runSemanticSearch() }}
            placeholder={semantic ? 'Ask by meaning, then Enter...' : 'Search notes...'}
            className="bg-transparent text-xs font-mono text-slate-300 placeholder:text-slate-600 outline-none w-full"
          />
        </div>
        <button
          onClick={() => { setSemantic(s => !s); clearPanel() }}
          title={semantic
            ? 'Semantic search: finds notes by meaning (Enter to run)'
            : 'Name search: matches note titles as you type'}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono transition-all"
          style={semantic ? {
            background: 'rgb(var(--c-accent) / 0.1)',
            color: 'rgb(var(--c-accent))',
            border: '1px solid rgb(var(--c-accent) / 0.25)',
          } : {
            color: 'rgb(var(--c-faint))',
            border: '1px solid rgb(var(--c-border))',
          }}
        >
          <Sparkles size={11} />
          {semantic ? 'meaning' : 'name'}
        </button>
        {graph && (
          <span className="text-[10px] font-mono text-slate-600">
            {graph.meta.nodeCount} nodes · {graph.meta.edgeCount} edges · built {timeAgo(graph.meta.builtAt)}
          </span>
        )}
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all disabled:opacity-50"
          style={{
            background: 'rgb(var(--c-accent) / 0.1)',
            color: 'rgb(var(--c-accent))',
            border: '1px solid rgb(var(--c-accent) / 0.25)',
          }}
        >
          <RefreshCw size={11} className={rebuilding ? 'animate-spin' : ''} />
          {rebuilding ? 'Rebuilding...' : 'Rebuild'}
        </button>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            Loading graph...
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            {error}
          </div>
        )}
        {!loading && !error && graph && (
          <ForceGraph2D
            ref={fgRef}
            width={dims.width}
            height={dims.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={(n: FGNode) => `${n.label} (${n.folder})`}
            nodeRelSize={3}
            nodeVal={(n: FGNode) => 1 + Math.sqrt(n.degree)}
            nodeColor={(n: FGNode) => {
              if (semanticPaths) return semanticPaths.has(n.id) ? (communityColors.get(n.community) ?? '#888') : dimColor
              if (neighborIds && !neighborIds.has(n.id)) return dimColor
              if (searchMatchId && n.id !== searchMatchId) return dimColor
              return communityColors.get(n.community) ?? '#888'
            }}
            linkColor={(l: LinkObject) => {
              const s = typeof l.source === 'object' ? (l.source as FGNode).id : l.source
              const t = typeof l.target === 'object' ? (l.target as FGNode).id : l.target
              if (neighborIds && !(neighborIds.has(s as string) && neighborIds.has(t as string))) return dimColor
              return linkBaseColor
            }}
            linkWidth={1}
            onNodeHover={(n: FGNode | null) => setHoverId(n?.id ?? null)}
            onNodeClick={(n: FGNode, ev: MouseEvent) => {
              if (n.id.startsWith('tag:')) return
              if (ev.altKey || ev.metaKey) showRelated(n.id)
              else onOpenNote(n.id)
            }}
            cooldownTicks={100}
          />
        )}

        {(hits || related || panelBusy) && (
          <div
            className="absolute top-2 right-2 bottom-2 w-72 overflow-y-auto rounded-md p-2 text-xs font-mono"
            style={{
              background: 'rgb(var(--c-bg) / 0.92)',
              border: '1px solid rgb(var(--c-border))',
              backdropFilter: 'blur(4px)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="section-label">
                {related ? 'related notes' : 'semantic hits'}
              </span>
              <button onClick={clearPanel} className="text-slate-600 hover:text-slate-300">
                <X size={12} />
              </button>
            </div>

            {related && (
              <p className="text-[10px] text-slate-600 mb-2 break-all">
                near {related.path}
              </p>
            )}
            {panelBusy && <p className="text-slate-600">Searching...</p>}
            {!panelBusy && (hits ?? related?.results ?? []).length === 0 && (
              <p className="text-slate-600">No matches.</p>
            )}

            {!panelBusy && (hits ?? related?.results ?? []).map((h, i) => (
              <button
                key={`${h.path}-${i}`}
                onClick={() => onOpenNote(h.path)}
                className="w-full text-left mb-2 pb-2 border-b border-navy-600/30 hover:opacity-80 transition-opacity"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-300 truncate">
                    {h.path.split('/').pop()}
                  </span>
                  <span style={{ color: 'rgb(var(--c-accent))' }}>
                    {h.similarity.toFixed(2)}
                  </span>
                </div>
                {h.heading && (
                  <div className="text-[10px] text-slate-500 truncate">{h.heading}</div>
                )}
                <div className="text-[10px] text-slate-600 line-clamp-2 mt-0.5">
                  {h.content.slice(0, 120)}
                </div>
              </button>
            ))}

            <p className="text-[10px] text-slate-600 mt-1">
              Alt-click a node for its related notes.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
