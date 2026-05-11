import { supabase } from '../lib/supabase'

export function NavBar() {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-12 border-b border-navy-600"
      style={{ background: 'rgba(13,22,41,0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">🍍</span>
        <span className="font-bold text-white tracking-tight">Pineapple OS</span>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="https://dash.lexitools.tech"
          target="_blank"
          rel="noopener noreferrer"
          className="text-electric text-sm border border-electric/40 hover:bg-electric/10 px-4 py-1 rounded-full transition-all"
        >
          Mission Control ↗
        </a>
        <button
          onClick={handleSignOut}
          className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
