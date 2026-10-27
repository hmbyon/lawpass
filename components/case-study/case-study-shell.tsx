'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { CaseStudyBrowse, type CaseOpenRequest } from '@/components/case-study/case-study-browse'
import { CaseCbt } from '@/components/case-study/case-cbt'

type CaseTab = 'import' | 'cbt' | 'browse'

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
  useEffect(() => {
    if (openNonce !== undefined) setTab('browse')
  }, [openNonce])
  const tabs: { id: CaseTab; label: string; icon: string }[] = [
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
    // 선택형 탭 줄처럼 첫 탭(가져오기) 다음에 둔다. 처음 열리는 탭은 그대로 답안·목차다
    { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
    { id: 'browse', label: '답안·목차', icon: '📚' },
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
          <CaseStudyBrowse request={openRequest} onRequestDone={onOpenRequestDone} onBackToCases={onBackToCases} />
        )}
      </main>
    </>
  )
}
