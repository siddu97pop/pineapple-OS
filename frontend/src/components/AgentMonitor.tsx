import { useState, useEffect, useCallback } from 'react'
import { Cpu } from 'lucide-react'
import { getAgents, killAgent, type AgentProcess } from '../lib/api'

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-navy-700/40 px-3 py-2.5 space-y-2" style={{ background: '#0f172a' }}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-navy-700 animate-pulse flex-shrink-0" />
        <div className="h-3 w-28 rounded bg-navy-700 animate-pulse" />
        <div className="h-2.5 w-14 rounded bg-navy-700/60 animate-pulse ml-1" />
      </div>
      <div className="flex gap-3">
        <div className="h-2.5 w-20 rounded bg-navy-700/60 animate-pulse" />
        <div className="h-2.5 w-12 rounded bg-navy-700/60 animate-pulse" />
        <div className="h-2.5 w-10 rounded bg-navy-700/60 animate-pulse ml-auto" />
      </div>
    </div>
  )
}

function fmtRuntime(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

interface AgentCardProps {
  agent: AgentProcess
  onKill: (pid: number) => Promise<void>
  readOnly?: boolean
}

function AgentCard({ agent, onKill, readOnly }: AgentCardProps) {
  const [confirming, setConfirming] = useState(false)
  const [killing, setKilling] = useState(false)

  const handleKill = async () => {
    if (!confirming) { setConfirming(true); return }
    setKilling(true)
    await onKill(agent.pid)
    setKilling(false)
    setConfirming(false)
  }

  return (
    <div
      className="rounded-lg border px-3 py-2.5 text-xs font-mono transition-colors"
      style={{
        borderColor: 'rgba(30,41,59,0.8)',
        borderTopColor: 'rgba(255,255,255,0.03)',
        background: '#0b1120',
      }}
    >
      {/* Primary row: status + name */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: agent.status === 'running' ? '#22c55e' : '#334155',
              boxShadow: agent.status === 'running' ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
            }}
          />
          <span className="text-slate-200 truncate font-semibold">{agent.name}</span>
        </div>
        {!readOnly && (
          <button
            onClick={handleKill}
            disabled={killing}
            className="flex-shrink-0 px-2.5 py-0.5 rounded text-[10px] transition-all cursor-pointer"
            style={{
              background: confirming ? '#ef444418' : 'transparent',
              color: confirming ? '#ef4444' : '#475569',
              border: `1px solid ${confirming ? '#ef444440' : 'rgba(30,41,59,0.8)'}`,
            }}
          >
            {killing ? '…' : confirming ? 'confirm kill?' : 'kill'}
          </button>
        )}
      </div>

      {/* Secondary row: project + stats */}
      <div className="mt-1.5 flex items-center gap-0 text-[10px]">
        <span className="text-slate-600 font-medium truncate max-w-[100px]" title={agent.cwd}>
          {agent.project}
        </span>
        <span className="mx-2 text-slate-800">·</span>
        <span className="text-slate-500 tabular-nums">{agent.memMb} MB</span>
        {agent.cpuPercent > 0 && (
          <>
            <span className="mx-1.5 text-slate-800">·</span>
            <span className="text-slate-500 tabular-nums">{agent.cpuPercent}%</span>
          </>
        )}
        <span className="ml-auto text-slate-600 tabular-nums">{fmtRuntime(agent.runtimeSecs)}</span>
      </div>
    </div>
  )
}

export function AgentMonitor({ className = '', readOnly }: { className?: string; readOnly?: boolean }) {
  const [agents, setAgents] = useState<AgentProcess[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await getAgents()
      setAgents(data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  const handleKill = useCallback(async (pid: number) => {
    await killAgent(pid)
    await refresh()
  }, [refresh])

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <span className="section-label">Agents</span>
        {!loading && agents.length > 0 && (
          <span className="text-[10px] text-slate-600 font-mono">
            {agents.length} process{agents.length !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5">
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {!loading && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-700">
            <Cpu size={22} strokeWidth={1.5} />
            <span className="text-[11px] font-mono">no agent processes</span>
          </div>
        )}
        {agents.map(agent => (
          <AgentCard key={agent.pid} agent={agent} onKill={handleKill} readOnly={readOnly} />
        ))}
      </div>
    </div>
  )
}
