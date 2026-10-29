'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { CaseStudyBrowse, type CaseOpenRequest } from '@/components/case-study/case-study-browse'
import { CaseCbt } from '@/components/case-study/case-cbt'
import { CaseMisses } from '@/components/case-study/case-misses'
import { CaseD1 } from '@/components/case-study/case-d1'
import { CaseStatus, loadCaseStatus, type CaseStatusData } from '@/components/case-study/case-status'
import { useCaseStars } from '@/components/case-study/case-miss-shared'

type CaseTab = 'status' | 'import' | 'cbt' | 'browse' | 'misses' | 'd1'

// 사례형 화면의 탭 줄 + 본문. 탭 줄 클래스는 app-shell 의 객관식 nav 와 같다
export function CaseStudyShell({
  isAdmin,
  openRequest,
  onOpenRequestDone,
  onBackToCases,
  onCounts,
}: {
  isAdmin: boolean
  // 헤더·설정의 '문제 · 오답'을 사례형 숫자로 보이게 한다(전체 문항 수, 오답노트 문항 수)
  onCounts?: (counts: { problems: number; misses: number }) => void
  // 판례 화면의 '카드 보기' — 답안·목차 탭에서 그 카드·문항을 연다
  openRequest?: CaseOpenRequest | null
  onOpenRequestDone?: () => void
  onBackToCases?: () => void
}) {
  const [tab, setTab] = useState<CaseTab>('status')
  // 학습 현황(+ 오답노트 배지·헤더 숫자)은 그 탭을 열 때마다 다시 읽는다 — 다른 탭에서 제출한 것이 바로 반영된다
  const [status, setStatus] = useState<CaseStatusData | null>(null)
  const [statusError, setStatusError] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const reloadStatus = useCallback(() => {
    setStatusLoading(true)
    setStatusError('')
    loadCaseStatus()
      .then((d) => {
        setStatus(d)
        onCountsRef.current?.({ problems: d.progress.total, misses: d.missCount })
      })
      .catch((e: Error) => setStatusError(e.message))
      .finally(() => setStatusLoading(false))
  }, [])
  const onCountsRef = useRef(onCounts)
  onCountsRef.current = onCounts
  useEffect(() => {
    if (tab === 'status') reloadStatus()
  }, [tab, reloadStatus])
  // D-1 암기장 배지: 찜 저장소는 오답노트·D-1 탭과 같은 것이라 찜·해제가 바로 반영된다
  const { store: stars } = useCaseStars()
  useEffect(() => {
    stars?.load()
  }, [stars])
  const starCount = stars?.all().length ?? 0
  const openNonce = openRequest?.nonce
  // 오답노트의 '카드 보기'도 판례 화면과 같은 요청으로 답안·목차에서 연다. 이때는 '판례로 돌아가기'를 보이지 않는다
  const [missOpen, setMissOpen] = useState<CaseOpenRequest | null>(null)
  const [openedFrom, setOpenedFrom] = useState<'cases' | 'misses'>('cases')
  useEffect(() => {
    if (openNonce === undefined) return
    setOpenedFrom('cases')
    setTab('browse')
  }, [openNonce])
  // 오답노트·D-1 암기장의 '카드 전체 보기' — 답안·목차에서 그 카드·문항을 연다
  function openFromMisses(cardId: string, problemId: string) {
    setOpenedFrom('misses')
    setMissOpen({ cardId, problemId, nonce: Date.now() })
    setTab('browse')
  }
  // 오답노트는 한 번 열면 다른 탭에 다녀와도 그대로 둔다(카드 보기 뒤 돌아왔을 때 다시 읽지 않게)
  const [missesMounted, setMissesMounted] = useState(false)
  useEffect(() => {
    if (tab === 'misses') setMissesMounted(true)
  }, [tab])
  const tabs: { id: CaseTab; label: string; icon: string }[] = [
    // 처음 열리는 탭은 학습 현황이다
    { id: 'status', label: '학습 현황', icon: '📊' },
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
    { id: 'browse', label: '답안·목차', icon: '📚' },
    { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
    { id: 'misses', label: '오답노트', icon: '📝' },
    { id: 'd1', label: 'D-1 암기장', icon: '⭐' },
  ]
  // 카드 안의 고정 바(문항 이동)가 앱 헤더·이 탭 줄에 가려지지 않도록, 탭 줄이 끝나는 높이를
  // --case-sticky-top 으로 내려 준다. 숫자를 박아 두지 않고 탭 줄의 top·높이를 재서 따라간다
  const navRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const main = mainRef.current
    if (!nav || !main) return
    const update = () => {
      const top = parseFloat(getComputedStyle(nav).top) || 0
      main.style.setProperty('--case-sticky-top', `${top + nav.offsetHeight}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(nav)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])
  return (
    <>
      <nav ref={navRef} className="sticky top-14 z-30 bg-background/90 backdrop-blur-sm border-b border-border no-print">
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
                {/* 선택형 탭 줄과 같은 배지. 0이면 숨긴다 */}
                {t.id === 'misses' && (status?.missCount ?? 0) > 0 && (
                  <span className="bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                    {status?.missCount}
                  </span>
                )}
                {t.id === 'd1' && starCount > 0 && (
                  <span className="bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                    {starCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main ref={mainRef} className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        {tab === 'status' && <CaseStatus data={status} error={statusError} loading={statusLoading} onRetry={reloadStatus} />}
        {/* 일반 사용자에게는 가져오기 트리 자체가 없다 */}
        {tab === 'import' && isAdmin && <ImportPanel />}
        {tab === 'cbt' && <CaseCbt />}
        {tab === 'browse' && (
          <CaseStudyBrowse
            request={missOpen ?? openRequest}
            onRequestDone={missOpen ? () => setMissOpen(null) : onOpenRequestDone}
            onBackToCases={openedFrom === 'misses' ? undefined : onBackToCases}
          />
        )}
        {/* D-1 암기장은 열 때마다 다시 읽는다(찜은 오답노트와 같은 저장소를 본다) */}
        {tab === 'd1' && <CaseD1 onOpenCard={openFromMisses} />}
        {missesMounted && (
          <div className={tab === 'misses' ? undefined : 'hidden'}>
            <CaseMisses onOpenCard={openFromMisses} />
          </div>
        )}
      </main>
    </>
  )
}
