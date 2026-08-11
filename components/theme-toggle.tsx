'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'eye'

const THEMES: { id: Theme; icon: string; label: string }[] = [
  { id: 'dark', icon: '🌙', label: '다크' },
  { id: 'light', icon: '☀️', label: '라이트' },
  { id: 'eye', icon: '🍃', label: '눈보호' },
]

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('lawpass_theme') as Theme || 'dark'
    setTheme(saved)
  }, [])

  function changeTheme(t: Theme) {
    setTheme(t)
    localStorage.setItem('lawpass_theme', t)
    const el = document.documentElement
    el.classList.remove('dark', 'light', 'eye')
    el.classList.add(t)
  }

  return (
    <div className="flex items-center gap-1 text-xs border border-border rounded-lg p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => changeTheme(t.id)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
            theme === t.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
