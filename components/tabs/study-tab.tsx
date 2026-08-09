'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'

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
}: {
  questions: Question[]
  onReady: () => void
  onBack: () => void
}) {
  const [current, setCurrent] = useState(0)
  const q = questions[current]
  const isLast = current === questions.length - 1

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
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{q.passage}</p>
        <div className="space-y-2">
          {q.choices.map((c) => (
            <div
              key={c.label}
              className={`flex gap-3 items-start p-3 rounded-lg border text-sm ${
                c.label === q.answer
                  ? 'border-emerald-600 bg-emerald-900/20'
                  : 'border-border'
              }`}
            >
              <span className={`font-semibold shrink-0 ${c.label === q.answer ? 'text-emerald-400' : 'text-primary'}`}>
                {c.label}
              </span>
              <span className="text-foreground">{c.text}</span>
              {c.label === q.answer && (
                <span className="ml-auto shrink-0 text-emerald-400 text-xs font-medium">✓ 정답</span>
              )}
            </div>
          ))}
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
        {questions.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrent(idx)}
            className={`w-6 h-6 rounded text-xs font-medium transition-all ${
              idx === current
                ? 'bg-primary text-primary-foreground'
                : idx < current
                  ? 'bg-emerald-700/50 text-emerald-300'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {idx + 1}
          </button>
        ))}
      </div>
    </div>
  )
}