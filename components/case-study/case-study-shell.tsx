'use client'

import { useState } from 'react'
import { ImportPanel } from '@/components/case-study/import-panel'
import { CaseStudyBrowse } from '@/components/case-study/case-study-browse'

type CaseTab = 'import' | 'browse'

// 사례형 화면의 탭 줄 + 본문. 탭 줄 클래스는 app-shell 의 객관식 nav 와 같다
export function CaseStudyShell({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<CaseTab>('browse')
  const tabs: { id: CaseTab; label: string; icon: string }[] = [
    ...(isAdmin ? [{ id: 'import' as const, label: '가져오기', icon: '📥' }] : []),
    { id: 'browse', label: '답안·목차', icon: '📚' },
  ]
  return (
    <>
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
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        {/* 일반 사용자에게는 가져오기 트리 자체가 없다 */}
        {tab === 'import' && isAdmin && <ImportPanel />}
        {tab === 'browse' && <CaseStudyBrowse />}
      </main>
    </>
  )
}
