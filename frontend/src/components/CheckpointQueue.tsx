import { useState, useEffect, useRef, useCallback } from 'react'
import { updateCheckpoint, getCheckpointsSSEUrl, type Checkpoint } from '../lib/api'

const RISK_STYLES: Record<Checkpoint['risk'], { bg: string; color: string; label: string }> = {
  high:   { bg: '#ef444418', color: '#ef4444', label: 'HIGH' },
  medium: { bg: '#f59e0b18', color: '#f59e0b', label: 'MED' },
  low:    { bg: '#22c55e18', color: '#22c55e', label: 'LOW' },
}

const CONFETTI_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#a78bfa', '#38bdf8', '#4ade80']

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

function ConfettiBurst({ x, y }: { x: number; y: number }) {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2
    const dist = 30 + Math.random() * 30
    const dx = Math.round(Math.cos(angle) * dist)
    const dy = Math.round(Math.sin(angle) * dist)
    return { dx, dy, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], delay: i * 20 }
  })
  return (
    <>
      {dots.map((d, i) => (
        <span
          key={i}
          className="confetti-dot"
          style={{
            left: x,
            top: y,
            background: d.color,
            '--dx': `${d.dx}px`,
            '--dy': `${d.dy}px`,
            animationDelay: `${d.delay}ms`,
          } as React.CSSProperties}
        />
      ))}
    </>
  )
}

interface CardProps {
  cp: Checkpoint
  onDecision: (id: string, status: 'approved' | 'denied', buttonEl?: HTMLElement) => Promise<void>
  readOnly?: boolean
}

function CheckpointCard({ cp, onDecision, readOnly }: CardProps) {
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [burst, setBurst] = useState<{ x: number; y: number } | null>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const risk = RISK_STYLES[cp.risk]
  const isPending = cp.status === 'pending'

  const decide = async (status: 'approved' | 'denied') => {
    setBusy(true)
    if (status === 'approved' && approveRef.current) {
      const rect = approveRef.current.getBoundingClientRect()
      const parent = approveRef.current.closest<HTMLElement>('[data-cp-card]')
      const parentRect = parent?.getBoundingClientRect()
      setBurst({
        x: rect.left - (parentRect?.left ?? 0) + rect.width / 2,
        y: rect.top - (parentRect?.top ?? 0) + rect.height / 2,
      })
      setTimeout(() => setBurst(null), 700)
    }
    if (status === 'denied') {
      setShake(true)
      setTimeout(() => setShake(false), 450)
    }
    await onDecision(cp.id, status)
    setBusy(false)
  }

  return (
    <div
      data-cp-card
      className={`relative rounded-lg border px-3 py-2.5 text-xs font-mono overflow-hidden transition-colors ${shake ? 'animate-shake' : ''}`}
      style={{
        borderColor: isPending ? '#1e40af40' : '#1e293b',
        background: isPending ? '#0f1e3a' : '#0a0f1a',
      }}
    >
      {burst && <ConfettiBurst x={burst.x} y={burst.y} />}

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
        {isPending && !readOnly ? (
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
              ref={approveRef}
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
              background: cp.status === 'approved' ? '#22c55e15' : cp.status === 'denied' ? '#ef444415' : '#94a3b815',
              color: cp.status === 'approved' ? '#22c55e' : cp.status === 'denied' ? '#ef4444' : '#94a3b8',
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
  readOnly?: boolean
}

export function CheckpointQueue({ className = '', onPendingCount, readOnly }: Props) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const prevPendingIdsRef = useRef<Set<string>>(new Set())
  const notifPermRef = useRef<NotificationPermission>('default')

  const pending = checkpoints.filter(c => c.status === 'pending')

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => { notifPermRef.current = p })
    } else if ('Notification' in window) {
      notifPermRef.current = Notification.permission
    }
  }, [])

  useEffect(() => {
    onPendingCount?.(pending.length)
  }, [pending.length, onPendingCount])

  // Fire notifications for newly-arrived pending checkpoints
  useEffect(() => {
    const currentIds = new Set(pending.map(c => c.id))
    const newIds = [...currentIds].filter(id => !prevPendingIdsRef.current.has(id))
    prevPendingIdsRef.current = currentIds

    if (newIds.length === 0) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (document.hasFocus()) return

    const newest = checkpoints.find(c => c.id === newIds[0])
    if (!newest) return

    const n = new Notification('[Pineapple OS] Action required', {
      body: `${newest.action} — ${newest.agent}`,
      tag: 'pineapple-checkpoint',
      renotify: true,
    })
    n.onclick = () => { window.focus(); n.close() }
  }, [pending.map(c => c.id).join(',')])

  // SSE stream
  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false

    getCheckpointsSSEUrl().then(url => {
      if (cancelled) return
      es = new EventSource(url)
      es.onmessage = (e) => {
        try { setCheckpoints(JSON.parse(e.data) as Checkpoint[]) } catch {}
      }
    })

    return () => {
      cancelled = true
      es?.close()
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
          <CheckpointCard key={cp.id} cp={cp} onDecision={handleDecision} readOnly={readOnly} />
        ))}
      </div>
    </div>
  )
}
