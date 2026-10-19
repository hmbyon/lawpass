'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import type { Question, WrongNote } from '@/lib/types'
import { FOREIGN_DRAWINGS_CHANGED_EVENT, SOLVED_CHANGED_EVENT, getQuestions, getPoolQuestions, getWrongNotes, clearAll , isInMemoList, hasPendingSync } from '@/lib/store'
import { logout } from '@/lib/firebaseServices/auth'
import { pullFromFirebase, pushToFirebase, syncHighlights, syncForeignDrawings, syncSolved, fetchAdminQuestions, ADMIN_UID } from '@/lib/firebaseServices/sync'
import { HIGHLIGHTS_CHANGED_EVENT } from '@/lib/highlights'
import { recordUserDirectory } from '@/lib/firebaseServices/userDirectory'
import { isAccountSwitch, rememberUid, unsyncedModes, clearAccountData } from '@/lib/accountSwitch'
import { getAppMode, setAppMode, type AppMode } from '@/lib/appMode'
import { FeedbackModal } from '@/components/feedback-modal'
import { isAdminEmail } from '@/lib/admin'
import { countUnreadFeedback, countUnreadReplies } from '@/lib/firebaseServices/feedback'
import { SettingsModal } from '@/components/settings-modal'
import { AdminFeedbackModal } from '@/components/admin-feedback-modal'
import { PdfTab } from '@/components/tabs/pdf-tab'
import { DashboardTab } from '@/components/tabs/dashboard-tab'
import { CbtTab } from '@/components/tabs/cbt-tab'
import { StudyTab } from '@/components/tabs/study-tab'
import { WrongTab } from '@/components/tabs/wrong-tab'
import { MemoTab } from '@/components/tabs/memo-tab'
import { CasesTab } from '@/components/tabs/cases-tab'
import { OnboardingModal } from '@/components/onboarding-modal'
import { getStudyKind, setStudyKind, type StudyKind } from '@/lib/studyKind'
import { CaseStudyShell } from '@/components/case-study/case-study-shell'
import type { CaseOpenRequest } from '@/components/case-study/case-study-browse'
import { fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import type { CaseIndex } from '@/lib/caseStudy/types'

type Tab = 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo'
// 판례는 선택형 안의 탭이 아니라 문제유형(선택·사례·기록)과 별개인 화면이다. 헤더의 ⚖️ 버튼(모바일은 유형 알약 메뉴)으로 연다
type View = 'study' | 'cases'

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
  // 첫 탭은 관리자에게는 'PDF 분석', 일반 사용자에게는 '학습 현황'이다 (AppShell 에서 갈아 끼운다)
  { id: 'pdf', label: 'PDF 분석', icon: '📄' },
  { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
  { id: 'study', label: '선학습', icon: '📖' },
  { id: 'wrong', label: '오답노트', icon: '📝' },
  { id: 'memo', label: 'D-1 암기장', icon: '⭐' },
]

// 유형 스위치. 헤더 폭(max-w-3xl)이 '동기화 중...' 이 뜬 상태에서 거의 꽉 차 있어 두 글자로 줄이고
// 전체 이름은 title 로 보인다
const STUDY_KINDS: { id: StudyKind; label: string; title: string }[] = [
  { id: 'objective', label: '선택', title: '선택형' },
  { id: 'caseStudy', label: '사례', title: '사례형' },
  { id: 'record', label: '기록', title: '기록형 (준비 중)' },
]

interface Props {
  user: User
}

export function AppShell({ user }: Props) {
  const [tab, setTab] = useState<Tab>('pdf')
  // 판례 화면을 여닫아도 kind·tab 은 그대로다. 학습 화면은 숨길 뿐 언마운트하지 않는다
  const [view, setView] = useState<View>('study')
  // 판례 화면은 한 번 열면 계속 마운트해 둔다 — 사례형 카드로 갔다 돌아와도 검색·칩·스크롤이 남게
  const [casesMounted, setCasesMounted] = useState(false)
  const viewScroll = useRef<Record<View, number>>({ study: 0, cases: 0 })
  // 판례 화면의 '카드 보기' → 사례형 답안·목차에서 그 카드·문항을 연다 (열고 나면 비운다)
  const [caseOpenRequest, setCaseOpenRequest] = useState<CaseOpenRequest | null>(null)
  // 모바일 유형 알약 메뉴 (선택형 · 사례형 · 판례)
  const [kindMenu, setKindMenu] = useState(false)
  const kindMenuRef = useRef<HTMLDivElement>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  // 공유받은 문제는 내 문제와 한 배열에 담지 않는다. 화면에 넘길 때만 합치고,
  // 저장·동기화 경로에는 끝까지 따로 둔다 (docs/shared-pool-design.md §3)
  const [poolQuestions, setPoolQuestions] = useState<Question[]>([])
  // 관리자 계정이 올려 둔 문제. 로그인한 사람이면 발행·권한부여 없이 바로 풀 수 있다.
  // 공유받은 문제(poolQuestions)와 같은 원칙으로 내 문제와 한 배열에 담지 않는다 —
  // 화면에 넘길 때만 합치고 저장·동기화 경로에는 들어가지 않는다
  const [adminQuestions, setAdminQuestions] = useState<Question[]>([])
  // 관리자 본인은 받아올 필요가 없다 (자기 문제는 이미 questions 에 있다)
  const isAdminAccount = isAdminEmail(user.email) || user.uid === ADMIN_UID
  // 관리자 문제를 받아오는 중. 내 데이터 동기화가 끝나도 이게 끝나기 전에는 문제가 0개로 보이므로,
  // 대시보드가 '문제 없음' 안내를 잠깐 띄웠다 지우지 않도록 로딩으로 취급한다
  const [adminLoading, setAdminLoading] = useState(!isAdminAccount)
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
  const [studyKind, setStudyKindState] = useState<StudyKind>(() => getStudyKind())
  // ExamPass(일반수험)에는 사례형이 없다. 스위치도 그리지 않고 늘 객관식이다
  const kind: StudyKind = mode === 'general' ? 'objective' : studyKind
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  // 관리자 계정에서만 안읽은 피드백 수를 조회해 헤더 버튼에 표시한다
  const isAdmin = isAdminEmail(user.email)
  // 첫 탭 자리는 같지만 사람에 따라 다른 화면이다. 이름도 그 화면에 맞춘다
  const tabs = isAdmin
    ? TABS
    : TABS.map((t) => (t.id === 'pdf' ? { ...t, label: '학습 현황', icon: '📊' } : t))
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

    // 관리자 문제는 내 데이터와 따로 받아온다. 실패해도 내 데이터 불러오기를 막지 않는다 —
    // 남의 문제를 못 읽은 것 때문에 내 문제집이 안 열리면 그게 더 큰 사고다
    if (isAdminAccount) {
      setAdminQuestions([])
      setAdminLoading(false)
    } else {
      setAdminLoading(true)
      fetchAdminQuestions(getAppMode())
        .then(setAdminQuestions)
        .catch((e) => {
          console.error('공유 문제(관리자 계정)를 불러오지 못했습니다', e)
          setAdminQuestions([])
        })
        .finally(() => setAdminLoading(false))
    }

    setSyncing(true)
    try {
      await pullFromFirebase(user.uid)
      // pull만으로는 미동기화 플래그가 풀리지 않는다. 로그인 시점에 올리지 못한 로컬 변경이 있으면
      // 여기서 올려야 한다 — 예전에는 push 호출부가 탭 콜백뿐이라 로그인만으로는 영영 동기화되지 않았다.
      // pull이 성공한 뒤에만 올린다 (불러오기 실패 상태에서 올리면 빈 로컬로 원격을 덮어쓴다)
      if (hasPendingSync()) await pushToFirebase(user.uid)
      setSyncError(null)
      // 형광펜·밑줄 표시. 문제 목록과 따로 맞추고, 실패해도 나머지 동기화를 실패로 만들지 않는다
      // (표시는 이 기기에 그대로 있다). 화면이 다시 그려지기 전에 끝내야 받은 표시가 바로 보인다
      await syncHighlights(user.uid).catch((e) => console.error('표시 동기화 실패', e))
      // 관리자 공유 문제에 그린 그림도 같은 방식으로 맞춘다
      await syncForeignDrawings(user.uid).catch((e) => console.error('공유 문제 그림 동기화 실패', e))
      // 푼 문제 기록(맞힌 문제 포함)도 맞춘다
      await syncSolved(user.uid).catch((e) => console.error('푼 문제 동기화 실패', e))
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
  }, [user.uid, refresh, isAdminAccount])

  useEffect(() => {
    loadFromFirebase()
  }, [loadFromFirebase])

  // 표시를 칠 때마다 올리면 요청이 쏟아지므로, 잠잠해진 뒤 한 번만 맞춘다
  useEffect(() => {
    let timer: number | null = null
    const onChanged = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        syncHighlights(user.uid).catch((e) => console.error('표시 동기화 실패', e))
        syncForeignDrawings(user.uid).catch((e) => console.error('공유 문제 그림 동기화 실패', e))
        syncSolved(user.uid).catch((e) => console.error('푼 문제 동기화 실패', e))
      }, 3000)
    }
    window.addEventListener(HIGHLIGHTS_CHANGED_EVENT, onChanged)
    window.addEventListener(FOREIGN_DRAWINGS_CHANGED_EVENT, onChanged)
    window.addEventListener(SOLVED_CHANGED_EVENT, onChanged)
    return () => {
      window.removeEventListener(HIGHLIGHTS_CHANGED_EVENT, onChanged)
      window.removeEventListener(FOREIGN_DRAWINGS_CHANGED_EVENT, onChanged)
      window.removeEventListener(SOLVED_CHANGED_EVENT, onChanged)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [user.uid])

  // 이메일→uid 대응표에 내 계정을 남긴다. 관리자가 이메일로 문제집 권한을 줄 때
  // uid를 찾는 유일한 수단이다 (docs/shared-pool-design.md §1.4).
  // 동기화와 별개의 부가 기록이라 실패해도 조용히 넘어간다 — 규칙 배포 전에는 거부된다
  useEffect(() => {
    recordUserDirectory(user)
  }, [user])

  // 판례 화면에 함께 보일 사례형 판례 색인. 판례 화면을 처음 열 때 모드별로 한 번만 읽는다.
  // 실패해도 선택형 판례 화면은 그대로 돈다 — 사례형 출처만 빠지고 탭이 작게 알린다
  const [caseIndex, setCaseIndex] = useState<{ mode: AppMode; index: CaseIndex | null; error: boolean } | null>(null)
  const caseIndexMode = caseIndex?.mode
  useEffect(() => {
    if (view !== 'cases' || caseIndexMode === mode) return
    let alive = true
    fetchCaseIndex(mode)
      .then((index) => alive && setCaseIndex({ mode, index, error: false }))
      .catch((e) => {
        console.error('[app-shell] 사례형 판례 색인을 불러오지 못했습니다', e)
        if (alive) setCaseIndex({ mode, index: null, error: true })
      })
    return () => {
      alive = false
    }
  }, [view, mode, caseIndexMode])

  useEffect(() => {
    if (!kindMenu) return
    function handleClickOutside(e: MouseEvent) {
      if (kindMenuRef.current && !kindMenuRef.current.contains(e.target as Node)) setKindMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [kindMenu])

  // 학습 ↔ 판례 화면 전환. 각 화면의 스크롤 자리를 기억했다가 돌아오면 되돌린다
  function switchView(next: View) {
    if (next === view) return
    viewScroll.current[view] = window.scrollY
    if (next === 'cases') setCasesMounted(true)
    setView(next)
    requestAnimationFrame(() => window.scrollTo({ top: viewScroll.current[next] }))
  }

  function chooseKind(next: StudyKind) {
    setStudyKind(next)
    setStudyKindState(next)
    switchView('study')
  }

  // 판례 화면의 사례형 출처 '카드 보기'. 사례형으로 바꿔 그 카드·문항을 연다 —
  // 스크롤은 카드 화면이 그 문항으로 맞추므로 여기서 되돌리지 않는다
  function openCaseCard(cardId: string, problemId: string) {
    viewScroll.current.cases = window.scrollY
    setStudyKind('caseStudy')
    setStudyKindState('caseStudy')
    setCaseOpenRequest({ cardId, problemId, nonce: Date.now() })
    setView('study')
  }

  useEffect(() => {
    refreshUnreadFeedback()
  }, [refreshUnreadFeedback])

  useEffect(() => {
    refreshUnreadReplies()
  }, [refreshUnreadReplies])

  function handleLogoClick() {
    setTab('pdf')
    switchView('study')
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
  // 동기화 실패(⚠️·☁️)나 동기화 중('동기화 중...') 상태에서는 헤더가 넘친다. 그때만 모바일에서
  // 간격·여백을 줄이고 유형 알약을 ⇄ 하나로 접으며, 데스크톱에서는 모드 배지를 접는다 (평상시 모양은 그대로)
  const compactHeader = badges.error || syncing

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
          <div className={`flex items-center gap-2 ${compactHeader ? 'max-sm:gap-1' : ''}`}>
            <button
              onClick={handleLogoClick}
              className="text-primary text-lg font-bold tracking-tight hover:opacity-80 transition-opacity"
            >
              {appTitleBase}<span className="hidden sm:inline"> AI</span>
            </button>
            {/* 동기화 중·실패로 헤더가 빡빡할 때는 데스크톱에서도 모드 배지를 접는다 — ⚖️ 판례 버튼까지 들어가면
                로고가 두 줄로 접힌다. 평상시에는 그대로 보인다 */}
            <span className={`${compactHeader ? 'hidden' : 'hidden sm:inline'} text-xs text-muted-foreground`}>
              {appBadge}
            </span>
            {/* 390px 폭에서는 세그먼트 셋이 헤더 한 줄에 들어가지 않는다(남는 폭이 40px 남짓).
                모바일은 지금 유형만 보이는 알약 하나로 객관식↔사례형을 오간다 — 기록형은 어차피 고를 수 없다 */}
            {mode !== 'general' && (
              <div ref={kindMenuRef} className="sm:hidden relative shrink-0">
                <button
                  onClick={() => setKindMenu((v) => !v)}
                  aria-expanded={kindMenu}
                  aria-haspopup="menu"
                  title={`문제 유형 · 판례 (지금: ${view === 'cases' ? '판례' : kind === 'objective' ? '선택형' : '사례형'})`}
                  className={`rounded-full border border-primary/40 bg-primary/10 text-primary text-[10px] font-semibold leading-none py-1 ${compactHeader ? 'px-0.5' : 'px-1'}`}
                >
                  {!compactHeader && (view === 'cases' ? '판례' : kind === 'objective' ? '선택' : '사례')}⇄
                </button>
                {kindMenu && (
                  <div role="menu" className="absolute left-0 top-8 z-50 w-32 rounded-xl border border-border bg-card py-1 shadow-lg">
                    {([
                      { id: 'objective', label: '선택형', active: view === 'study' && kind === 'objective' },
                      { id: 'caseStudy', label: '사례형', active: view === 'study' && kind === 'caseStudy' },
                      { id: 'cases', label: '⚖️ 판례', active: view === 'cases' },
                    ] as const).map((item) => (
                      <button
                        key={item.id}
                        role="menuitem"
                        onClick={() => {
                          setKindMenu(false)
                          if (item.id === 'cases') switchView(view === 'cases' ? 'study' : 'cases')
                          else chooseKind(item.id)
                        }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          item.active ? 'text-primary font-semibold bg-primary/10' : 'text-foreground hover:bg-accent'
                        } ${item.id === 'cases' ? 'border-t border-border' : ''}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode !== 'general' && (
              <div className="hidden sm:flex items-center shrink-0 rounded-full border border-border p-0.5 text-[11px] leading-none">
                {STUDY_KINDS.map((k) => (
                  <button
                    key={k.id}
                    // 기록형은 아직 화면이 없다
                    disabled={k.id === 'record'}
                    title={k.title}
                    onClick={() => chooseKind(k.id)}
                    className={`rounded-full px-1.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      view === 'study' && kind === k.id ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            )}
            {/* 판례 — 유형 스위치(선택·사례·기록)와 별개인 화면이라 스위치 밖 아이콘 버튼으로 둔다. 모바일은 알약 메뉴 */}
            <button
              onClick={() => switchView(view === 'cases' ? 'study' : 'cases')}
              aria-pressed={view === 'cases'}
              title={view === 'cases' ? '판례 닫기' : '판례'}
              className={`hidden sm:inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] leading-5 transition-colors ${
                view === 'cases'
                  ? 'border-primary bg-primary/15 text-primary font-semibold'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              }`}
            >
              ⚖️ 판례
            </button>
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
          <div className={`flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground shrink-0 ${compactHeader ? 'max-sm:gap-1' : ''}`}>
            {syncing && <span className="text-primary animate-pulse">동기화 중...</span>}
            {/* 실패(예외)와 미동기화(아직 안 올라감)는 다른 상태다. 예전에는 실패만 표시해서
                push가 한 번도 안 돌아간 경우엔 아무 표시도 뜨지 않았다 */}
            {badges.error && (
              <button
                onClick={loadFromFirebase}
                title={`${syncError} 눌러서 다시 시도합니다.`}
                className="text-red-400 border border-red-500/40 bg-red-500/10 rounded-full px-2 max-sm:px-1 py-0.5 hover:bg-red-500/20 transition-colors"
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
                className={`text-amber-400 border border-amber-500/40 bg-amber-500/10 rounded-full px-2 py-0.5 hover:bg-amber-500/20 transition-colors ${compactHeader ? 'max-sm:px-1' : ''}`}
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

      {/* 판례 화면. 처음 열 때 마운트하고 그 뒤로는 숨기기만 한다 — 사례형 카드로 갔다 돌아와도
          검색·칩·즐겨찾기 상태가 그대로다. key 는 모드: 동기화마다 리셋하지 않고(목록은 questions 가
          바뀌면 다시 계산된다) 모드가 바뀔 때만 새로 연다(즐겨찾기가 모드별이다).
          문항은 내 문제 + 공유받은 문제집 + 관리자 문제를 합친 것이고, 사례형 색인이 오면 사례형 출처가 더해진다 */}
      {casesMounted && (
        <main className={`flex-1 max-w-3xl mx-auto w-full px-4 py-5 ${view === 'cases' ? '' : 'hidden'}`}>
          <CasesTab
            key={mode}
            questions={[...questions, ...poolQuestions, ...adminQuestions]}
            caseIndex={caseIndex?.mode === mode ? caseIndex.index : undefined}
            caseIndexError={caseIndex?.mode === mode && caseIndex.error}
            onOpenCaseCard={openCaseCard}
          />
        </main>
      )}

      {/* 학습 화면 — 판례를 여는 동안에는 숨길 뿐 언마운트하지 않는다(진행 중이던 탭·세션이 그대로).
          'contents' 라 감싸도 nav 의 sticky·main 의 flex 배치는 예전과 같다 */}
      <div className={view === 'cases' ? 'hidden' : 'contents'}>
      {/* 객관식은 기존 nav·main 그대로다. 사례형만 전용 탭 줄과 화면으로 갈아 끼운다.
          동기화·인증·피드백 훅은 위에서 kind 와 무관하게 늘 돈다 */}
      {kind === 'objective' ? (<>
      <nav className="sticky top-14 z-30 bg-background/90 backdrop-blur-sm border-b border-border no-print">
        <div className="max-w-3xl mx-auto px-2">
          <div className="flex overflow-x-auto scrollbar-hide">
            {tabs.map((t) => (
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
        {/* 첫 탭은 관리자 여부로 화면 자체를 가른다. 일반 사용자에게는 PdfTab — 업로드·Gemini 파싱·
            검토 화면 — 이 아예 마운트되지 않는다. 버튼을 숨기는 것이 아니라 트리가 없다.
            PdfTab 안의 버튼별 isAdmin 게이트는 안전망으로 그대로 둔다 */}
        {tab === 'pdf' &&
          (isAdmin ? (
            <PdfTab syncedAt={syncedAt} onQuestionsAdded={refreshAndSync} isAdmin={isAdmin} />
          ) : (
            <DashboardTab key={syncedAt} questions={[...questions, ...poolQuestions, ...adminQuestions]} wrongNotes={wrongNotes} loading={syncedAt === 0 || adminLoading} />
          ))}
        {/* 공유받은 문제를 합쳐 넘긴다. 합치는 것은 화면에 보여줄 배열뿐이고,
            문항에 붙은 poolId 가 그대로 따라가 오답노트·학습 세션 사본에도 출처가 남는다.
            선학습은 세션을 시작할 때 이 배열에서 고른 문항을 통째로 스냅샷으로 잡으므로,
            진행 중에 공유 문제집이 재발행돼도 그 세션의 문제 구성은 그대로다 */}
        {tab === 'cbt' && <CbtTab key={syncedAt} questions={[...questions, ...poolQuestions, ...adminQuestions]} onDone={refreshAndSync} />}
        {tab === 'study' && <StudyTab key={syncedAt} questions={[...questions, ...poolQuestions, ...adminQuestions]} onDone={refreshAndSync} onSync={refreshAndSync} />}
        {tab === 'wrong' && <WrongTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
        {tab === 'memo' && <MemoTab key={syncedAt} notes={wrongNotes} onNotesChanged={refreshAndSync} />}
      </main>
      </>) : (
        <CaseStudyShell
          isAdmin={isAdmin}
          openRequest={caseOpenRequest}
          onOpenRequestDone={() => setCaseOpenRequest(null)}
          onBackToCases={() => switchView('cases')}
        />
      )}
      </div>

      {showOnboarding && (
        <OnboardingModal
          onClose={() => setShowOnboarding(false)}
          onSelectTab={(selectedTab) => {
            setTab(selectedTab)
            switchView('study')
          }}
          isAdmin={isAdmin}
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