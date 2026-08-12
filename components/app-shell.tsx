'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import type { Question, WrongNote } from '@/lib/types'
import { getQuestions, getWrongNotes, clearAll } from '@/lib/store'
import { logout } from '@/lib/firebaseServices/auth'
import { pullFromFirebase, pushToFirebase } from '@/lib/firebaseServices/sync'
import { PdfTab } from '@/components/tabs/pdf-tab'
import { CbtTab } from '@/components/tabs/cbt-tab'
import { StudyTab } from '@/components/tabs/study-tab'
import { WrongTab } from '@/components/tabs/wrong-tab'
import { MemoTab } from '@/components/tabs/memo-tab'
import { SettingsTab } from '@/components/tabs/settings-tab'

type Tab = 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pdf', label: 'PDF 분석', icon: '📄' },
  { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
  { id: 'study', label: '선학습', icon: '📖' },
  { id: 'wrong', label: '오답노트', icon: '📝' },
  { id: 'memo', label: 'D-1 암기장', icon: '⭐' },
]

interface Props {
  user: User
}

export function AppShell({ user }: Props) {
  const [tab, setTab] = useState<Tab>('pdf')
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrongNotes, setWrongNotes] = useState<WrongNote[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState(0)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showUserMenu) return
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showUserMenu])

  const refresh = useCallback(() => {
    setQuestions(getQuestions())
    setWrongNotes(getWrongNotes())
  }, [])

  const loadFromFirebase = useCallback(async () => {
    setSyncing(true)
    try {
      await pullFromFirebase(user.uid)
    } catch (e) {
      console.error('Firebase 불러오기 실패 (오프라인?)', e)
    } finally {
      refresh()
      setSyncing(false)
      setSyncedAt(Date.now())
    }
  }, [user.uid, refresh])

  useEffect(() => {
    loadFromFirebase()
  }, [loadFromFirebase])

  function handleLogoClick() {
    setTab('pdf')
    loadFromFirebase()
  }

  const refreshAndSync = useCallback(async () => {
    refresh()
    try {
      await pushToFirebase(user.uid)
    } catch (e) {
      console.error('Firebase 저장 실패 (오프라인?)', e)
    }
  }, [user.uid, refresh])

  function handleClearAll() {
    clearAll()
    refresh()
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogoClick}
              className="text-primary text-lg font-bold tracking-tight hover:opacity-80 transition-opacity"
            >
              LawPass AI
            </button>
            <span className="hidden sm:inline text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">
              변호사시험
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {syncing && <span className="text-primary animate-pulse">동기화 중...</span>}
            <span>{questions.length}문제</span>
            <span>오답 {wrongNotes.length}</span>
            <button
              onClick={() => setTab(tab === 'settings' ? 'pdf' : 'settings')}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-xs ${
                tab === 'settings'
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent'
              }`}
            >
              ⚙️ 설정
            </button>
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="w-7 h-7 rounded-full overflow-hidden border border-border flex items-center justify-center bg-primary/20 text-primary text-xs font-semibold hover:opacity-80 transition-opacity shrink-0"
              >
                {user.photoURL && !avatarError ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName ?? user.email ?? '프로필'}
                    crossOrigin="anonymous"
                    onError={() => setAvatarError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}</span>
                )}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-9 w-56 bg-card border border-border rounded-xl shadow-lg py-2 z-50">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="w-9 h-9 rounded-full overflow-hidden border border-border flex items-center justify-center bg-primary/20 text-primary text-sm font-semibold shrink-0">
                      {user.photoURL && !avatarError ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName ?? user.email ?? '프로필'}
                          crossOrigin="anonymous"
                          onError={() => setAvatarError(true)}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{user.displayName ?? '이름 없음'}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      logout()
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <nav className="sticky top-14 z-30 bg-background/90 backdrop-blur-sm border-b border-border no-print">
        <div className="max-w-3xl mx-auto px-2">
          <div className="flex overflow-x-auto scrollbar-hide">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {t.id === 'wrong' && wrongNotes.length > 0 && (
                  <span className="bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                    {wrongNotes.length}
                  </span>
                )}
                {t.id === 'memo' && wrongNotes.filter((n) => (n.analysis?.위험도 ?? 0) >= 3).length > 0 && (
                  <span className="bg-yellow-500/20 text-yellow-400 rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                    {wrongNotes.filter((n) => (n.analysis?.위험도 ?? 0) >= 3).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        {tab === 'pdf' && <PdfTab onQuestionsAdded={refreshAndSync} />}
        {tab === 'cbt' && <CbtTab questions={questions} onDone={refreshAndSync} />}
        {tab === 'study' && <StudyTab key={syncedAt} questions={questions} onDone={refreshAndSync} onSync={refreshAndSync} />}
        {tab === 'wrong' && <WrongTab notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {tab === 'memo' && <MemoTab notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {tab === 'settings' && (
          <SettingsTab
            questionCount={questions.length}
            wrongNoteCount={wrongNotes.length}
            userId={user.uid}
            userEmail={user.email}
            onClearAll={handleClearAll}
          />
        )}
      </main>
    </div>
  )
}
