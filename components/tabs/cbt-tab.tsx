'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'

export function CbtTab({ questions }: { questions: Question[] }) {
  const [session, setSession] = useState<{ questions: Question[]; timeLimit: number | null } | null>(null)

  if (!session) {
    return (
      <div className="space-y-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-foreground mb-1">CBT 실전 모드</h2>
          <p className="text-sm text-muted-foreground mb-4">
            실전처럼 타이머를 켜고 문제를 풀고 채점 후 오답 원인을 자동 진단합니다.
          </p>
        </div>
        <QuizFilter
          questions={questions}
          mode="cbt"
          onStart={(qs, tl) => setSession({ questions: qs, timeLimit: tl })}
        />
      </div>
    )
  }

  return (
    <QuizEngine
      questions={session.questions}
      mode="cbt"
      timeLimitSeconds={session.timeLimit}
      onFinish={() => setSession(null)}
    />
  )
}
