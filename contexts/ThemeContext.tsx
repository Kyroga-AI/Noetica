'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { DEFAULT_THEME, type ThemeId } from '@/config/themes'

type ThemeContextValue = {
  themeId: ThemeId
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME,
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('noetica-theme') as ThemeId | null
      const initial = saved ?? DEFAULT_THEME
      setThemeId(initial)
      document.documentElement.setAttribute('data-theme', initial)
    } catch {
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME)
    }
  }, [])

  const setTheme = (id: ThemeId) => {
    setThemeId(id)
    try { localStorage.setItem('noetica-theme', id) } catch { /* noop */ }
    document.documentElement.setAttribute('data-theme', id)
  }

  return (
    <ThemeContext.Provider value={{ themeId, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
