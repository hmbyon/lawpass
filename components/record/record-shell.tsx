'use client'

import { useRef, useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { NotesViewer } from '@/components/record/notes-viewer'
import { DrillView } from '@/components/record/drill-view'
import { RecordMisses } from '@/components/record/record-misses'

type RecordTab = 'notes' | 'drill' | 'import' | 'misses'

// 기록형 화면의 탭 줄 + 본문. 탭 줄 클래스는 사례형(case-study-shell)과 같다
export function RecordShell({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<RecordTab>('notes')
  // 탭마다 스크롤 자리를 기억했다가 돌아오면 되돌린다. 정리본 열람·문제 풀기는 숨길 뿐 언마운트하지 않아
  // 고른 과목·부·펼친 항목, 풀던 카드와 읽어 둔 문서가 그대로 남는다
  const scroll = useRef<Record<RecordTab, number>>({ notes: 0, drill: 0, import: 0, misses: 0 })
  // 문제 풀기는 처음 열 때 마운트한다(카드·결과를 그때 읽는다)
  const [drillMounted, setDrillMounted] = useState(false)
  // 오답노트는 처음 열 때 한 번 읽고, 다른 탭에 다녀와도 그대로 둔다(사례형과 같다)
  const [missesMounted, setMissesMounted] = useState(false)
  // 오답노트의 '이 카드 풀어 보기' → 문제 풀기에서 그 카드 한 장을 연다
  const [drillOpen, setDrillOpen] = useState<{ cardId: string; nonce: number } | null>(null)
  function switchTab(next: RecordTab) {
    if (next === tab) return
    scroll.current[tab] = window.scrollY
    if (next === 'drill') setDrillMounted(true)
    if (next === 'misses') setMissesMounted(true)
    setTab(next)
    requestAnimationFrame(() => window.scrollTo({ top: scroll.current[next] }))
  }
  const tabs: { id: RecordTab; label: string; icon: string }[] = [
    { id: 'notes', label: '정리본 열람', icon: '📚' },
    // 사례형처럼 가져오기를 앞쪽에
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
    { id: 'drill', label: '문제 풀기', icon: '✍️' },
    { id: 'misses', label: '오답노트', icon: '📝' },
  ]
  return (
    <>
      <nav className="sticky top-14 z-30 bg-background/90 backdrop-blur-sm border-b border-border no-print">
        <div className="max-w-3xl mx-auto px-2">
          <div className="flex overflow-x-auto scrollbar-hide">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
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
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        <div className={tab === 'notes' ? undefined : 'hidden'}>
          <NotesViewer />
        </div>
        {drillMounted && (
          <div className={tab === 'drill' ? undefined : 'hidden'}>
            <DrillView isAdmin={isAdmin} openRequest={drillOpen} onOpenRequestDone={() => setDrillOpen(null)} />
          </div>
        )}
        {missesMounted && (
          <div className={tab === 'misses' ? undefined : 'hidden'}>
            <RecordMisses
              onOpenCard={(cardId) => {
                setDrillOpen({ cardId, nonce: Date.now() })
                scroll.current.drill = 0 // 새로 연 카드는 맨 위에서
                switchTab('drill')
              }}
            />
          </div>
        )}
        {/* 일반 사용자에게는 가져오기 트리 자체가 없다 */}
        {tab === 'import' && isAdmin && <ImportPanel variant="record" />}
      </main>
    </>
  )
}
