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
    <span className="font-mono text-xs text-slate-400">
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

function SyncDot({ state }: { state: string | null }) {
  const color = state === 'idle' ? '#22c55e' : state === 'syncing' ? '#f59e0b' : '#4b5563'
  const label = state === 'idle' ? 'Synced' : state === 'syncing' ? 'Syncing' : 'Sync N/A'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span
        className="w-2 h-2 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: state === 'idle' ? `0 0 6px ${color}` : undefined,
        }}
      />
      {label}
    </span>
  )
}

export function StatusBar() {
  const uptimeStatus = useUptime()
  const syncStatus = useSyncthingStatus()

  return (
    <div
      className="fixed top-12 left-0 right-0 z-40 flex items-center gap-4 px-6 h-9 border-b border-navy-600/50"
      style={{ background: 'rgba(10,15,30,0.7)' }}
    >
      <LiveClock />
      <span className="text-navy-600">·</span>
      <span className="text-xs text-slate-500">
        {uptimeStatus ? (
          <>
            Up {formatUptime(uptimeStatus.uptime_seconds)}
            <span className="ml-1 text-slate-600">({uptimeStatus.hostname})</span>
          </>
        ) : (
          'Loading...'
        )}
      </span>
      <span className="text-navy-600">·</span>
      <SyncDot state={syncStatus?.state ?? null} />
    </div>
  )
}
