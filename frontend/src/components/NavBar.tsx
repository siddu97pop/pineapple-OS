import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme, type Theme } from '../lib/theme'
import { clearSessionFlags } from '../hooks/useAuth'

function PineappleIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none"
      style={{ filter: 'drop-shadow(0 0 5px rgb(var(--c-accent) / 0.5))' }}
    >
      <path d="M9 9C8 6.5 5.5 5 7 2" stroke="rgb(var(--c-success))" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M9 9C10 6.5 12.5 5 11 2" stroke="rgb(var(--c-success))" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M9 9C9 7 9 4.5 9 2" stroke="rgb(var(--c-success))" strokeWidth="1.6" strokeLinecap="round"/>
      <ellipse cx="9" cy="15.5" rx="6.5" ry="6.5" stroke="rgb(var(--c-accent))" strokeWidth="1.4"/>
      <path d="M2.5 12.5L9 9.5L15.5 12.5M2.5 18.5L9 21.5L15.5 18.5M2.5 15.5H15.5"
        stroke="rgb(var(--c-accent))" strokeWidth="0.7" strokeLinecap="round" opacity="0.4"/>
    </svg>
  )
}

const THEMES: { key: Theme; label: string; swatch: string }[] = [
  { key: 'indigo', label: 'Indigo', swatch: '#7C6CFF' },
  { key: 'brass', label: 'Brass', swatch: '#E8B23C' },
]

export type ViewMode = 'terminal' | 'graph'

function ViewModeToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (v: ViewMode) => void }) {
  const MODES: { key: ViewMode; label: string }[] = [
    { key: 'terminal', label: 'Terminal' },
    { key: 'graph', label: 'Graph' },
  ]
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden"
      style={{ border: '1px solid rgb(var(--c-border))' }}
      role="group"
      aria-label="View mode"
    >
      {MODES.map(m => {
        const on = viewMode === m.key
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            aria-pressed={on}
            className="px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: on ? 'rgb(var(--c-accent) / 0.16)' : 'transparent',
              color: on ? 'rgb(var(--c-text))' : 'rgb(var(--c-muted))',
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden"
      style={{ border: '1px solid rgb(var(--c-border))' }}
      role="group"
      aria-label="Colour theme"
    >
      {THEMES.map(t => {
        const on = theme === t.key
        return (
          <button
            key={t.key}
            onClick={() => setTheme(t.key)}
            aria-pressed={on}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: on ? 'rgb(var(--c-accent) / 0.16)' : 'transparent',
              color: on ? 'rgb(var(--c-text))' : 'rgb(var(--c-muted))',
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: t.swatch }} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

interface NavBarProps {
  viewMode?: ViewMode
  onViewModeChange?: (v: ViewMode) => void
}

export function NavBar({ viewMode, onViewModeChange }: NavBarProps = {}) {
  const [showSignOutMenu, setShowSignOutMenu] = useState(false)

  const handleSignOut = async () => {
    clearSessionFlags()
    await supabase.auth.signOut()
  }

  const handleSignOutAll = async () => {
    clearSessionFlags()
    await supabase.auth.signOut({ scope: 'global' })
    setShowSignOutMenu(false)
  }

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-12 border-b"
      style={{
        background: 'rgb(var(--c-base) / 0.9)',
        backdropFilter: 'blur(16px)',
        borderColor: 'rgb(var(--c-border) / 0.5)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <PineappleIcon />
        <span className="font-bold text-white tracking-tight">Pineapple OS</span>
      </div>
      <div className="flex items-center gap-3">
        {viewMode && onViewModeChange && (
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        )}
        <ThemeToggle />
        <a
          href="https://dash.lexitools.tech"
          target="_blank"
          rel="noopener noreferrer"
          className="text-electric text-sm border border-electric/40 hover:bg-electric/10 px-4 py-1 rounded-full transition-all duration-200 cursor-pointer"
        >
          Mission Control ↗
        </a>
        <div className="relative">
          <button
            onClick={() => setShowSignOutMenu(prev => !prev)}
            className="text-slate-500 hover:text-slate-300 text-xs transition-colors duration-200 cursor-pointer"
          >
            Sign out
          </button>
          {showSignOutMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSignOutMenu(false)} />
              <div
                className="absolute right-0 top-full mt-1 z-50 rounded-lg border py-1 min-w-[180px]"
                style={{
                  background: 'rgb(var(--c-surface))',
                  borderColor: 'rgb(var(--c-border))',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 transition-colors"
                >
                  Sign out this device
                </button>
                <button
                  onClick={handleSignOutAll}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Sign out all devices
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
