'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { CaseStudyBrowse, type CaseOpenRequest } from '@/components/case-study/case-study-browse'
import { CaseCbt } from '@/components/case-study/case-cbt'
import { CaseMisses } from '@/components/case-study/case-misses'
import { CaseD1 } from '@/components/case-study/case-d1'

type CaseTab = 'import' | 'cbt' | 'browse' | 'misses' | 'd1'

// 사례형 화면의 탭 줄 + 본문. 탭 줄 클래스는 app-shell 의 객관식 nav 와 같다
export function CaseStudyShell({
  isAdmin,
  openRequest,
  onOpenRequestDone,
  onBackToCases,
}: {
  isAdmin: boolean
  // 판례 화면의 '카드 보기' — 답안·목차 탭에서 그 카드·문항을 연다
  openRequest?: CaseOpenRequest | null
  onOpenRequestDone?: () => void
  onBackToCases?: () => void
}) {
  const [tab, setTab] = useState<CaseTab>('browse')
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
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
    // 처음 열리는 탭은 그대로 답안·목차다
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
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main ref={mainRef} className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
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
