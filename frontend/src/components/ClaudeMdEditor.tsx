import { useState, useEffect, useRef } from 'react'
import { getClaudeMd, saveClaudeMd } from '../lib/api'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ClaudeMdEditor() {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<number>()

  useEffect(() => {
    getClaudeMd().then(d => { setContent(d.content); setSavedContent(d.content) })
    return () => clearTimeout(timerRef.current)
  }, [])

  const isDirty = content !== savedContent

  const handleSave = async () => {
    setSaveStatus('saving')
    try {
      await saveClaudeMd(content)
      setSavedContent(content)
      setSaveStatus('saved')
      timerRef.current = window.setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      timerRef.current = window.setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const saveLabel =
    saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? 'Saved ✓'
    : saveStatus === 'error' ? 'Error ✗'
    : 'Save'

  const saveBg =
    saveStatus === 'saved' ? '#22c55e'
    : saveStatus === 'error' ? '#ef4444'
    : '#0ea5e9'

  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-600/50 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2">
          <span className="section-label">CLAUDE.md</span>
          {isDirty && (
            <span
              className="w-2 h-2 rounded-full bg-electric"
              style={{ boxShadow: '0 0 6px #0ea5e9' }}
            />
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saveStatus === 'saving'}
          className="px-3 py-1 rounded-lg text-xs text-white font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: isDirty ? saveBg : '#1e3a5f' }}
        >
          {saveLabel}
        </button>
      </div>
      <textarea
        className="flex-1 bg-transparent text-slate-300 font-mono text-xs p-4 resize-none outline-none border-none overflow-y-auto"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
