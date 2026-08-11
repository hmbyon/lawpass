'use client'

import { useState, useEffect } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'
import {
  addBookmark, removeBookmark, getWrongNotes, updateChoiceMemo,
  saveStudySession, getSavedStudySession, clearSavedStudySession,
  clearSavedSession, getSavedSession
} from '@/lib/store'
import type { SavedStudySession } from '@/lib/store'

type StudyPhase = 'filter' | 'preview' | 'quiz'

export function StudyTab({ questions, onDone }: { questions: Question[]; onDone: () => void }) {
  const [phase, setPhase] = useState<StudyPhase>('filter')
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [previewFrom, setPreviewFrom] = useState(0)
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([])
  const [savedStudy, setSavedStudy] = useState<SavedStudySession | null>(null)
  const [savedQuiz, setSavedQuiz] = useState(getSavedSession())

  useEffect(() => {
    const s = getSavedStudySession()
    if (s) setSavedStudy(s)
    const q = getSavedSession()
    if (q && q.mode === 'study') setSavedQuiz(q)
  }, [])

  function handleNewStart(qs: Question[]) {
    clearSavedStudySession()
    clearSavedSession()
    setAllQuestions(qs)
    setPreviewFrom(0)
    setSavedStudy(null)
    setSavedQuiz(null)
    setPhase('preview')
  }

  function handlePartialQuiz(upToIndex: number) {
    const toQuiz = allQuestions.slice(0, upToIndex + 1)
    const remaining = upToIndex + 1

    if (remaining < allQuestions.length) {
      saveStudySession({
        allQuestions,
        previewedIndex: upToIndex,
        remainingFrom: remaining,
        savedAt: Date.now(),
      })
    } else {
      clearSavedStudySession()
    }

    setQuizQuestions(toQuiz)
    setPhase('quiz')
  }

  function handleQuizFinish() {
    const saved = getSavedStudySession()
    clearSavedSession()
    if (saved && saved.remainingFrom < saved.allQuestions.length) {
      setAllQuestions(saved.allQuestions)
      setPreviewFrom(saved.remainingFrom)
      setSavedStudy(null)
      setPhase('preview')
    } else {
      clearSavedStudySession()
      setSavedStudy(null)
      setSavedQuiz(null)
      setPhase('filter')
    }
    onDone()
  }

  function handleResumePreview() {
    if (!savedStudy) return
    setAllQuestions(savedStudy.allQuestions)
    setPreviewFrom(savedStudy.remainingFrom)
    setSavedStudy(null)
    setPhase('preview')
  }

  function handleResumeQuiz() {
    if (!savedQuiz || savedQuiz.mode !== 'study') return
    setQuizQuestions(savedQuiz.questions)
    setSavedQuiz(null)
    setPhase('quiz')
  }

  if (phase === 'preview') {
    return (
      <StudyBulkPreview
        questions={allQuestions}
        startFrom={previewFrom}
        onPartialQuiz={handlePartialQuiz}
        onSaveAndExit={(upToIndex) => {
          saveStudySession({
            allQuestions,
            previewedIndex: upToIndex,
            remainingFrom: upToIndex,
            savedAt: Date.now(),
          })
          setPhase('filter')
          setSavedStudy(getSavedStudySession())
        }}
        onBack={() => {
          clearSavedStudySession()
          setPhase('filter')
        }}
        onDone={onDone}
      />
    )
  }

  if (phase === 'quiz') {
    const saved = getSavedSession()
    return (
      <QuizEngine
        questions={quizQuestions.length > 0 ? quizQuestions : (saved?.questions ?? [])}
        mode="study"
        timeLimitSeconds={null}
        initialIndex={saved?.currentIndex ?? 0}
        initialAnswers={saved?.answers ?? {}}
        initialElapsed={saved?.elapsedSeconds ?? 0}
        onFinish={handleQuizFinish}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-bold text-foreground mb-1">선학습 모드</h2>
        <p className="text-sm text-muted-foreground mb-4">
          전체 문제의 정답·해설을 먼저 학습한 뒤 몰아서 풀어봅니다.
        </p>
      </div>

      {savedQuiz && savedQuiz.mode === 'study' && (
        <div className="max-w-2xl mx-auto bg-primary/10 border border-primary/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-primary">📌 풀던 퀴즈 이어서 하기</p>
          <p className="text-xs text-muted-foreground">
            {savedQuiz.questions.length}문항 중{' '}
            {Object.values(savedQuiz.answers).filter(Boolean).length}개 답변 완료 ·{' '}
            {new Date(savedQuiz.savedAt).toLocaleDateString('ko-KR')} 저장
          </p>
          <div className="flex gap-2">
            <button onClick={handleResumeQuiz} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90">
              이어서 풀기
            </button>
            <button onClick={() => { clearSavedSession(); setSavedQuiz(null) }} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/70">
              새로 시작
            </button>
          </div>
        </div>
      )}

      {savedStudy && (
        <div className="max-w-2xl mx-auto bg-purple-900/20 border border-purple-700/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-purple-300">📖 선학습 이어서 하기</p>
          <p className="text-xs text-muted-foreground">
            전체 {savedStudy.allQuestions.length}문제 중{' '}
            {savedStudy.remainingFrom}번부터 이어서 학습 ·{' '}
            {new Date(savedStudy.savedAt).toLocaleDateString('ko-KR')} 저장
          </p>
          <div className="flex gap-2">
            <button onClick={handleResumePreview} className="flex-1 py-2 bg-purple-700 text-white rounded-lg text-sm font-medium hover:opacity-90">
              이어서 학습
            </button>
            <button onClick={() => { clearSavedStudySession(); setSavedStudy(null) }} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/70">
              새로 시작
            </button>
          </div>
        </div>
      )}

      <QuizFilter
        questions={questions}
        mode="study"
        onStart={(qs) => handleNewStart(qs)}
      />
    </div>
  )
}

function StudyBulkPreview({
  questions,
  startFrom,
  onPartialQuiz,
  onSaveAndExit,
  onBack,
  onDone,
}: {
  questions: Question[]
  startFrom: number
  onPartialQuiz: (upToIndex: number) => void
  onSaveAndExit: (upToIndex: number) => void
  onBack: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState(startFrom)
  const [bookmarked, setBookmarked] = useState<Set<string>>(() => {
    const notes = getWrongNotes()
    return new Set(
      questions
        .filter((q) => notes.some((n) => n.questionId === q.id && n.isBookmarked))
        .map((q) => q.id)
    )
  })
  const [choiceMemoOpen, setChoiceMemoOpen] = useState<string | null>(null)
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
    if (!isBookmarked) {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    const notes = getWrongNotes()
    const note = notes.find((n) => n.questionId === q.id)
    if (note) updateChoiceMemo(note.id, label, memo)
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
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">학습 {current + 1} / {questions.length}</span>
        <span className="bg-purple-800/50 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-700/40">
          선학습 미리보기
        </span>
        <span className="text-xs text-muted-foreground">{q.subject} · {q.year}년</span>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
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
                <div className={`flex gap-3 items-start p-3 rounded-lg border text-sm ${
                  c.label === q.answer ? 'border-emerald-600 bg-emerald-900/20' : 'border-border'
                }`}>
                  <span className={`font-semibold shrink-0 ${c.label === q.answer ? 'text-emerald-400' : 'text-primary'}`}>
                    {c.label}
                  </span>
                  <span className="text-foreground flex-1">{c.text}</span>
                  {c.label === q.answer && (
                    <span className="shrink-0 text-emerald-400 text-xs font-medium">✓ 정답</span>
                  )}
                  <button
                    onClick={() => {
                      if (isOpen) { setChoiceMemoOpen(null); setChoiceMemoText('') }
                      else { setChoiceMemoOpen(memoKey); setChoiceMemoText(existingMemo ?? '') }
                    }}
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                      existingMemo ? 'text-yellow-400 hover:text-yellow-300' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {existingMemo ? '📌' : '🖊️'}
                  </button>
                </div>
                {existingMemo && !isOpen && (
                  <div className="ml-3 mt-1 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
                    {existingMemo}
                  </div>
                )}
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
                      <button onClick={() => { setChoiceMemoOpen(null); setChoiceMemoText('') }} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                      {existingMemo && (
                        <button onClick={() => saveChoiceMemo(c.label, '')} className="text-xs text-red-400 hover:text-red-300">삭제</button>
                      )}
                      <button onClick={() => saveChoiceMemo(c.label, choiceMemoText)} className="text-xs text-primary font-medium hover:opacity-80">저장</button>
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
          {current === startFrom ? '← 필터로' : '이전'}
        </button>
        {isLast ? (
          <button
            onClick={() => onPartialQuiz(current)}
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

      {/* 여기까지만 풀기 / 임시저장 버튼 */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!confirm(`1~${current + 1}번 문제를 지금 풀고, 나머지 ${questions.length - current - 1}문제는 나중에 이어서 할까요?`)) return
            onPartialQuiz(current)
          }}
          className="flex-1 py-2 border border-primary/40 text-primary rounded-lg text-xs hover:bg-primary/10 transition-colors"
        >
          ▶ 여기까지({current + 1}문제) 풀기
        </button>
        <button
          onClick={() => {
            if (!confirm(`여기서 멈추고 나중에 ${current + 1}번부터 이어서 할까요?`)) return
            onSaveAndExit(current)
          }}
          className="flex-1 py-2 border border-border text-muted-foreground rounded-lg text-xs hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          💾 임시저장 후 나가기
        </button>
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

      {bookmarked.size > 0 && (
        <p className="text-xs text-center text-yellow-400">
          ⭐ {bookmarked.size}개 암기장에 추가됨
        </p>
      )}
    </div>
  )
}
