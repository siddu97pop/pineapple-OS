import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal } from './Terminal'

interface Tab {
  id: string
  label: string
}

interface TabsState {
  tabs: Tab[]
  activeId: string
}

let tabSeq = 0

function makeTab(): Tab {
  tabSeq++
  return { id: crypto.randomUUID(), label: `bash ${tabSeq}` }
}

const MAX_TABS = 5

interface TerminalTabsProps {
  className?: string
  onTabCountChange?: (count: number) => void
}

export function TerminalTabs({ className = '', onTabCountChange }: TerminalTabsProps) {
  const [{ tabs, activeId }, setState] = useState<TabsState>(() => {
    const first = makeTab()
    return { tabs: [first], activeId: first.id }
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onTabCountChange?.(tabs.length)
  }, [tabs.length, onTabCountChange])

  const addTab = useCallback(() => {
    setState(s => {
      if (s.tabs.length >= MAX_TABS) return s
      const tab = makeTab()
      return { tabs: [...s.tabs, tab], activeId: tab.id }
    })
  }, [])

  const closeTab = useCallback((id: string) => {
    setState(s => {
      if (s.tabs.length <= 1) return s
      const idx = s.tabs.findIndex(t => t.id === id)
      const next = s.tabs.filter(t => t.id !== id)
      const newActiveId = s.activeId === id
        ? (next[Math.max(0, idx - 1)] ?? next[0])?.id ?? ''
        : s.activeId
      return { tabs: next, activeId: newActiveId }
    })
  }, [])

  const setActiveId = useCallback((id: string) => {
    setState(s => ({ ...s, activeId: id }))
  }, [])

  const startEdit = useCallback((id: string, label: string) => {
    setEditingId(id)
    setEditValue(label)
    setTimeout(() => editInputRef.current?.select(), 0)
  }, [])

  const commitEdit = useCallback(() => {
    if (!editingId) return
    const trimmed = editValue.trim()
    if (trimmed) {
      setState(s => ({
        ...s,
        tabs: s.tabs.map(t => t.id === editingId ? { ...t, label: trimmed } : t),
      }))
    }
    setEditingId(null)
  }, [editingId, editValue])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        addTab()
      } else if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault()
        setState(s => {
          if (s.tabs.length <= 1) return s
          const idx = s.tabs.findIndex(t => t.id === s.activeId)
          const next = s.tabs.filter(t => t.id !== s.activeId)
          const newActive = (next[Math.max(0, idx - 1)] ?? next[0])?.id ?? ''
          return { tabs: next, activeId: newActive }
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [addTab])

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      {/* Tab bar */}
      <div
        className="flex items-end gap-0.5 px-2 pt-1.5 flex-shrink-0 border-b border-navy-600/50"
        style={{ background: 'rgba(13,22,41,0.6)', minHeight: '36px' }}
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className="group relative flex items-center gap-1 px-3 py-1 rounded-t-lg cursor-pointer select-none transition-all duration-150"
              style={{
                background: isActive
                  ? 'linear-gradient(to bottom, #162040, #0d1629)'
                  : 'transparent',
                borderBottom: isActive ? '2px solid #0ea5e9' : '2px solid transparent',
                boxShadow: isActive
                  ? '0 2px 10px rgba(14,165,233,0.2), inset 0 1px 0 rgba(14,165,233,0.08)'
                  : 'none',
                color: isActive ? '#e2e8f0' : '#64748b',
              }}
              onClick={() => { if (editingId !== tab.id) setActiveId(tab.id) }}
            >
              {editingId === tab.id ? (
                <input
                  ref={editInputRef}
                  className="bg-transparent outline-none text-xs font-mono text-slate-200 w-20"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                    e.stopPropagation()
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className="text-xs font-mono truncate max-w-[110px]"
                  onDoubleClick={e => { e.stopPropagation(); startEdit(tab.id, tab.label) }}
                  title={tab.label}
                >
                  {tab.label}
                </span>
              )}
              {tabs.length > 1 && (
                <button
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all flex-shrink-0 cursor-pointer"
                  onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                  title="Close tab"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </div>
          )
        })}

        {tabs.length < MAX_TABS && (
          <button
            className="flex items-center justify-center w-6 h-6 mb-0.5 rounded text-slate-600 hover:text-slate-300 hover:bg-navy-700 transition-all self-center cursor-pointer"
            onClick={addTab}
            title="New tab (Ctrl+Shift+T)"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        )}

        <div className="flex-1" />
        <span className="text-[10px] text-slate-700 self-center pr-2 mb-0.5 font-mono hidden xl:block">
          Ctrl+Shift+T/W
        </span>
      </div>

      {/* Terminal panels — all kept mounted so PTY sessions survive tab switches */}
      <div className="flex-1 relative min-h-0">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeId ? 'block' : 'none' }}
          >
            <Terminal
              className="h-full rounded-none border-0 shadow-none"
              isActive={tab.id === activeId}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
