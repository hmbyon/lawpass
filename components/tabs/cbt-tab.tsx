'use client'

import { useState, useEffect } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'
import { getSavedSession, clearSavedSession } from '@/lib/store'
import type { SavedSession } from '@/lib/store'

export function CbtTab({ questions, onDone }: { questions: Question[]; onDone: () => void }) {
  const [session, setSession] = useState<{ questions: Question[]; timeLimit: number | null } | null>(null)
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    const s = getSavedSession()
    if (s && s.mode === 'cbt') setSavedSession(s)
  }, [])

  function handleResume() {
    if (!savedSession) return
    setResuming(true)
  }

  function handleDiscardAndNew() {
    clearSavedSession()
    setSavedSession(null)
  }

  if (resuming && savedSession) {
    return (
      <QuizEngine
        questions={savedSession.questions}
        mode="cbt"
        timeLimitSeconds={savedSession.timeLimitSeconds}
        initialIndex={savedSession.currentIndex}
        initialAnswers={savedSession.answers}
        initialElapsed={savedSession.elapsedSeconds}
        sessionId={savedSession.id}
        onFinish={() => {
          setResuming(false)
          setSavedSession(null)
          onDone()
        }}
      />
    )
  }

  if (session) {
    return (
      <QuizEngine
        questions={session.questions}
        mode="cbt"
        timeLimitSeconds={session.timeLimit}
        onFinish={() => {
          setSession(null)
          setSavedSession(null)
          onDone()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-bold text-foreground mb-1">CBT 실전 모드</h2>
        <p className="text-sm text-muted-foreground mb-4">
          실전처럼 타이머를 켜고 문제를 풀고 채점후 오답 원인을 자동 진단합니다.
        </p>
      </div>

      {/* 이어서 풀기 배너 */}
      {savedSession && (
        <div className="max-w-2xl mx-auto bg-primary/10 border border-primary/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-primary text-sm font-semibold">📌 이어서 풀기 가능</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {savedSession.questions.length}문항 중{' '}
            {Object.values(savedSession.answers).filter(Boolean).length}개 답변 완료 ·{' '}
            {new Date(savedSession.savedAt).toLocaleDateString('ko-KR')} 저장
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleResume}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              이어서 풀기
            </button>
            <button
              onClick={handleDiscardAndNew}
              className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/70 transition-colors"
            >
              새로 시작
            </button>
          </div>
        </div>
      )}

      <QuizFilter
        questions={questions}
        mode="cbt"
        onStart={(qs, tl) => setSession({ questions: qs, timeLimit: tl })}
      />
    </div>
  )
}
