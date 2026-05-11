import { useState, useEffect, useCallback } from 'react'
import { NavBar } from './NavBar'
import { SessionsFeed } from './SessionsFeed'
import { CheckpointQueue } from './CheckpointQueue'
import { AgentMonitor } from './AgentMonitor'
import { DotGrid } from './DotGrid'
import { useUptime, formatUptime } from '../hooks/useUptime'
import { useSyncthingStatus } from '../hooks/useSyncthingStatus'

type MobileTab = 'sessions' | 'agents'

function StatusRow() {
  const uptime = useUptime()
  const sync = useSyncthingStatus()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const syncColor = sync?.state === 'idle' ? '#22c55e' : sync?.state === 'syncing' ? '#f59e0b' : '#4b5563'

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-navy-600/40 text-xs font-mono"
      style={{ background: 'rgba(10,15,30,0.9)' }}
    >
      <span className="text-slate-400 tabular-nums">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      {uptime && (
        <span className="text-slate-500">
          Up {formatUptime(uptime.uptime_seconds)}
        </span>
      )}
      {uptime && (
        <span className="text-slate-500">
          Load <span className="text-slate-400">{uptime.load_1.toFixed(2)}</span>
        </span>
      )}
      <span className="flex items-center gap-1 text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: syncColor }} />
        {sync?.state === 'idle' ? 'Synced' : sync?.state === 'syncing' ? 'Syncing' : 'Sync N/A'}
      </span>
    </div>
  )
}

function TabBar({
  active,
  onSwitch,
  pendingCount,
}: {
  active: MobileTab
  onSwitch: (t: MobileTab) => void
  pendingCount: number
}) {
  return (
    <div className="flex border-b border-navy-600/40 flex-shrink-0">
      {(['sessions', 'agents'] as MobileTab[]).map(tab => (
        <button
          key={tab}
          onClick={() => onSwitch(tab)}
          className="flex-1 py-2.5 text-xs font-mono capitalize transition-all flex items-center justify-center gap-1.5"
          style={{
            color: active === tab ? '#0ea5e9' : '#64748b',
            borderBottom: active === tab ? '2px solid #0ea5e9' : '2px solid transparent',
            background: active === tab ? '#0ea5e908' : 'transparent',
          }}
        >
          {tab}
          {tab === 'agents' && pendingCount > 0 && (
            <span
              className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
              style={{ background: '#ef4444', color: '#fff' }}
            >
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function MobileDashboard() {
  const [tab, setTab] = useState<MobileTab>('sessions')
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    document.title = pendingCount > 0 ? `[${pendingCount}] Pineapple OS` : 'Pineapple OS'
  }, [pendingCount])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <DotGrid />
      <NavBar />

      {/* pt-12 = NavBar height */}
      <div className="pt-12 flex flex-col flex-1 min-h-0">
        <StatusRow />
        <TabBar active={tab} onSwitch={setTab} pendingCount={pendingCount} />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'sessions' && (
            <div className="h-full animate-fade-in">
              <SessionsFeed />
            </div>
          )}

          {tab === 'agents' && (
            <div className="p-3 space-y-4 animate-fade-in">
              <CheckpointQueue onPendingCount={setPendingCount} readOnly />
              <AgentMonitor readOnly />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
