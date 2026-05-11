import { useState, useRef, useCallback, useEffect } from 'react'
import { NavBar } from '../components/NavBar'
import { WidgetBar } from '../components/WidgetBar'
import { TerminalTabs } from '../components/TerminalTabs'
import { SessionsFeed } from '../components/SessionsFeed'
import { ClaudeMdEditor } from '../components/ClaudeMdEditor'
import { DotGrid } from '../components/DotGrid'

const SIDEBAR_MIN = 280
const SIDEBAR_MAX = 620
const SIDEBAR_DEFAULT = 360
const STORAGE_KEY = 'pineapple-sidebar-width'

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

export function Dashboard() {
  const [tabCount, setTabCount] = useState(1)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = sidebarWidth
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
          className="w-2 flex-shrink-0 flex items-center justify-center cursor-col-resize group"
          onMouseDown={onResizerMouseDown}
        >
          <div className="w-px h-full bg-navy-600/40 group-hover:bg-electric/40 transition-colors" />
        </div>

        {/* Right sidebar */}
        <div
          className="flex-shrink-0 flex flex-col gap-3 min-h-0 py-3 pl-1"
          style={{ width: sidebarWidth }}
        >
          <div className="flex-1 min-h-0">
            <SessionsFeed />
          </div>
          <div className="h-64 flex-shrink-0">
            <ClaudeMdEditor />
          </div>
        </div>
      </main>
    </div>
  )
}
