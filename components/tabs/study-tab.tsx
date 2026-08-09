'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'

export function StudyTab({ questions, onDone }: { questions: Question[]; onDone: () => void }) {
  const [session, setSession] = useState<{ questions: Question[]; timeLimit: number | null } | null>(null)

  if (!session) {
    return (
      <div className="space-y-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-foreground mb-1">선학습 모드</h2>
          <p className="text-sm text-muted-foreground mb-4">
            먼저 문제+정답+해설을 학습한 뒤 실제로 풀어봅니다. 틀리면 선학습 적용 실패로 분석됩니다.
          </p>
        </div>
        <QuizFilter
          questions={questions}
          mode="study"
          onStart={(qs, tl) => setSession({ questions: qs, timeLimit: tl })}
        />
      </div>
    )
  }

  return (
    <QuizEngine
      questions={session.questions}
      mode="study"
      timeLimitSeconds={session.timeLimit}
      onFinish={() => {
        setSession(null)
        onDone()
      }}
    />
  )
}