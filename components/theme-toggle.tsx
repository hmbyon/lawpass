'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'eye'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('lawpass_theme') as Theme || 'dark'
    setTheme(saved)
    document.documentElement.className = saved
  }, [])

  function changeTheme(t: Theme) {
    setTheme(t)
    localStorage.setItem('lawpass_theme', t)
    document.documentElement.className = t
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <button
        onClick={() => changeTheme('dark')}
        className={`px-2 py-1 rounded transition-all ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        🌙
      </button>
      <button
        onClick={() => changeTheme('light')}
        className={`px-2 py-1 rounded transition-all ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        ☀️
      </button>
      <button
        onClick={() => changeTheme('eye')}
        className={`px-2 py-1 rounded transition-all ${theme === 'eye' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        🍃
      </button>
    </div>
  )
}
