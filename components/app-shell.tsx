'use client'

import { useState, useCallback, useEffect } from 'react'
import type { Question, WrongNote } from '@/lib/types'
import { getQuestions, getWrongNotes, clearAll } from '@/lib/store'
import { PdfTab } from '@/components/tabs/pdf-tab'
import { CbtTab } from '@/components/tabs/cbt-tab'
import { StudyTab } from '@/components/tabs/study-tab'
import { WrongTab } from '@/components/tabs/wrong-tab'
import { MemoTab } from '@/components/tabs/memo-tab'

type Tab = 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pdf', label: 'PDF 분석', icon: '📄' },
  { id: 'cbt', label: 'CBT 실전', icon: '⚡' },
  { id: 'study', label: '선학습', icon: '📖' },
  { id: 'wrong', label: '오답노트', icon: '📝' },
  { id: 'memo', label: 'D-1 암기장', icon: '⭐' },
]

export function AppShell() {
  const [tab, setTab] = useState<Tab>('pdf')
  const [questions, setQuestions] = useState<Question[]>([])
  const [wrongNotes, setWrongNotes] = useState<WrongNote[]>([])

  const refresh = useCallback(() => {
    setQuestions(getQuestions())
    setWrongNotes(getWrongNotes())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function handleClearAll() {
    if (!confirm('모든 데이터(문제은행 + 오답노트)를 초기화할까요? 되돌릴 수 없습니다.')) return
    clearAll()
    refresh()
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-primary text-lg font-bold tracking-tight">LawPass AI</span>
            <span className="hidden sm:inline text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">
              변호사시험
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{questions.length}문제</span>
            <span>오답 {wrongNotes.length}</span>
            <button
              onClick={handleClearAll}
              className="text-red-400/70 hover:text-red-400 transition-colors"
            >
              초기화
            </button>
          </div>
        </div>
      </header>

      {/* Tab bar */}
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

      {/* Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5">
        {tab === 'pdf' && (
          <PdfTab onQuestionsAdded={refresh} />
        )}
        {tab === 'cbt' && (
          <CbtTab questions={questions} />
        )}
        {tab === 'study' && (
          <StudyTab questions={questions} />
        )}
        {tab === 'wrong' && (
          <WrongTab notes={wrongNotes} onNotesChanged={refresh} />
        )}
        {tab === 'memo' && (
          <MemoTab notes={wrongNotes} />
        )}
      </main>
    </div>
  )
}
