import { useCallback, useEffect, useState } from 'react'

/**
 * DM UI colour theme. A per-device preference (localStorage), deliberately NOT
 * campaign state: it must not travel with gist sync or backups. Dark is the
 * default because the app is used in dim rooms. index.html applies the stored
 * value before first paint; keep the key in sync with it.
 */
export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'vtt:theme'

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the theme still applies.
  }
}

export function useTheme(): readonly [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)
  // index.html normally applies the theme before first paint; this keeps the DOM
  // correct even if that inline script did not run.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next)
    setThemeState(next)
  }, [])
  return [theme, setTheme] as const
}
