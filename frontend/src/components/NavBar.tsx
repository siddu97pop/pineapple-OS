import { supabase } from '../lib/supabase'

function PineappleIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none"
      style={{ filter: 'drop-shadow(0 0 5px rgba(14,165,233,0.5))' }}
    >
      <path d="M9 9C8 6.5 5.5 5 7 2" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M9 9C10 6.5 12.5 5 11 2" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M9 9C9 7 9 4.5 9 2" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round"/>
      <ellipse cx="9" cy="15.5" rx="6.5" ry="6.5" stroke="#0ea5e9" strokeWidth="1.4"/>
      <path d="M2.5 12.5L9 9.5L15.5 12.5M2.5 18.5L9 21.5L15.5 18.5M2.5 15.5H15.5"
        stroke="#0ea5e9" strokeWidth="0.7" strokeLinecap="round" opacity="0.4"/>
    </svg>
  )
}

export function NavBar() {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-12 border-b"
      style={{
        background: 'rgba(6,9,15,0.9)',
        backdropFilter: 'blur(16px)',
        borderColor: 'rgba(30,58,95,0.5)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <PineappleIcon />
        <span className="font-bold text-white tracking-tight">Pineapple OS</span>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="https://dash.lexitools.tech"
          target="_blank"
          rel="noopener noreferrer"
          className="text-electric text-sm border border-electric/40 hover:bg-electric/10 px-4 py-1 rounded-full transition-all duration-200 cursor-pointer"
        >
          Mission Control ↗
        </a>
        <button
          onClick={handleSignOut}
          className="text-slate-500 hover:text-slate-300 text-xs transition-colors duration-200 cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
