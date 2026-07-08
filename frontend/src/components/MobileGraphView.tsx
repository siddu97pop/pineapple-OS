import { useState, useEffect, useRef, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { getVaultGraph, type VaultGraphData, type GraphNode } from '../lib/api'
import { cssRGB } from '../lib/graphColors'

const COMMUNITY_VARS = [
  '--c-accent', '--c-success', '--c-warning', '--c-error', '--c-accent-bright', '--c-accent-dim',
]

interface MobileGraphViewProps {
  className?: string
}

// Read-only pan/zoom graph for mobile — no rebuild, search, or note-opening.
export function MobileGraphView({ className = '' }: MobileGraphViewProps) {
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

  const communityColors = useMemo(() => {
    const names = [...new Set((graph?.nodes ?? []).map(n => n.community))].sort()
    const map = new Map<string, string>()
    names.forEach((name, i) => map.set(name, cssRGB(COMMUNITY_VARS[i % COMMUNITY_VARS.length])))
    return map
  }, [graph])

  // Canvas can't resolve CSS variables — resolve to concrete colors up front.
  const linkColor = useMemo(() => cssRGB('--c-border'), [graph])

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-navy-600/50 flex-shrink-0">
        <span className="section-label">graph</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {!graph && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            Loading graph...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-600">
            {error}
          </div>
        )}
        {graph && (
          <ForceGraph2D
            width={dims.width}
            height={dims.height}
            graphData={{ nodes: graph.nodes, links: graph.edges.map(e => ({ ...e })) }}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={3}
            nodeVal={(n: GraphNode) => 1 + Math.sqrt(n.degree)}
            nodeColor={(n: GraphNode) => communityColors.get(n.community) ?? '#888'}
            nodeLabel={(n: GraphNode) => n.label}
            linkColor={() => linkColor}
            linkWidth={1}
            enableNodeDrag={false}
            cooldownTicks={80}
          />
        )}
      </div>
    </div>
  )
}
