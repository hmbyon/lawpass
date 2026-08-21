'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'eye'

// layout.tsx의 theme-init 스크립트와 반드시 같은 값이어야 한다
const DEFAULT_THEME: Theme = 'light'

const THEMES: { id: Theme; icon: string; label: string }[] = [
  { id: 'dark', icon: '🌙', label: '다크' },
  { id: 'light', icon: '☀️', label: '라이트' },
  { id: 'eye', icon: '🍃', label: '눈보호' },
]

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    // 저장값이 아니라 '실제로 적용된' 클래스를 읽는다.
    // layout.tsx의 초기화 스크립트와 여기가 서로 다른 기본값을 쓰면
    // (예전엔 light vs dark) 라이트모드인데 다크가 체크된 것처럼 보인다
    const el = document.documentElement
    const applied = THEMES.find((t) => el.classList.contains(t.id))?.id
    setTheme(applied ?? (localStorage.getItem('lawpass_theme') as Theme | null) ?? DEFAULT_THEME)
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
