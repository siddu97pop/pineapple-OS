import { useState, useRef, useCallback, useEffect } from 'react'
import { NavBar } from '../components/NavBar'
import { WidgetBar } from '../components/WidgetBar'
import { TerminalTabs } from '../components/TerminalTabs'
import { SessionsFeed } from '../components/SessionsFeed'
import { VaultTree } from '../components/VaultTree'
import { VaultEditor, type OpenFile } from '../components/VaultEditor'
import { AgentMonitor } from '../components/AgentMonitor'
import { CheckpointQueue } from '../components/CheckpointQueue'
import { MobileDashboard } from '../components/MobileDashboard'
import { DotGrid } from '../components/DotGrid'
import { GripVertical } from 'lucide-react'
import { getVaultFile } from '../lib/api'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}

const SIDEBAR_MIN = 280
const SIDEBAR_MAX = 680
const SIDEBAR_DEFAULT = 380
const STORAGE_KEY = 'pineapple-sidebar-width'
const SIDEBAR_TAB_KEY = 'pineapple-sidebar-tab'

type SidebarTab = 'sessions' | 'files' | 'agents'

function loadSidebarWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v) {
      const n = parseInt(v, 10)
      if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n
    }
  } catch {}
  return SIDEBAR_DEFAULT
}

function loadSidebarTab(): SidebarTab {
  try {
    const v = localStorage.getItem(SIDEBAR_TAB_KEY)
    if (v === 'sessions' || v === 'files' || v === 'agents') return v
  } catch {}
  return 'sessions'
}

export function Dashboard() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileDashboard /> : <DesktopDashboard />
}

function DesktopDashboard() {
  const [tabCount, setTabCount] = useState(1)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(loadSidebarTab)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFileIdx, setActiveFileIdx] = useState(0)
  const [pendingCheckpoints, setPendingCheckpoints] = useState(0)
  const [resizing, setResizing] = useState(false)

  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  // Persist sidebar tab
  const switchTab = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab)
    try { localStorage.setItem(SIDEBAR_TAB_KEY, tab) } catch {}
  }, [])

  // Resizer
  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = sidebarWidth
    setResizing(true)
    e.preventDefault()
  }, [sidebarWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = dragStartXRef.current - e.clientX
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidthRef.current + delta))
      setSidebarWidth(next)
    }
    const onMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setResizing(false)
      setSidebarWidth(prev => {
        try { localStorage.setItem(STORAGE_KEY, String(prev)) } catch {}
        return prev
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Open a vault file in the editor
  const handleOpenFile = useCallback(async (relPath: string) => {
    const existing = openFilesRef.current.findIndex(f => f.path === relPath)
    if (existing !== -1) {
      setActiveFileIdx(existing)
      switchTab('files')
      return
    }

    // Add placeholder while loading
    const label = relPath.split('/').pop() ?? relPath
    const placeholder: OpenFile = { path: relPath, label, content: '', savedContent: '' }
    setOpenFiles(prev => {
      const next = [...prev, placeholder]
      setActiveFileIdx(next.length - 1)
      return next
    })
    switchTab('files')

    try {
      const data = await getVaultFile(relPath)
      setOpenFiles(prev =>
        prev.map(f => f.path === relPath
          ? { ...f, content: data.content, savedContent: data.content }
          : f
        )
      )
    } catch {
      // Remove placeholder on error
      setOpenFiles(prev => {
        const next = prev.filter(f => f.path !== relPath)
        setActiveFileIdx(i => Math.min(i, Math.max(0, next.length - 1)))
        return next
      })
    }
  }, [switchTab])

  const handleCloseFile = useCallback((idx: number) => {
    setOpenFiles(prev => {
      const next = prev.filter((_, i) => i !== idx)
      setActiveFileIdx(cur => {
        if (cur < idx) return cur
        if (cur > idx) return cur - 1
        return Math.max(0, idx - 1)
      })
      return next
    })
  }, [])

  const handleChangeContent = useCallback((idx: number, content: string) => {
    setOpenFiles(prev => prev.map((f, i) => i === idx ? { ...f, content } : f))
  }, [])

  const handleSetSaving = useCallback((idx: number) => {
    setOpenFiles(prev => prev.map((f, i) => i === idx ? { ...f, saving: true, saveError: false } : f))
  }, [])

  const handleSaveResult = useCallback((idx: number, saved: boolean, error?: boolean) => {
    setOpenFiles(prev => prev.map((f, i) => {
      if (i !== idx) return f
      return saved
        ? { ...f, savedContent: f.content, saving: false, saveError: false }
        : { ...f, saving: false, saveError: !!error }
    }))
    // Clear error indicator after 3s
    if (error) {
      setTimeout(() => {
        setOpenFiles(prev => prev.map((f, i) => i === idx ? { ...f, saveError: false } : f))
      }, 3000)
    }
  }, [])

  // Browser title badge for pending checkpoints
  useEffect(() => {
    document.title = pendingCheckpoints > 0
      ? `[${pendingCheckpoints}] Pineapple OS`
      : 'Pineapple OS'
  }, [pendingCheckpoints])

  const activeFilePath = openFiles[activeFileIdx]?.path ?? ''

  return (
    <div className="h-screen overflow-hidden">
      <DotGrid />
      <NavBar />
      <WidgetBar tabCount={tabCount} />

      {/* pt-[88px] = NavBar(48) + WidgetBar(40) */}
      <main className="pt-[88px] h-screen flex overflow-hidden px-3 pb-3 gap-0">
        {/* Terminal area */}
        <div className="flex-1 min-w-0 min-h-0 py-3 pr-0">
          <TerminalTabs className="h-full" onTabCountChange={setTabCount} />
        </div>

        {/* Drag resizer */}
        <div
          className="w-4 flex-shrink-0 flex items-center justify-center cursor-col-resize group"
          onMouseDown={onResizerMouseDown}
        >
          <div className="flex flex-col items-center h-full relative">
            <div className="absolute inset-y-0 w-px bg-navy-600/30 group-hover:bg-electric/30 transition-colors left-1/2 -translate-x-1/2" />
            <GripVertical
              size={14}
              className="relative mt-auto mb-auto text-slate-700 group-hover:text-electric/60 transition-colors"
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div
          className="flex-shrink-0 flex flex-col min-h-0 py-3 pl-1"
          style={{
            width: sidebarWidth,
            transition: resizing ? 'none' : 'width 0.15s ease-out',
          }}
        >
          {/* Sidebar tab bar */}
          <div className="flex gap-1 mb-2 flex-shrink-0">
            {(['sessions', 'files', 'agents'] as SidebarTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className="px-3 py-1 rounded-md text-xs font-mono capitalize transition-all flex items-center gap-1.5"
                style={{
                  background: sidebarTab === tab ? '#0ea5e920' : 'transparent',
                  color: sidebarTab === tab ? '#0ea5e9' : '#64748b',
                  border: `1px solid ${sidebarTab === tab ? '#0ea5e940' : 'transparent'}`,
                }}
              >
                {tab}
                {tab === 'agents' && pendingCheckpoints > 0 && (
                  <span
                    className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {pendingCheckpoints}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sessions panel */}
          {sidebarTab === 'sessions' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3 animate-fade-in">
              <div className="flex-1 min-h-0">
                <SessionsFeed />
              </div>
              <div className="h-64 flex-shrink-0">
                <VaultEditor
                  files={openFiles}
                  activeIdx={activeFileIdx}
                  onActivate={setActiveFileIdx}
                  onClose={handleCloseFile}
                  onChangeContent={handleChangeContent}
                  onSetSaving={handleSetSaving}
                  onSaveResult={handleSaveResult}
                  onQuickOpen={handleOpenFile}
                />
              </div>
            </div>
          )}

          {/* Files panel */}
          {sidebarTab === 'files' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3 animate-fade-in">
              <div className="h-56 flex-shrink-0">
                <VaultTree
                  openFilePath={activeFilePath}
                  onOpenFile={handleOpenFile}
                  className="h-full"
                />
              </div>
              <div className="flex-1 min-h-0">
                <VaultEditor
                  files={openFiles}
                  activeIdx={activeFileIdx}
                  onActivate={setActiveFileIdx}
                  onClose={handleCloseFile}
                  onChangeContent={handleChangeContent}
                  onSetSaving={handleSetSaving}
                  onSaveResult={handleSaveResult}
                  onQuickOpen={handleOpenFile}
                />
              </div>
            </div>
          )}

          {/* Agents panel */}
          {sidebarTab === 'agents' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3 animate-fade-in">
              <div className="flex-shrink-0" style={{ maxHeight: '45%', minHeight: 120 }}>
                <CheckpointQueue
                  className="h-full"
                  onPendingCount={setPendingCheckpoints}
                />
              </div>
              <div className="flex-1 min-h-0">
                <AgentMonitor className="h-full" />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
