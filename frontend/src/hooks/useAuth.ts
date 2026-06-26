import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

const REMEMBER_KEY = 'pineapple_remember_until'
const SESSION_FLAG = 'pineapple_active_session'
const REMEMBER_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export function setRememberMe(enabled: boolean) {
  if (enabled) {
    localStorage.setItem(REMEMBER_KEY, String(Date.now() + REMEMBER_DURATION_MS))
  } else {
    localStorage.removeItem(REMEMBER_KEY)
  }
  sessionStorage.setItem(SESSION_FLAG, '1')
}

export function clearSessionFlags() {
  localStorage.removeItem(REMEMBER_KEY)
  sessionStorage.removeItem(SESSION_FLAG)
}

function isSessionValid(): boolean {
  if (sessionStorage.getItem(SESSION_FLAG)) return true

  const rememberUntil = localStorage.getItem(REMEMBER_KEY)
  if (rememberUntil && Date.now() < Number(rememberUntil)) {
    sessionStorage.setItem(SESSION_FLAG, '1')
    return true
  }

  return false
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s && !isSessionValid()) {
        await supabase.auth.signOut()
        clearSessionFlags()
        setSession(null)
      } else {
        setSession(s)
      }
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) clearSessionFlags()
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  return { session, loading }
}
