'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import type { Question, WrongNote } from '@/lib/types'
import { getQuestions, getWrongNotes, clearAll } from '@/lib/store'
import { logout } from '@/lib/firebaseServices/auth'
import { pullFromFirebase, pushToFirebase } from '@/lib/firebaseServices/sync'
import { getAppMode, setAppMode, type AppMode } from '@/lib/appMode'
import { FeedbackModal } from '@/components/feedback-modal'
import { isAdminEmail } from '@/lib/admin'
import { countUnreadFeedback } from '@/lib/firebaseServices/feedback'
import { SettingsModal } from '@/components/settings-modal'
import { AdminFeedbackModal } from '@/components/admin-feedback-modal'
import { PdfTab } from '@/components/tabs/pdf-tab'
import { CbtTab } from '@/components/tabs/cbt-tab'
import { StudyTab } from '@/components/tabs/study-tab'
import { WrongTab } from '@/components/tabs/wrong-tab'
import { MemoTab } from '@/components/tabs/memo-tab'
import { OnboardingModal } from '@/components/onboarding-modal'

type Tab = 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo'

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
  const [mode, setMode] = useState<AppMode>(() => getAppMode())
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  // 관리자 계정에서만 안읽은 피드백 수를 조회해 헤더 버튼에 표시한다
  const isAdmin = isAdminEmail(user.email)
  const [unreadFeedback, setUnreadFeedback] = useState(0)
  // 관리자는 헤더 피드백 버튼으로 피드백 전용 관리자 모달을 연다
  const [showAdminFeedback, setShowAdminFeedback] = useState(false)

  const refreshUnreadFeedback = useCallback(() => {
    if (!isAdmin) return
    countUnreadFeedback()
      .then(setUnreadFeedback)
      .catch((e) => console.error('[app-shell] 안읽은 피드백 조회 실패', e))
  }, [isAdmin])

  function handleFeedbackClick() {
    if (isAdmin) setShowAdminFeedback(true)
    else setShowFeedbackModal(true)
  }
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // 최초 접속 시 다시 보지 않기 여부 체크 후 팝업 출력
  useEffect(() => {
    const dismissed = localStorage.getItem('lawpass_onboarding_dismissed')
    if (!dismissed) {
      setShowOnboarding(true)
    }
  }, [])

  function handleModeChange(next: AppMode) {
    setAppMode(next)
    setMode(next)
    refresh()
    setSyncedAt(Date.now())
    loadFromFirebase()
  }

  const appTitleBase = mode === 'general' ? 'ExamPass' : 'LawPass'
  const appBadge = mode === 'general' ? '일반수험' : '변호사시험'

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('mode-law', 'mode-general')
    root.classList.add(mode === 'general' ? 'mode-general' : 'mode-law')
  }, [mode])

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

  useEffect(() => {
    refreshUnreadFeedback()
  }, [refreshUnreadFeedback])

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
              {appTitleBase}<span className="hidden sm:inline"> AI</span>
            </button>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              {appBadge}
            </span>
            <button
              onClick={() => setShowOnboarding(true)}
              className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5 hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              ❓<span className="hidden sm:inline"> 가이드</span>
            </button>
            <button
              onClick={handleFeedbackClick}
              title={isAdmin && unreadFeedback > 0 ? `안읽은 피드백 ${unreadFeedback}건` : undefined}
              className={`relative text-xs rounded-full px-2 py-0.5 border transition-colors ${
                isAdmin && unreadFeedback > 0
                  ? 'text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20'
                  : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
            >
              <span className="hidden sm:inline">💬 </span>피드백
              {isAdmin && unreadFeedback > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {syncing && <span className="text-primary animate-pulse">동기화 중...</span>}
            
            <div className="flex items-center gap-3 leading-none">
              <div className="flex items-center gap-1">
                <span>문제</span>
                <span className="tabular-nums font-semibold text-foreground">{questions.length}개</span>
              </div>
              <div className="flex items-center gap-1">
                <span>오답</span>
                <span className="tabular-nums font-semibold text-foreground">{wrongNotes.length}개</span>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-xs ${
                showSettingsModal
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent'
              }`}
            >
              <span className="hidden sm:inline">⚙️ </span>설정
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
        {tab === 'pdf' && <PdfTab key={syncedAt} onQuestionsAdded={refreshAndSync} />}
        {tab === 'cbt' && <CbtTab key={syncedAt} questions={questions} onDone={refreshAndSync} />}
        {tab === 'study' && <StudyTab key={syncedAt} questions={questions} onDone={refreshAndSync} onSync={refreshAndSync} />}
        {tab === 'wrong' && <WrongTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {tab === 'memo' && <MemoTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
      </main>

      {showOnboarding && (
        <OnboardingModal
          onClose={() => setShowOnboarding(false)}
          onSelectTab={(selectedTab) => setTab(selectedTab)}
        />
      )}

      {showFeedbackModal && (
        <FeedbackModal
          userId={user.uid}
          userEmail={user.email}
          mode={mode}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {showAdminFeedback && (
        <AdminFeedbackModal
          onWriteFeedback={() => { setShowAdminFeedback(false); setShowFeedbackModal(true) }}
          onUnreadChange={refreshUnreadFeedback}
          onClose={() => { setShowAdminFeedback(false); refreshUnreadFeedback() }}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          questionCount={questions.length}
          wrongNoteCount={wrongNotes.length}
          userId={user.uid}
          userEmail={user.email}
          onClearAll={handleClearAll}
          mode={mode}
          onModeChange={handleModeChange}
          onWriteFeedback={() => { setShowSettingsModal(false); setShowFeedbackModal(true) }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  )
}