'use client'

import { useEffect, useState } from 'react'
import { onAuthChange, loginWithGoogle } from '@/lib/firebaseServices/auth'
import type { User } from 'firebase/auth'

interface Props {
  children: (user: User) => React.ReactNode
}

export function AuthGate({ children }: Props) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthChange((u) => {
      setUser(u)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  function handleLogin() {
    setError(null)
    loginWithGoogle().catch((e) => {
      console.error(e)
      setError('로그인에 실패했습니다. 팝업이 차단됐을 수 있어요.')
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-primary">LawPass AI</h1>
          <p className="text-muted-foreground text-sm mt-1">변호사시험 객관식 학습</p>
        </div>
        <button
          onClick={handleLogin}
          className="flex items-center gap-2 px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-lg shadow-sm hover:shadow-md transition-all text-sm font-medium"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google로 로그인
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-xs text-muted-foreground">팝업이 차단되면 브라우저 설정에서 팝업을 허용해주세요</p>
      </div>
    )
  }

  return <>{children(user)}</>
}
