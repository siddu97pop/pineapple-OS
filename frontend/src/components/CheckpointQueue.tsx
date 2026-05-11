import { useState, useEffect, useRef, useCallback } from 'react'
import { updateCheckpoint, getCheckpointsSSEUrl, type Checkpoint } from '../lib/api'

const RISK_STYLES: Record<Checkpoint['risk'], { bg: string; color: string; label: string }> = {
  high:   { bg: '#ef444418', color: '#ef4444', label: 'HIGH' },
  medium: { bg: '#f59e0b18', color: '#f59e0b', label: 'MED' },
  low:    { bg: '#22c55e18', color: '#22c55e', label: 'LOW' },
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

interface CardProps {
  cp: Checkpoint
  onDecision: (id: string, status: 'approved' | 'denied') => Promise<void>
}

function CheckpointCard({ cp, onDecision }: CardProps) {
  const [busy, setBusy] = useState(false)
  const risk = RISK_STYLES[cp.risk]
  const isPending = cp.status === 'pending'

  const decide = async (status: 'approved' | 'denied') => {
    setBusy(true)
    await onDecision(cp.id, status)
    setBusy(false)
  }

  return (
    <div
      className="rounded-lg border px-3 py-2.5 text-xs font-mono"
      style={{
        borderColor: isPending ? '#1e40af40' : '#1e293b',
        background: isPending ? '#0f1e3a' : '#0a0f1a',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide"
          style={{ background: risk.bg, color: risk.color }}
        >
          {risk.label}
        </span>
        <span className="text-slate-300 font-semibold truncate flex-1">{cp.action}</span>
        <span className="text-slate-600 flex-shrink-0">{fmtTs(cp.ts)}</span>
      </div>

      {cp.context && (
        <p className="text-slate-500 mb-2 leading-relaxed">{cp.context}</p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-slate-600 text-[10px]">{cp.agent}</span>
        {isPending ? (
          <div className="ml-auto flex gap-1.5">
            <button
              disabled={busy}
              onClick={() => decide('denied')}
              className="px-2.5 py-1 rounded transition-all"
              style={{
                background: '#ef444415',
                color: '#ef4444',
                border: '1px solid #ef444430',
                opacity: busy ? 0.5 : 1,
              }}
            >
              deny
            </button>
            <button
              disabled={busy}
              onClick={() => decide('approved')}
              className="px-2.5 py-1 rounded transition-all"
              style={{
                background: '#22c55e15',
                color: '#22c55e',
                border: '1px solid #22c55e30',
                opacity: busy ? 0.5 : 1,
              }}
            >
              approve
            </button>
          </div>
        ) : (
          <span
            className="ml-auto text-[10px] px-2 py-0.5 rounded"
            style={{
              background: cp.status === 'approved' ? '#22c55e15' : '#ef444415',
              color: cp.status === 'approved' ? '#22c55e' : '#ef4444',
            }}
          >
            {cp.status}
          </span>
        )}
      </div>
    </div>
  )
}

interface Props {
  className?: string
  onPendingCount?: (n: number) => void
}

export function CheckpointQueue({ className = '', onPendingCount }: Props) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)

  const pending = checkpoints.filter(c => c.status === 'pending')

  useEffect(() => {
    onPendingCount?.(pending.length)
  }, [pending.length, onPendingCount])

  // Connect to SSE stream
  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false

    getCheckpointsSSEUrl().then(url => {
      if (cancelled) return
      es = new EventSource(url)
      eventSourceRef.current = es

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as Checkpoint[]
          setCheckpoints(data)
        } catch {}
      }
    })

    return () => {
      cancelled = true
      es?.close()
      eventSourceRef.current?.close()
    }
  }, [])

  const handleDecision = useCallback(async (id: string, status: 'approved' | 'denied') => {
    await updateCheckpoint(id, status)
  }, [])

  const sorted = [...checkpoints].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (a.status !== 'pending' && b.status === 'pending') return 1
    return new Date(b.ts).getTime() - new Date(a.ts).getTime()
  })

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
          Checkpoints
        </span>
        {pending.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-mono"
            style={{ background: '#0ea5e920', color: '#0ea5e9', border: '1px solid #0ea5e940' }}
          >
            {pending.length} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {sorted.length === 0 && (
          <div className="text-xs text-slate-600 font-mono text-center py-4">no checkpoints</div>
        )}
        {sorted.map(cp => (
          <CheckpointCard key={cp.id} cp={cp} onDecision={handleDecision} />
        ))}
      </div>
    </div>
  )
}
