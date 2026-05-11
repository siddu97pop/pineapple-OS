import { useState, useEffect, useCallback } from 'react'
import { getAgents, killAgent, type AgentProcess } from '../lib/api'

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
      className="rounded-lg border px-3 py-2 text-xs font-mono"
      style={{ borderColor: '#1e293b', background: '#0f172a' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: agent.status === 'running' ? '#22c55e' : '#64748b',
              boxShadow: agent.status === 'running' ? '0 0 6px #22c55e88' : 'none',
              animation: agent.status === 'running' ? 'pulse 2s infinite' : 'none',
            }}
          />
          <span className="text-sky-300 truncate font-semibold">{agent.name}</span>
          <span className="text-slate-500">PID {agent.pid}</span>
        </div>
        {!readOnly && (
          <button
            onClick={handleKill}
            disabled={killing}
            className="flex-shrink-0 px-2 py-0.5 rounded text-xs transition-all"
            style={{
              background: confirming ? '#ef444420' : 'transparent',
              color: confirming ? '#ef4444' : '#475569',
              border: `1px solid ${confirming ? '#ef444440' : '#1e293b'}`,
            }}
          >
            {killing ? '…' : confirming ? 'confirm?' : 'kill'}
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-slate-500">
        <span title={agent.cwd} className="truncate max-w-[120px]">
          {agent.project}
        </span>
        <span>{agent.memMb} MB</span>
        {agent.cpuPercent > 0 && <span>{agent.cpuPercent}% CPU</span>}
        <span className="ml-auto text-slate-600">{fmtRuntime(agent.runtimeSecs)}</span>
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
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
          Agents
        </span>
        <span className="text-xs text-slate-600">{agents.length} process{agents.length !== 1 ? 'es' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading && (
          <div className="text-xs text-slate-600 font-mono text-center py-4">scanning…</div>
        )}
        {!loading && agents.length === 0 && (
          <div className="text-xs text-slate-600 font-mono text-center py-4">no agent processes found</div>
        )}
        {agents.map(agent => (
          <AgentCard key={agent.pid} agent={agent} onKill={handleKill} readOnly={readOnly} />
        ))}
      </div>
    </div>
  )
}
