'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import type { Question, WrongNote } from '@/lib/types'
import { getQuestions, getPoolQuestions, getWrongNotes, clearAll , isInMemoList, hasPendingSync } from '@/lib/store'
import { logout } from '@/lib/firebaseServices/auth'
import { pullFromFirebase, pushToFirebase } from '@/lib/firebaseServices/sync'
import { recordUserDirectory } from '@/lib/firebaseServices/userDirectory'
import { isAccountSwitch, rememberUid, unsyncedModes, clearAccountData } from '@/lib/accountSwitch'
import { getAppMode, setAppMode, type AppMode } from '@/lib/appMode'
import { FeedbackModal } from '@/components/feedback-modal'
import { isAdminEmail } from '@/lib/admin'
import { countUnreadFeedback, countUnreadReplies } from '@/lib/firebaseServices/feedback'
import { SettingsModal } from '@/components/settings-modal'
import { AdminFeedbackModal } from '@/components/admin-feedback-modal'
import { PdfTab } from '@/components/tabs/pdf-tab'
import { CbtTab } from '@/components/tabs/cbt-tab'
import { StudyTab } from '@/components/tabs/study-tab'
import { WrongTab } from '@/components/tabs/wrong-tab'
import { MemoTab } from '@/components/tabs/memo-tab'
import { CasesTab } from '@/components/tabs/cases-tab'
import { OnboardingModal } from '@/components/onboarding-modal'

type Tab = 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo' | 'cases'

// 헤더 동기화 배지 규칙. 조건이 서로 얽혀 있어 한 곳에 모으고 테스트로 고정한다.
// 핵심은 '실패 중에도 올리기가 보여야 한다'는 것 — 실패 버튼은 pull부터 다시 하는데,
// 원격 조각이 깨져 pull이 죽는 상황에서는 그걸 눌러봐야 같은 자리에서 또 실패한다.
// 그때 원격을 되살릴 수 있는 유일한 수단이 순수 push다.
// 예전에는 올리기 버튼이 !syncError에 묶여 있어, 정작 필요한 순간에만 사라졌다
export function syncBadges(state: { syncing: boolean; syncError: string | null; pendingSync: boolean }): {
  error: boolean
  push: 'none' | 'pending' | 'force'
} {
  if (state.syncing) return { error: false, push: 'none' }
  return {
    error: Boolean(state.syncError),
    push: state.syncError ? 'force' : state.pendingSync ? 'pending' : 'none',
  }
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pdf', label: 'PDF 분석', icon: '📄' },
  { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
  { id: 'study', label: '선학습', icon: '📖' },
  { id: 'wrong', label: '오답노트', icon: '📝' },
  { id: 'memo', label: 'D-1 암기장', icon: '⭐' },
  { id: 'cases', label: '기출판례', icon: '⚖️' },
]

interface Props {
  user: User
}

export function AppShell({ user }: Props) {
  const [tab, setTab] = useState<Tab>('pdf')
  const [questions, setQuestions] = useState<Question[]>([])
  // 공유받은 문제는 내 문제와 한 배열에 담지 않는다. 화면에 넘길 때만 합치고,
  // 저장·동기화 경로에는 끝까지 따로 둔다 (docs/shared-pool-design.md §3)
  const [poolQuestions, setPoolQuestions] = useState<Question[]>([])
  // 계정이 바뀌어 이전 데이터를 치우고 새로 받아오는 중. 그동안은 화면을 열지 않는다 —
  // 반쯤 지워진 상태를 보여주면 그 위에서 조작이 일어나 다시 오염된다
  const [switching, setSwitching] = useState(false)
  const [wrongNotes, setWrongNotes] = useState<WrongNote[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState(0)
  // 동기화 실패는 반드시 화면에 남긴다. 예전에는 console.error로만 삼켜서
  // 클라우드 저장이 계속 실패하는 줄 모른 채 쓰다가 데이터가 로컬에만 남는 사고가 났다
  const [syncError, setSyncError] = useState<string | null>(null)
  // 아직 클라우드에 올리지 못한 로컬 변경이 있는지. 예외가 난 적이 없어도(=push를 아예 안 돌린 상태)
  // 미동기화일 수 있으므로 syncError와 별개로 플래그를 직접 읽는다
  const [pendingSync, setPendingSync] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const [mode, setMode] = useState<AppMode>(() => getAppMode())
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  // 관리자 계정에서만 안읽은 피드백 수를 조회해 헤더 버튼에 표시한다
  const isAdmin = isAdminEmail(user.email)
  const [unreadFeedback, setUnreadFeedback] = useState(0)
  // 관리자는 헤더 피드백 버튼으로 피드백 전용 관리자 모달을 연다
  const [showAdminFeedback, setShowAdminFeedback] = useState(false)
  // 내 피드백에 달린 아직 확인하지 않은 답글 수 (로그인한 모든 사용자 대상)
  const [unreadReplies, setUnreadReplies] = useState(0)

  const refreshUnreadReplies = useCallback(() => {
    countUnreadReplies(user.uid)
      .then(setUnreadReplies)
      .catch((e) =>
        // 권한 오류면 배지가 뜨지 않는다. Firestore 규칙에서 본인 피드백 읽기가 허용돼야 한다
        console.error('[app-shell] 답글 알림 조회 실패 (Firestore 규칙 확인 필요)', e)
      )
  }, [user.uid])

  const refreshUnreadFeedback = useCallback(() => {
    if (!isAdmin) return
    countUnreadFeedback()
      .then(setUnreadFeedback)
      .catch((e) => console.error('[app-shell] 안읽은 피드백 조회 실패', e))
  }, [isAdmin])

  // 관리자는 안읽은 피드백, 그 외에는 내 피드백의 새 답글이 알림 대상이다
  const hasFeedbackAlert = isAdmin ? unreadFeedback > 0 : unreadReplies > 0
  // 암기장 목록·일괄삭제와 같은 판정을 써야 수동 추가분이 배지에도 반영된다
  const memoCount = wrongNotes.filter(isInMemoList).length

  function handleFeedbackClick() {
    // 비관리자는 항상 피드백 모달을 연다. 그 안에 "내 피드백 + 답글"이 함께 들어 있어
    // 알림 카운트가 0이어도(조회 실패 포함) 답글에 도달할 수 있다
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
    setPoolQuestions(getPoolQuestions())
    setWrongNotes(getWrongNotes())
    setPendingSync(hasPendingSync())
  }, [])

  const loadFromFirebase = useCallback(async () => {
    // 계정이 바뀌었으면 pull보다 먼저 이전 계정의 흔적을 치운다.
    // 순서가 뒤바뀌면 안 된다 — pull이 먼저 돌면 미동기화 상태에서 로컬이 원격에 합쳐지고,
    // 그 직후 아래 push가 앞 계정의 데이터를 새 계정 트리에 올린다
    if (isAccountSwitch(user.uid)) {
      const unsynced = unsyncedModes()
      if (
        unsynced.length > 0 &&
        !confirm(
          '이 기기에 아직 올리지 못한 이전 계정의 변경 사항이 있습니다.\n\n' +
            '계속하면 그 변경은 이 기기에서 사라집니다. 되돌릴 수 없습니다.\n' +
            '지우지 않으려면 취소하고 이전 계정으로 다시 로그인해 동기화한 뒤에 계정을 바꿔주세요.\n\n' +
            '지우고 계속할까요?'
        )
      ) {
        // 이 계정으로는 진행하지 않는다. 앞 계정으로 돌아가 올릴 기회를 준다
        logout()
        return
      }
      setSwitching(true)
      clearAccountData()
      refresh()
    }
    // 지운 뒤에 기록한다. 중간에 멈춰도 다음 로그인에서 다시 '계정이 바뀌었다'로 걸린다
    rememberUid(user.uid)

    setSyncing(true)
    try {
      await pullFromFirebase(user.uid)
      // pull만으로는 미동기화 플래그가 풀리지 않는다. 로그인 시점에 올리지 못한 로컬 변경이 있으면
      // 여기서 올려야 한다 — 예전에는 push 호출부가 탭 콜백뿐이라 로그인만으로는 영영 동기화되지 않았다.
      // pull이 성공한 뒤에만 올린다 (불러오기 실패 상태에서 올리면 빈 로컬로 원격을 덮어쓴다)
      if (hasPendingSync()) await pushToFirebase(user.uid)
      setSyncError(null)
    } catch (e) {
      // 실패해도 로컬 데이터는 그대로다 (pullFromFirebase가 로컬을 건드리기 전에 던진다)
      console.error('Firebase 동기화 실패 (오프라인?)', e)
      setSyncError(`동기화에 실패했습니다. 이 기기에는 저장돼 있어 데이터는 사라지지 않습니다. (${String(e)})`)
    } finally {
      refresh()
      setSyncing(false)
      setSwitching(false)
      setSyncedAt(Date.now())
    }
  }, [user.uid, refresh])

  useEffect(() => {
    loadFromFirebase()
  }, [loadFromFirebase])

  // 이메일→uid 대응표에 내 계정을 남긴다. 관리자가 이메일로 문제집 권한을 줄 때
  // uid를 찾는 유일한 수단이다 (docs/shared-pool-design.md §1.4).
  // 동기화와 별개의 부가 기록이라 실패해도 조용히 넘어간다 — 규칙 배포 전에는 거부된다
  useEffect(() => {
    recordUserDirectory(user)
  }, [user])

  useEffect(() => {
    refreshUnreadFeedback()
  }, [refreshUnreadFeedback])

  useEffect(() => {
    refreshUnreadReplies()
  }, [refreshUnreadReplies])

  function handleLogoClick() {
    setTab('pdf')
    loadFromFirebase()
  }

  const refreshAndSync = useCallback(async () => {
    refresh()
    setSyncing(true)
    try {
      await pushToFirebase(user.uid)
      setSyncError(null)
    } catch (e) {
      console.error('Firebase 저장 실패 (오프라인?)', e)
      setSyncError(`클라우드 저장에 실패했습니다. 이 기기에는 저장돼 있으니 데이터는 사라지지 않습니다. (${String(e)})`)
    } finally {
      setSyncing(false)
      setPendingSync(hasPendingSync())
    }
  }, [user.uid, refresh])

  // 불러오기가 실패한 상태에서 누르는 '올리기'. 원격을 이 기기 내용으로 덮어쓰는 일이라
  // 반드시 확인을 받는다 — 새 기기에서 pull이 실패한 채 이걸 누르면 빈 로컬로 원격을
  // 지워버릴 수 있다. 그래서 무엇을 올리는지 개수로 밝히고 묻는다
  const forcePush = useCallback(() => {
    const ok = confirm(
      `이 기기의 문제 ${getQuestions().length}개 · 오답노트 ${getWrongNotes().length}개를 ` +
        '클라우드에 올립니다.\n\n클라우드의 기존 내용은 이 기기 것으로 대체됩니다. ' +
        '다른 기기에서만 추가한 내용이 있다면 사라질 수 있습니다.\n\n올릴까요?'
    )
    if (ok) refreshAndSync()
  }, [refreshAndSync])

  function handleClearAll() {
    clearAll()
    refresh()
  }

  const badges = syncBadges({ syncing, syncError, pendingSync })

  if (switching) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-background">
        <p className="text-sm text-foreground">계정이 바뀌어 이 기기의 데이터를 정리하고 있습니다</p>
        <p className="text-xs text-muted-foreground">클라우드에서 새 계정의 데이터를 불러오는 중…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-2 sm:py-0 sm:h-14 flex items-center justify-between gap-2">
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
            {/* 모바일에서는 아이콘만 보여 한 줄에 나란히 들어가게 한다 */}
            <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setShowOnboarding(true)}
              title="가이드"
              className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5 hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              🔍<span className="hidden sm:inline"> 가이드</span>
            </button>
            <button
              onClick={handleFeedbackClick}
              title={
                isAdmin && unreadFeedback > 0
                  ? `안읽은 피드백 ${unreadFeedback}건`
                  : unreadReplies > 0
                    ? `새 답글 ${unreadReplies}건`
                    : undefined
              }
              className={`relative text-xs rounded-full px-2 py-0.5 border transition-colors ${
                hasFeedbackAlert
                  ? 'text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20'
                  : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
            >
              💬<span className="hidden sm:inline"> 피드백</span>
              {hasFeedbackAlert && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
            </button>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground shrink-0">
            {syncing && <span className="text-primary animate-pulse">동기화 중...</span>}
            {/* 실패(예외)와 미동기화(아직 안 올라감)는 다른 상태다. 예전에는 실패만 표시해서
                push가 한 번도 안 돌아간 경우엔 아무 표시도 뜨지 않았다 */}
            {badges.error && (
              <button
                onClick={loadFromFirebase}
                title={`${syncError} 눌러서 다시 시도합니다.`}
                className="text-red-400 border border-red-500/40 bg-red-500/10 rounded-full px-2 py-0.5 hover:bg-red-500/20 transition-colors"
              >
                ⚠️<span className="hidden sm:inline"> 동기화 실패</span>
              </button>
            )}
            {badges.push !== 'none' && (
              <button
                onClick={badges.push === 'force' ? forcePush : refreshAndSync}
                title={
                  badges.push === 'force'
                    ? '이 기기의 데이터를 클라우드에 올립니다. 불러오기가 실패한 상태에서도 올릴 수 있습니다.'
                    : '이 기기에만 저장된 변경이 있습니다. 눌러서 클라우드에 올립니다.'
                }
                className="text-amber-400 border border-amber-500/40 bg-amber-500/10 rounded-full px-2 py-0.5 hover:bg-amber-500/20 transition-colors"
              >
                ☁️<span className="hidden sm:inline"> {badges.push === 'force' ? '이 기기 것 올리기' : '미동기화'}</span>
              </button>
            )}
            
            {/* 모바일에서는 라벨과 숫자를 세로 2줄로 (문제 / N개) */}
            <div className="flex items-center gap-2 sm:gap-3 leading-none">
              <div className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1">
                <span>문제</span>
                <span className="tabular-nums font-semibold text-foreground">{questions.length}개</span>
              </div>
              {/* 공유받은 문제는 내 문제와 합쳐 세지 않는다 — 내가 만든 것이 몇 개인지가 흐려진다 */}
              {poolQuestions.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1">
                  <span>공유</span>
                  <span className="tabular-nums font-semibold text-foreground">{poolQuestions.length}개</span>
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1">
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
              ⚙️<span className="hidden sm:inline"> 설정</span>
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
                {t.id === 'memo' && memoCount > 0 && (
                  <span className="bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                    {memoCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        {/* PdfTab만 key를 주지 않는다. 파싱 큐·재개 목록·검토 패널은 동기화가 끝났다고 해서
            버려도 되는 상태가 아니다. 대신 syncedAt을 넘겨 필요한 값만 다시 읽게 한다 */}
        {tab === 'pdf' && <PdfTab syncedAt={syncedAt} onQuestionsAdded={refreshAndSync} />}
        {/* 공유받은 문제를 합쳐 넘긴다. 합치는 것은 화면에 보여줄 배열뿐이고,
            문항에 붙은 poolId 가 그대로 따라가 오답노트·학습 세션 사본에도 출처가 남는다.
            선학습은 세션을 시작할 때 이 배열에서 고른 문항을 통째로 스냅샷으로 잡으므로,
            진행 중에 공유 문제집이 재발행돼도 그 세션의 문제 구성은 그대로다 */}
        {tab === 'cbt' && <CbtTab key={syncedAt} questions={[...questions, ...poolQuestions]} onDone={refreshAndSync} />}
        {tab === 'study' && <StudyTab key={syncedAt} questions={[...questions, ...poolQuestions]} onDone={refreshAndSync} onSync={refreshAndSync} />}
        {tab === 'wrong' && <WrongTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {tab === 'memo' && <MemoTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {/* 판례는 내 문제의 해설에서 뽑은 것만 센다. 공유받은 문제집은 이번 범위가 아니다 */}
        {tab === 'cases' && <CasesTab key={syncedAt} questions={questions} />}
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
          onRepliesRead={refreshUnreadReplies}
          onClose={() => { setShowFeedbackModal(false); refreshUnreadReplies() }}
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
          poolQuestionCount={poolQuestions.length}
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