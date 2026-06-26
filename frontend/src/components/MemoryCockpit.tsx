import { useState, useEffect, useCallback } from 'react'
import { Brain, FileText, Clock, RefreshCw, AlertTriangle } from 'lucide-react'
import { getMemory, type MemoryFile, type MemoryTimelineItem } from '../lib/api'

const STALE_DAYS = 30

function relTime(ms: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function daysSince(dateStr: string): number {
  const t = Date.parse(dateStr + 'T00:00:00Z')
  if (isNaN(t)) return 0
  return Math.floor((Date.now() - t) / 86400000)
}

interface Props {
  className?: string
  onOpenFile: (path: string) => void
}

function StackCard({ file, onOpen }: { file: MemoryFile; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      disabled={!file.exists}
      className="w-full text-left rounded-lg border px-3 py-2.5 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ borderColor: 'rgb(var(--c-border) / 0.8)', background: 'rgb(var(--c-surface))' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={13} className="flex-shrink-0" style={{ color: 'rgb(var(--c-accent))' }} strokeWidth={1.8} />
          <span className="text-slate-200 font-semibold text-[13px] truncate group-hover:text-white">{file.label}</span>
        </div>
        <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'rgb(var(--c-faint))' }}>
          {file.exists ? relTime(file.mtime) : 'missing'}
        </span>
      </div>
      {file.exists && (
        <>
          <div className="mt-1 text-[11px] truncate" style={{ color: 'rgb(var(--c-muted))' }} title={file.preview}>
            {file.preview || <span className="italic">empty</span>}
          </div>
          <div className="mt-1 text-[9.5px] font-mono" style={{ color: 'rgb(var(--c-faint))' }}>
            {file.path} · {file.lines} lines
          </div>
        </>
      )}
    </button>
  )
}

function TimelineRow({ item, onOpen }: { item: MemoryTimelineItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left relative pl-4 py-1.5 group"
    >
      <span
        className="absolute left-0 top-[11px] w-[7px] h-[7px] rounded-full"
        style={{ background: 'rgb(var(--c-accent))' }}
      />
      <span
        className="absolute left-[3px] top-0 bottom-0 w-px"
        style={{ background: 'rgb(var(--c-border))' }}
      />
      <div className="text-[10px] font-mono" style={{ color: 'rgb(var(--c-faint))' }}>{item.date}</div>
      <div className="text-[12px] truncate group-hover:text-white" style={{ color: 'rgb(var(--c-text))' }}>{item.title}</div>
    </button>
  )
}

export function MemoryCockpit({ className = '', onOpenFile }: Props) {
  const [stack, setStack] = useState<MemoryFile[]>([])
  const [timeline, setTimeline] = useState<MemoryTimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await getMemory()
      setStack(data.stack || [])
      setTimeline(data.timeline || [])
      setError(false)
    } catch {
      setError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const lastLog = timeline[0]
  const staleDays = lastLog ? daysSince(lastLog.date) : 0
  const isStale = staleDays >= STALE_DAYS

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <span className="section-label flex items-center gap-1.5">
          <Brain size={12} strokeWidth={1.8} /> Memory
        </span>
        <button
          onClick={refresh}
          className="text-slate-600 hover:text-slate-300 transition-colors cursor-pointer"
          title="refresh"
          aria-label="refresh memory"
        >
          <RefreshCw size={12} strokeWidth={1.8} className={loading ? 'animate-spin-slow' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
        {error && (
          <div className="text-[11px] font-mono py-6 text-center" style={{ color: 'rgb(var(--c-error))' }}>
            failed to load memory
          </div>
        )}

        {/* Memory health */}
        {!loading && !error && isStale && (
          <div
            className="rounded-lg border px-3 py-2 flex items-start gap-2"
            style={{ borderColor: 'rgb(var(--c-warning) / 0.5)', background: 'rgb(var(--c-warning) / 0.06)' }}
          >
            <AlertTriangle size={13} strokeWidth={1.8} className="flex-shrink-0 mt-px" style={{ color: 'rgb(var(--c-warning))' }} />
            <span className="text-[11px]" style={{ color: 'rgb(var(--c-muted))' }}>
              No log entry in {staleDays} days — memory may be going stale.
            </span>
          </div>
        )}

        {/* Stack */}
        <div className="space-y-1.5">
          <div className="section-label">Memory stack</div>
          {loading && stack.length === 0 && (
            <div className="text-[11px] font-mono py-3" style={{ color: 'rgb(var(--c-faint))' }}>loading…</div>
          )}
          {stack.map(f => (
            <StackCard key={f.key} file={f} onOpen={() => f.exists && onOpenFile(f.path)} />
          ))}
        </div>

        {/* Timeline */}
        {timeline.length > 0 && (
          <div className="space-y-0.5">
            <div className="section-label flex items-center gap-1.5"><Clock size={11} strokeWidth={1.8} /> Session timeline</div>
            <div className="pt-1">
              {timeline.map(item => (
                <TimelineRow key={item.path} item={item} onOpen={() => onOpenFile(item.path)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
