import { useEffect, useRef, useState } from 'react'
import { getSessions, getSSEUrl } from '../lib/api'
import { useSSE } from '../hooks/useSSE'
import { supabase } from '../lib/supabase'

interface SSEData { lines: string[]; ts: number }

function classifyLine(line: string): 'heading' | 'timestamp' | 'file' | 'normal' {
  if (line.startsWith('##') || line.startsWith('###')) return 'heading'
  if (/^\d{4}-\d{2}-\d{2}/.test(line) || /\*\*\d{4}-\d{2}-\d{2}/.test(line)) return 'timestamp'
  if (line.startsWith('- ') && line.includes('/')) return 'file'
  return 'normal'
}

export function SessionsFeed() {
  const [lines, setLines] = useState<string[]>([])
  const [sseUrl, setSseUrl] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { data, connected } = useSSE<SSEData>(sseUrl)

  useEffect(() => {
    getSessions().then(d => setLines(d.lines))
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) setSseUrl(getSSEUrl(session.access_token))
    })
  }, [])

  useEffect(() => {
    if (data?.lines) setLines(data.lines)
  }, [data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-600/50 flex-shrink-0">
        <span className="section-label">sessions.md</span>
        <span
          className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-600'}`}
          style={connected ? { boxShadow: '0 0 6px #22c55e' } : {}}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 font-mono text-xs">
        {lines.map((line, i) => {
          const type = classifyLine(line)
          if (type === 'heading') return <div key={i} className="text-electric font-medium text-sm mt-2 first:mt-0">{line}</div>
          if (type === 'timestamp') return <div key={i} className="text-slate-500">{line}</div>
          if (type === 'file') return <div key={i} className="text-slate-400 pl-2">{line}</div>
          return <div key={i} className="text-slate-300">{line}</div>
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
