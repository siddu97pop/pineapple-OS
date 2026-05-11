import { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FileText, FileCode2, FileJson, TerminalSquare, File, Loader2,
} from 'lucide-react'
import { getVaultTree, type TreeNode } from '../lib/api'

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md') return <FileText size={12} className="text-slate-500 flex-shrink-0" />
  if (ext === 'json') return <FileJson size={12} className="text-slate-500 flex-shrink-0" />
  if (ext === 'sh' || ext === 'ts' || ext === 'tsx' || ext === 'js') return <FileCode2 size={12} className="text-slate-500 flex-shrink-0" />
  if (name === 'Procfile' || ext === 'env') return <TerminalSquare size={12} className="text-slate-500 flex-shrink-0" />
  return <File size={12} className="text-slate-500 flex-shrink-0" />
}

// Flat map: dirPath → children. '' = vault root.
type ChildMap = Map<string, TreeNode[]>

function populateChildMap(nodes: TreeNode[], map: ChildMap, parentPath: string) {
  map.set(parentPath, nodes)
  for (const node of nodes) {
    if (node.type === 'dir' && node.children !== undefined) {
      populateChildMap(node.children, map, node.path)
    }
  }
}

interface NodeRowProps {
  node: TreeNode
  depth: number
  childMap: ChildMap
  expanded: Set<string>
  loading: Set<string>
  openFilePath: string
  onToggle: (node: TreeNode) => void
  onOpenFile: (path: string) => void
}

function NodeRow({ node, depth, childMap, expanded, loading, openFilePath, onToggle, onOpenFile }: NodeRowProps) {
  const isExpanded = expanded.has(node.path)
  const isLoading = loading.has(node.path)
  const isActive = node.path === openFilePath
  const indent = depth * 12

  if (node.type === 'file') {
    return (
      <div
        className="flex items-center gap-1.5 py-[3px] pr-2 rounded cursor-pointer text-xs transition-colors group"
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={() => onOpenFile(node.path)}
        title={node.path}
      >
        <FileIcon name={node.name} />
        <span
          className={`truncate font-mono transition-colors ${isActive
            ? 'text-electric'
            : 'text-slate-400 group-hover:text-slate-200'
          }`}
          style={isActive ? { textShadow: '0 0 8px rgba(14,165,233,0.4)' } : {}}
        >
          {node.name}
        </span>
      </div>
    )
  }

  // Directory
  const children = childMap.get(node.path)
  const hasKnownChildren = children !== undefined
  const FolderIcon = isExpanded ? FolderOpen : Folder

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-[3px] pr-2 rounded cursor-pointer text-xs text-slate-300 hover:text-slate-100 hover:bg-navy-700/30 transition-colors"
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={() => onToggle(node)}
      >
        <span className="w-3 flex-shrink-0 flex items-center justify-center text-slate-600">
          {isLoading
            ? <Loader2 size={10} className="animate-spin" />
            : isExpanded
              ? <ChevronDown size={10} />
              : <ChevronRight size={10} />
          }
        </span>
        <FolderIcon size={12} className="text-slate-500 flex-shrink-0" />
        <span className="truncate font-mono">{node.name}</span>
      </div>

      {isExpanded && hasKnownChildren && (
        <div>
          {children.length === 0 ? (
            <div
              className="text-[10px] text-slate-700 font-mono py-0.5"
              style={{ paddingLeft: `${indent + 20}px` }}
            >
              empty
            </div>
          ) : (
            children.map(child => (
              <NodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                childMap={childMap}
                expanded={expanded}
                loading={loading}
                openFilePath={openFilePath}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface VaultTreeProps {
  openFilePath: string
  onOpenFile: (path: string) => void
  className?: string
}

export function VaultTree({ openFilePath, onOpenFile, className = '' }: VaultTreeProps) {
  const [childMap, setChildMap] = useState<ChildMap>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [initError, setInitError] = useState(false)
  const [initLoading, setInitLoading] = useState(true)

  useEffect(() => {
    getVaultTree('', 2)
      .then(data => {
        const map: ChildMap = new Map()
        populateChildMap(data.children, map, '')
        setChildMap(map)
        setInitLoading(false)
      })
      .catch(() => {
        setInitError(true)
        setInitLoading(false)
      })
  }, [])

  const handleToggle = useCallback(async (node: TreeNode) => {
    const path = node.path

    if (expanded.has(path)) {
      setExpanded(prev => { const s = new Set(prev); s.delete(path); return s })
      return
    }

    setExpanded(prev => new Set([...prev, path]))

    // Lazy-load children if not yet fetched
    if (!childMap.has(path)) {
      setLoading(prev => new Set([...prev, path]))
      try {
        const data = await getVaultTree(path, 1)
        setChildMap(prev => {
          const next = new Map(prev)
          populateChildMap(data.children, next, path)
          return next
        })
      } catch {}
      setLoading(prev => { const s = new Set(prev); s.delete(path); return s })
    }
  }, [childMap, expanded])

  const rootNodes = childMap.get('') ?? []

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-navy-600/50 flex-shrink-0">
        <span className="section-label">vault</span>
        {initLoading && <span className="text-[10px] text-slate-600 font-mono animate-pulse">loading…</span>}
        {initError && <span className="text-[10px] text-red-500 font-mono">error</span>}
      </div>

      <div className="flex-1 overflow-y-auto py-1 pr-1">
        {rootNodes.map(node => (
          <NodeRow
            key={node.path}
            node={node}
            depth={0}
            childMap={childMap}
            expanded={expanded}
            loading={loading}
            openFilePath={openFilePath}
            onToggle={handleToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  )
}
