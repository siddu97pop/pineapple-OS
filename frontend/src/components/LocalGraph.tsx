import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Waypoints } from 'lucide-react'
import { getVaultGraph, type VaultGraphData, type GraphNode } from '../lib/api'
import { cssRGB } from '../lib/graphColors'

interface LocalGraphProps {
  openNotePath: string
  onOpenNote: (path: string) => void
  className?: string
}

// 1–2 hop neighborhood of `rootId`, client-side filter of the cached graph.
function neighborhoodOf(graph: VaultGraphData, rootId: string, hops = 2): { nodes: GraphNode[]; links: { source: string; target: string }[] } {
  const keep = new Set<string>([rootId])
  let frontier = new Set<string>([rootId])
  for (let i = 0; i < hops; i++) {
    const next = new Set<string>()
    for (const e of graph.edges) {
      if (frontier.has(e.source) && !keep.has(e.target)) next.add(e.target)
      if (frontier.has(e.target) && !keep.has(e.source)) next.add(e.source)
    }
    next.forEach(id => keep.add(id))
    frontier = next
  }
  const nodes = graph.nodes.filter(n => keep.has(n.id))
  const links = graph.edges
    .filter(e => keep.has(e.source) && keep.has(e.target))
    .map(e => ({ source: e.source, target: e.target }))
  return { nodes, links }
}

export function LocalGraph({ openNotePath, onOpenNote, className = '' }: LocalGraphProps) {
  const [graph, setGraph] = useState<VaultGraphData | null>(null)
  const [error, setError] = useState('')
  const [dims, setDims] = useState({ width: 300, height: 300 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getVaultGraph().then(setGraph).catch(() => setError('Failed to load graph'))
  }, [])

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

  const local = useMemo(() => {
    if (!graph || !openNotePath) return null
    if (!graph.nodes.some(n => n.id === openNotePath)) return null
    return neighborhoodOf(graph, openNotePath)
  }, [graph, openNotePath])

  // Canvas can't resolve CSS variables — resolve to concrete colors up front.
  const colors = useMemo(() => ({
    root: cssRGB('--c-accent-bright'),
    node: cssRGB('--c-accent'),
    link: cssRGB('--c-border'),
  }), [graph])

  const handleClick = useCallback((n: GraphNode) => {
    if (n.id !== openNotePath && !n.id.startsWith('tag:')) onOpenNote(n.id)
  }, [openNotePath, onOpenNote])

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-navy-600/50 flex-shrink-0">
        <span className="section-label">local graph</span>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {!openNotePath && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Waypoints size={20} className="text-slate-700" />
            <p className="text-xs text-slate-600 font-mono">open a note to see its neighborhood</p>
          </div>
        )}

        {openNotePath && error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">{error}</div>
        )}

        {openNotePath && !error && !local && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            Loading...
          </div>
        )}

        {openNotePath && local && local.nodes.length <= 1 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            No linked notes
          </div>
        )}

        {openNotePath && local && local.nodes.length > 1 && (
          <ForceGraph2D
            width={dims.width}
            height={dims.height}
            graphData={{ nodes: local.nodes, links: local.links.map(l => ({ ...l })) }}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={3}
            nodeVal={(n: GraphNode) => (n.id === openNotePath ? 4 : 1 + Math.sqrt(n.degree))}
            nodeLabel={(n: GraphNode) => n.label}
            nodeColor={(n: GraphNode) => n.id === openNotePath ? colors.root : colors.node}
            linkColor={() => colors.link}
            linkWidth={1}
            onNodeClick={handleClick}
            cooldownTicks={80}
          />
        )}
      </div>
    </div>
  )
}
