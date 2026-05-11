import { FileText, GitBranch, BookOpen, ScrollText, X } from 'lucide-react'

export interface OpenFile {
  path: string
  label: string
  content: string
}

const QUICK_FILES: { label: string; path: string; desc: string; Icon: React.ElementType }[] = [
  { label: 'projects.md', path: 'memory/projects.md', desc: 'Project index', Icon: GitBranch },
  { label: 'decisions.md', path: 'memory/decisions.md', desc: 'Decisions log', Icon: BookOpen },
  { label: 'context.md', path: '_system/context.md', desc: 'My profile', Icon: FileText },
  { label: 'sessions.md', path: 'logs/sessions.md', desc: 'Session log', Icon: ScrollText },
]

interface VaultEditorProps {
  files: OpenFile[]
  activeIdx: number
  onActivate: (idx: number) => void
  onClose: (idx: number) => void
  onQuickOpen: (path: string) => void
  className?: string
}

export function VaultEditor({
  files,
  activeIdx,
  onActivate,
  onClose,
  onQuickOpen,
  className = '',
}: VaultEditorProps) {
  const activeFile = files[activeIdx] ?? null

  if (files.length === 0) {
    return (
      <div className={`card flex flex-col overflow-hidden ${className}`}>
        <div className="px-3 py-2 border-b border-navy-600/50 flex-shrink-0">
          <span className="section-label">viewer</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-xs text-slate-600 font-mono">quick access</p>
          <div className="grid grid-cols-2 gap-2 w-full">
            {QUICK_FILES.map(f => (
              <button
                key={f.path}
                className="flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border border-navy-600/60 hover:border-electric/50 hover:bg-electric/5 transition-all text-left cursor-pointer group"
                onClick={() => onQuickOpen(f.path)}
              >
                <f.Icon size={13} className="text-slate-600 group-hover:text-electric transition-colors" />
                <span className="text-xs font-mono text-slate-300">{f.label}</span>
                <span className="text-[10px] text-slate-600">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`}>
      {/* File tabs */}
      <div
        className="flex items-end gap-0.5 px-2 pt-1 flex-shrink-0 border-b border-navy-600/50 overflow-x-auto"
        style={{ background: 'rgba(13,22,41,0.4)' }}
      >
        {files.map((file, idx) => {
          const isActive = idx === activeIdx
          return (
            <div
              key={file.path}
              className="group flex items-center gap-1 px-2.5 py-1 rounded-t-md cursor-pointer select-none flex-shrink-0 transition-all duration-150"
              style={{
                background: isActive ? 'linear-gradient(to bottom, #162040, #0d1629)' : 'transparent',
                borderBottom: isActive ? '2px solid #0ea5e9' : '2px solid transparent',
                boxShadow: isActive ? '0 2px 8px rgba(14,165,233,0.15), inset 0 1px 0 rgba(14,165,233,0.06)' : 'none',
                color: isActive ? '#e2e8f0' : '#64748b',
              }}
              onClick={() => onActivate(idx)}
            >
              <span className="text-[11px] font-mono truncate max-w-[120px]" title={file.path}>
                {file.label}
              </span>
              <button
                className="w-5 h-5 rounded flex items-center justify-center text-slate-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 flex-shrink-0 transition-all cursor-pointer"
                onClick={e => { e.stopPropagation(); onClose(idx) }}
                title="Close"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Path breadcrumb */}
      {activeFile && (
        <div className="flex items-center px-3 py-1 border-b border-navy-600/30 flex-shrink-0">
          <span className="text-[10px] font-mono truncate flex items-center gap-1 min-w-0">
            {activeFile.path.split('/').map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-1 flex-shrink-0">
                {i > 0 && <span className="text-slate-700">/</span>}
                <span className={i === arr.length - 1 ? 'text-slate-400' : 'text-slate-700'}>
                  {seg}
                </span>
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Read-only content area */}
      {activeFile && (
        <textarea
          key={activeFile.path}
          className="flex-1 bg-transparent text-slate-300 font-mono text-xs p-3 resize-none outline-none border-none overflow-y-auto leading-relaxed cursor-default select-text"
          value={activeFile.content}
          readOnly
          spellCheck={false}
        />
      )}
    </div>
  )
}
