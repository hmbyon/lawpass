'use client'

import { useRef, useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { NotesViewer } from '@/components/record/notes-viewer'
import { DrillView } from '@/components/record/drill-view'

type RecordTab = 'notes' | 'drill' | 'import'

// 기록형 화면의 탭 줄 + 본문. 탭 줄 클래스는 사례형(case-study-shell)과 같다
export function RecordShell({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<RecordTab>('notes')
  // 탭마다 스크롤 자리를 기억했다가 돌아오면 되돌린다. 정리본 열람·문제 풀기는 숨길 뿐 언마운트하지 않아
  // 고른 과목·부·펼친 항목, 풀던 카드와 읽어 둔 문서가 그대로 남는다
  const scroll = useRef<Record<RecordTab, number>>({ notes: 0, drill: 0, import: 0 })
  // 문제 풀기는 처음 열 때 마운트한다(카드·결과를 그때 읽는다)
  const [drillMounted, setDrillMounted] = useState(false)
  function switchTab(next: RecordTab) {
    if (next === tab) return
    scroll.current[tab] = window.scrollY
    if (next === 'drill') setDrillMounted(true)
    setTab(next)
    requestAnimationFrame(() => window.scrollTo({ top: scroll.current[next] }))
  }
  const tabs: { id: RecordTab; label: string; icon: string }[] = [
    { id: 'notes', label: '정리본 열람', icon: '📚' },
    { id: 'drill', label: '문제 풀기', icon: '✍️' },
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
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
            <DrillView isAdmin={isAdmin} />
          </div>
        )}
        {/* 일반 사용자에게는 가져오기 트리 자체가 없다 */}
        {tab === 'import' && isAdmin && <ImportPanel />}
      </main>
    </>
  )
}
