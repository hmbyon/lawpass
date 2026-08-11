'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'
import { addBookmark, removeBookmark, getWrongNotes, updateChoiceMemo } from '@/lib/store'

type StudyPhase = 'filter' | 'preview' | 'quiz'

export function StudyTab({ questions, onDone }: { questions: Question[]; onDone: () => void }) {
  const [phase, setPhase] = useState<StudyPhase>('filter')
  const [session, setSession] = useState<{ questions: Question[]; timeLimit: number | null } | null>(null)

  if (phase === 'filter') {
    return (
      <div className="space-y-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-foreground mb-1">선학습 모드</h2>
          <p className="text-sm text-muted-foreground mb-4">
            전체 문제의 정답·해설을 먼저 학습한 뒤 몰아서 풀어봅니다.
          </p>
        </div>
        <QuizFilter
          questions={questions}
          mode="study"
          onStart={(qs, tl) => {
            setSession({ questions: qs, timeLimit: tl })
            setPhase('preview')
          }}
        />
      </div>
    )
  }

  if (phase === 'preview' && session) {
    return (
      <StudyBulkPreview
        questions={session.questions}
        onReady={() => setPhase('quiz')}
        onBack={() => setPhase('filter')}
        onDone={onDone}
      />
    )
  }

  if (phase === 'quiz' && session) {
    return (
      <QuizEngine
        questions={session.questions}
        mode="study"
        timeLimitSeconds={session.timeLimit}
        onFinish={() => {
          setPhase('filter')
          setSession(null)
          onDone()
        }}
      />
    )
  }

  return null
}

function StudyBulkPreview({
  questions,
  onReady,
  onBack,
  onDone,
}: {
  questions: Question[]
  onReady: () => void
  onBack: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState(0)
  const [bookmarked, setBookmarked] = useState<Set<string>>(() => {
    const notes = getWrongNotes()
    return new Set(
      questions
        .filter((q) => notes.some((n) => n.questionId === q.id && n.isBookmarked))
        .map((q) => q.id)
    )
  })
  const [choiceMemoOpen, setChoiceMemoOpen] = useState<string | null>(null) // "questionId_label"
  const [choiceMemoText, setChoiceMemoText] = useState('')
  const [choiceMemos, setChoiceMemos] = useState<Record<string, Record<string, string>>>(() => {
    const notes = getWrongNotes()
    const result: Record<string, Record<string, string>> = {}
    for (const q of questions) {
      const note = notes.find((n) => n.questionId === q.id)
      if (note?.choiceMemos) result[q.id] = note.choiceMemos
    }
    return result
  })

  const q = questions[current]
  const isLast = current === questions.length - 1
  const isBookmarked = bookmarked.has(q.id)

  function toggleBookmark() {
    if (isBookmarked) {
      removeBookmark(q.id)
      setBookmarked((prev) => { const next = new Set(prev); next.delete(q.id); return next })
    } else {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    onDone()
  }

  function saveChoiceMemo(label: string, memo: string) {
    // 북마크 없으면 먼저 북마크 추가
    if (!isBookmarked) {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    const notes = getWrongNotes()
    const note = notes.find((n) => n.questionId === q.id)
    if (note) {
      updateChoiceMemo(note.id, label, memo)
    }
    setChoiceMemos((prev) => {
      const next = { ...prev }
      if (!next[q.id]) next[q.id] = {}
      if (memo.trim()) {
        next[q.id] = { ...next[q.id], [label]: memo }
      } else {
        const { [label]: _, ...rest } = next[q.id]
        next[q.id] = rest
      }
      return next
    })
    setChoiceMemoOpen(null)
    setChoiceMemoText('')
    onDone()
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* 진행 헤더 */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          학습 {current + 1} / {questions.length}
        </span>
        <span className="bg-purple-800/50 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-700/40">
          선학습 미리보기
        </span>
        <span className="text-xs text-muted-foreground">{q.subject} · {q.year}년</span>
      </div>

      {/* 문제 + 정답 + 해설 */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        {/* 북마크 버튼 */}
        <div className="flex justify-end">
          <button
            onClick={toggleBookmark}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              isBookmarked
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                : 'bg-muted text-muted-foreground border-border hover:border-yellow-500/40 hover:text-yellow-400'
            }`}
          >
            {isBookmarked ? '⭐ 암기장에 추가됨' : '☆ 암기장에 추가'}
          </button>
        </div>

        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{q.passage}</p>
        <div className="space-y-2">
          {q.choices.map((c) => {
            const memoKey = `${q.id}_${c.label}`
            const existingMemo = choiceMemos[q.id]?.[c.label]
            const isOpen = choiceMemoOpen === memoKey
            return (
              <div key={c.label}>
                <div
                  className={`flex gap-3 items-start p-3 rounded-lg border text-sm ${
                    c.label === q.answer
                      ? 'border-emerald-600 bg-emerald-900/20'
                      : 'border-border'
                  }`}
                >
                  <span className={`font-semibold shrink-0 ${c.label === q.answer ? 'text-emerald-400' : 'text-primary'}`}>
                    {c.label}
                  </span>
                  <span className="text-foreground flex-1">{c.text}</span>
                  {c.label === q.answer && (
                    <span className="shrink-0 text-emerald-400 text-xs font-medium">✓ 정답</span>
                  )}
                  <button
                    onClick={() => {
                      if (isOpen) {
                        setChoiceMemoOpen(null)
                        setChoiceMemoText('')
                      } else {
                        setChoiceMemoOpen(memoKey)
                        setChoiceMemoText(existingMemo ?? '')
                      }
                    }}
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                      existingMemo
                        ? 'text-yellow-400 hover:text-yellow-300'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title="선지 메모"
                  >
                    {existingMemo ? '📌' : '🖊️'}
                  </button>
                </div>
                {/* 선지 메모 표시 */}
                {existingMemo && !isOpen && (
                  <div className="ml-3 mt-1 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
                    {existingMemo}
                  </div>
                )}
                {/* 선지 메모 입력 */}
                {isOpen && (
                  <div className="ml-3 mt-1 space-y-1.5">
                    <textarea
                      value={choiceMemoText}
                      onChange={(e) => setChoiceMemoText(e.target.value)}
                      placeholder="이 선지에서 유의할 점을 메모하세요..."
                      rows={2}
                      autoFocus
                      className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setChoiceMemoOpen(null); setChoiceMemoText('') }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        취소
                      </button>
                      {existingMemo && (
                        <button
                          onClick={() => saveChoiceMemo(c.label, '')}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          삭제
                        </button>
                      )}
                      <button
                        onClick={() => saveChoiceMemo(c.label, choiceMemoText)}
                        className="text-xs text-primary font-medium hover:opacity-80"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {q.explanation && (
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
            <p className="text-sm text-foreground leading-relaxed">{q.explanation}</p>
          </div>
        )}
      </div>

      {/* 네비게이션 */}
      <div className="flex gap-2">
        <button
          onClick={() => current === 0 ? onBack() : setCurrent(c => c - 1)}
          className="flex-1 py-2 bg-muted rounded-lg text-sm font-medium hover:bg-muted/70 transition-colors"
        >
          {current === 0 ? '← 필터로' : '이전'}
        </button>
        {isLast ? (
          <button
            onClick={onReady}
            className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            학습 완료 — 문제 풀기 →
          </button>
        ) : (
          <button
            onClick={() => setCurrent(c => c + 1)}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            다음
          </button>
        )}
      </div>

      {/* 도트 네비게이션 */}
      <div className="flex flex-wrap gap-1 justify-center">
        {questions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => setCurrent(idx)}
            className={`w-6 h-6 rounded text-xs font-medium transition-all ${
              idx === current
                ? 'bg-primary text-primary-foreground'
                : bookmarked.has(q.id)
                  ? 'bg-yellow-500/30 text-yellow-300'
                  : idx < current
                    ? 'bg-emerald-700/50 text-emerald-300'
                    : 'bg-muted text-muted-foreground'
            }`}
          >
            {idx + 1}
          </button>
        ))}
      </div>

      {/* 북마크 현황 */}
      {bookmarked.size > 0 && (
        <p className="text-xs text-center text-yellow-400">
          ⭐ {bookmarked.size}개 암기장에 추가됨
        </p>
      )}
    </div>
  )
}
