import { useEffect, useRef } from 'react'
import { X, FileText, GitBranch, BookOpen, ScrollText } from 'lucide-react'
import { saveVaultFile } from '../lib/api'

export interface OpenFile {
  path: string
  label: string
  content: string
  savedContent: string
  saving?: boolean
  saveError?: boolean
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
  onChangeContent: (idx: number, content: string) => void
  onSaveResult: (idx: number, saved: boolean, error?: boolean) => void
  onSetSaving: (idx: number) => void
  onQuickOpen: (path: string) => void
  className?: string
}

export function VaultEditor({
  files,
  activeIdx,
  onActivate,
  onClose,
  onChangeContent,
  onSaveResult,
  onSetSaving,
  onQuickOpen,
  className = '',
}: VaultEditorProps) {
  const activeFile = files[activeIdx] ?? null
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        const active = files[activeIdx]
        if (!active || active.content === active.savedContent || active.saving) return
        e.preventDefault()
        void doSave(activeIdx, active)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, activeIdx])

  async function doSave(idx: number, file: OpenFile) {
    onSetSaving(idx)
    try {
      await saveVaultFile(file.path, file.content)
      onSaveResult(idx, true)
    } catch {
      onSaveResult(idx, false, true)
    }
  }

  // No files open — show quick-access cards
  if (files.length === 0) {
    return (
      <div className={`card flex flex-col overflow-hidden ${className}`}>
        <div className="px-3 py-2 border-b border-navy-600/50 flex-shrink-0">
          <span className="section-label">editor</span>
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
      <div className="flex items-end gap-0.5 px-2 pt-1 flex-shrink-0 border-b border-navy-600/50 overflow-x-auto" style={{ background: 'rgba(13,22,41,0.4)' }}>
        {files.map((file, idx) => {
          const isActive = idx === activeIdx
          const isDirty = file.content !== file.savedContent
          const saveLabel = file.saving ? '…' : file.saveError ? '✗' : isDirty ? '●' : ''
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
              {saveLabel && (
                <span
                  className="text-[10px] flex-shrink-0"
                  style={{ color: file.saveError ? '#ef4444' : '#0ea5e9' }}
                >
                  {saveLabel}
                </span>
              )}
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

      {/* Path breadcrumb + save button */}
      {activeFile && (
        <div className="flex items-center justify-between px-3 py-1 border-b border-navy-600/30 flex-shrink-0">
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
          <button
            onClick={() => doSave(activeIdx, activeFile)}
            disabled={activeFile.content === activeFile.savedContent || !!activeFile.saving}
            className="text-[10px] px-2 py-0.5 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 ml-2"
            style={{
              background: activeFile.saveError ? '#ef444420' : '#0ea5e920',
              color: activeFile.saveError ? '#ef4444' : '#0ea5e9',
              border: `1px solid ${activeFile.saveError ? '#ef444440' : '#0ea5e940'}`,
            }}
          >
            {activeFile.saving ? 'Saving…' : activeFile.saveError ? 'Error' : 'Save'}
          </button>
        </div>
      )}

      {/* Editor area */}
      {activeFile && (
        <textarea
          ref={textareaRef}
          key={activeFile.path}
          className="flex-1 bg-transparent text-slate-300 font-mono text-xs p-3 resize-none outline-none border-none overflow-y-auto leading-relaxed"
          value={activeFile.content}
          onChange={e => onChangeContent(activeIdx, e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  )
}
