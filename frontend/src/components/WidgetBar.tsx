import { useState, useEffect } from 'react'
import { useUptime, formatUptime } from '../hooks/useUptime'
import { useSyncthingStatus } from '../hooks/useSyncthingStatus'

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
      style={{
        background: 'rgba(14,165,233,0.04)',
        border: '1px solid rgba(30,58,95,0.55)',
        borderTopColor: 'rgba(255,255,255,0.04)',
      }}
    >
      {children}
    </div>
  )
}

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-xs text-slate-300 tabular-nums">
      {now.toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })}
    </span>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const [key, setKey] = useState(0)
  useEffect(() => { setKey(k => k + 1) }, [data.length])

  if (data.length < 2) return <span className="text-slate-700 font-mono text-xs">—</span>
  const W = 44
  const H = 14
  const max = Math.max(...data, 0.1)
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W
      const y = H - (v / max) * (H - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline key={key} points={points} fill="none" stroke="#0ea5e9"
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
        opacity="0.8" className="sparkline-animated" />
    </svg>
  )
}

function UptimeWidget({ status }: { status: ReturnType<typeof useUptime> }) {
  if (!status) return <Chip><span className="text-xs text-slate-600 font-mono">uptime…</span></Chip>
  return (
    <Chip>
      <span className="text-xs text-slate-500">Up</span>
      <span className="text-xs text-slate-300 font-mono">{formatUptime(status.uptime_seconds)}</span>
      <span className="text-xs text-slate-600 font-mono">{status.hostname}</span>
    </Chip>
  )
}

function LoadWidget({ status }: { status: ReturnType<typeof useUptime> }) {
  if (!status) return <Chip><span className="text-xs text-slate-600 font-mono">load…</span></Chip>
  const history = status.load_history ?? [status.load_1]
  const load = status.load_1.toFixed(2)
  const color = status.load_1 > 4 ? '#ef4444' : status.load_1 > 2 ? '#f59e0b' : '#64748b'
  return (
    <Chip>
      <span className="text-xs text-slate-500">load</span>
      <span className="text-xs font-mono tabular-nums" style={{ color }}>{load}</span>
      <Sparkline data={history} />
    </Chip>
  )
}

function SyncWidget({ state }: { state: string | null }) {
  const color = state === 'idle' ? '#22c55e' : state === 'syncing' ? '#f59e0b' : '#4b5563'
  const label = state === 'idle' ? 'Synced' : state === 'syncing' ? 'Syncing…' : 'Sync N/A'
  return (
    <Chip>
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color, boxShadow: state === 'idle' ? `0 0 4px ${color}` : undefined }}
      />
      <span className="text-xs text-slate-400">{label}</span>
    </Chip>
  )
}

function TabsWidget({ count }: { count: number }) {
  return (
    <Chip>
      <span className="text-xs text-slate-500">
        <span className="text-slate-300 font-mono">{count}</span> {count === 1 ? 'tab' : 'tabs'}
      </span>
    </Chip>
  )
}

interface WidgetBarProps { tabCount: number }

export function WidgetBar({ tabCount }: WidgetBarProps) {
  const uptimeStatus = useUptime()
  const syncStatus = useSyncthingStatus()

  return (
    <div
      className="fixed top-12 left-0 right-0 z-40 flex items-center gap-2 px-4 h-10 border-b"
      style={{
        background: 'rgba(6,9,15,0.85)',
        backdropFilter: 'blur(12px)',
        borderColor: 'rgba(30,58,95,0.4)',
      }}
    >
      <Chip><LiveClock /></Chip>
      <UptimeWidget status={uptimeStatus} />
      <LoadWidget status={uptimeStatus} />
      <SyncWidget state={syncStatus?.state ?? null} />
      <TabsWidget count={tabCount} />
    </div>
  )
}
