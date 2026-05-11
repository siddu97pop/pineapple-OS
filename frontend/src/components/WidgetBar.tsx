import { useState, useEffect } from 'react'
import { useUptime, formatUptime } from '../hooks/useUptime'
import { useSyncthingStatus } from '../hooks/useSyncthingStatus'

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-xs text-slate-400 tabular-nums">
      {now.toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  )
}

function Dot() {
  return <span className="text-navy-600 select-none">·</span>
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="text-slate-700 font-mono text-xs">—</span>
  const W = 48
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
      <polyline
        points={points}
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  )
}

function UptimeWidget({ status }: { status: ReturnType<typeof useUptime> }) {
  if (!status) return <span className="text-xs text-slate-600">uptime …</span>
  return (
    <span className="text-xs text-slate-500">
      Up {formatUptime(status.uptime_seconds)}
      <span className="ml-1 text-slate-600 font-mono">{status.hostname}</span>
    </span>
  )
}

function LoadWidget({ status }: { status: ReturnType<typeof useUptime> }) {
  if (!status) return <span className="text-xs text-slate-600">load …</span>
  const history = status.load_history ?? [status.load_1]
  const load = status.load_1.toFixed(2)
  const color = status.load_1 > 2 ? '#f59e0b' : status.load_1 > 4 ? '#ef4444' : '#64748b'
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs font-mono" style={{ color }}>{load}</span>
      <Sparkline data={history} />
    </span>
  )
}

function SyncWidget({ state }: { state: string | null }) {
  const color = state === 'idle' ? '#22c55e' : state === 'syncing' ? '#f59e0b' : '#4b5563'
  const label = state === 'idle' ? 'Synced' : state === 'syncing' ? 'Syncing' : 'Sync N/A'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor: color,
          boxShadow: state === 'idle' ? `0 0 5px ${color}` : undefined,
        }}
      />
      {label}
    </span>
  )
}

function TabsWidget({ count }: { count: number }) {
  return (
    <span className="text-xs text-slate-500">
      {count} {count === 1 ? 'tab' : 'tabs'}
    </span>
  )
}

interface WidgetBarProps {
  tabCount: number
}

export function WidgetBar({ tabCount }: WidgetBarProps) {
  const uptimeStatus = useUptime()
  const syncStatus = useSyncthingStatus()

  return (
    <div
      className="fixed top-12 left-0 right-0 z-40 flex items-center gap-3 px-4 h-10 border-b border-navy-600/40"
      style={{ background: 'rgba(10,15,30,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <LiveClock />
      <Dot />
      <UptimeWidget status={uptimeStatus} />
      <Dot />
      <LoadWidget status={uptimeStatus} />
      <Dot />
      <SyncWidget state={syncStatus?.state ?? null} />
      <Dot />
      <TabsWidget count={tabCount} />
    </div>
  )
}
