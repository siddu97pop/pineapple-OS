import { useCallback, useEffect, useState } from 'react'

export type Theme = 'indigo' | 'brass'

const STORAGE_KEY = 'pineapple-theme'

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'indigo' || v === 'brass') return v
  } catch {}
  return 'indigo'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme)

  useEffect(() => {
    // Keep the DOM in sync with state on mount.
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    applyTheme(t)
  }, [])

  return [theme, setTheme]
}
