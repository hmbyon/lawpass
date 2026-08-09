'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Question, QuestionStatus, WrongNote, CauseType } from '@/lib/types'
import { analyzeWrongAnswer } from '@/lib/gemini'
import { getApiKey, addWrongNote } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'

interface QuizItem {
  question: Question
  userAnswer: string | null
  status: QuestionStatus
}

interface QuizEngineProps {
  questions: Question[]
  mode: 'cbt' | 'study'
  timeLimitSeconds: number | null
  onFinish: () => void
}

function getDominantCause(analysis: WrongNote['analysis']): CauseType | null {
  if (!analysis) return null
  const { 가설A, 가설B, 가설C, 선학습적용실패 } = analysis.오답원인
  if (선학습적용실패 && 선학습적용실패 !== 'null' && 선학습적용실패 !== '-') return 'study'
  const scores: Record<CauseType, number> = { A: 0, B: 0, C: 0, study: 0 }
  const words = (s: string) => s.length
  scores.A = words(가설A)
  scores.B = words(가설B)
  scores.C = words(가설C)
  const best = (['A', 'B', 'C'] as CauseType[]).reduce((a, b) => (scores[a] > scores[b] ? a : b))
  return best
}

export function QuizEngine({ questions, mode, timeLimitSeconds, onFinish }: QuizEngineProps) {
  const [items, setItems] = useState<QuizItem[]>(() =>
    questions.map((q) => ({ question: q, userAnswer: null, status: null }))
  )
  const [current, setCurrent] = useState(0)
  const [showStudyFirst, setShowStudyFirst] = useState(mode === 'study')
  const [submitted, setSubmitted] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<{ correct: number; wrong: WrongNote[] } | null>(null)
  const [timeLeft, setTimeLeft] = useState(timeLimitSeconds)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)

  const handleSubmit = useCallback(async () => {
    if (submitted) return
    setSubmitted(true)

    const apiKey = getApiKey()
    const wrongs: WrongNote[] = []
    const wrongItems = items.filter(
      (item) => item.userAnswer !== null && item.userAnswer !== item.question.answer
    )

    setAnalyzing(true)
    setAnalyzeProgress(0)

    for (let i = 0; i < wrongItems.length; i++) {
      const item = wrongItems[i]
      try {
        const analysis = await analyzeWrongAnswer(
          apiKey,
          item.question,
          item.userAnswer!,
          item.status,
          mode === 'study'
        )
        const note: WrongNote = {
          id: `${item.question.id}_${Date.now()}`,
          questionId: item.question.id,
          question: item.question,
          userAnswer: item.userAnswer!,
          status: item.status,
          isStudyMode: mode === 'study',
          analysis,
          dominantCause: getDominantCause(analysis),
          createdAt: Date.now(),
        }
        addWrongNote(note)
        wrongs.push(note)
      } catch (err) {
        console.error('[v0] Analysis failed for question', item.question.id, err)
        const note: WrongNote = {
          id: `${item.question.id}_${Date.now()}`,
          questionId: item.question.id,
          question: item.question,
          userAnswer: item.userAnswer!,
          status: item.status,
          isStudyMode: mode === 'study',
          analysis: null,
          dominantCause: null,
          createdAt: Date.now(),
        }
        addWrongNote(note)
        wrongs.push(note)
      }
      setAnalyzeProgress(Math.round(((i + 1) / wrongItems.length) * 100))
    }

    setAnalyzing(false)
    const correct = items.filter(
      (item) => item.userAnswer !== null && item.userAnswer === item.question.answer
    ).length
    setResults({ correct, wrong: wrongs })
  }, [items, submitted, mode])

  // Timer
  useEffect(() => {
    if (timeLimitSeconds === null || submitted) return
    setTimeLeft(timeLimitSeconds)
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          handleSubmit()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [timeLimitSeconds, submitted, handleSubmit])

  function goToQuestion(idx: number) {
    setCurrent(idx)
    if (mode === 'study') setShowStudyFirst(true)
  }

  function setAnswer(val: string) {
    setItems((prev) => {
      const next = [...prev]
      next[current] = { ...next[current], userAnswer: val }
      return next
    })
  }

  function setStatus(val: QuestionStatus) {
    setItems((prev) => {
      const next = [...prev]
      next[current] = {
        ...next[current],
        status: next[current].status === val ? null : val,
      }
      return next
    })
  }

  const item = items[current]
  const q = item.question

  // Study mode: show answer first
  if (showStudyFirst) {
    return (
      <StudyPreview
        question={q}
        onReady={() => setShowStudyFirst(false)}
      />
    )
  }

  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="text-4xl animate-spin">⚙️</div>
        <p className="text-foreground font-medium">오답 분석 중...</p>
        <p className="text-sm text-muted-foreground">
          Gemini가 {items.filter(i => i.userAnswer !== i.question.answer && i.userAnswer !== null).length}개의 오답을 분석하고 있습니다
        </p>
        <div className="w-64 bg-border rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${analyzeProgress}%` }}
          />
        </div>
      </div>
    )
  }

  if (results) {
    return <ResultsView results={results} items={items} onFinish={onFinish} />
  }

  const answeredCount = items.filter((i) => i.userAnswer !== null).length
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const isTimeCritical = timeLeft !== null && timeLeft < 300

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          {current + 1} / {questions.length}
          <span className="ml-2 text-xs">({answeredCount}개 답변)</span>
        </span>
        {timeLeft !== null && (
          <span className={`font-mono font-bold ${isTimeCritical ? 'text-red-400 animate-pulse' : 'text-foreground'}`}>
            {fmt(timeLeft)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{q.subject} · {q.year}년</span>
      </div>

      {/* Question */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{q.passage}</p>
        <div className="space-y-2">
          {q.choices.map((c) => (
            <label
              key={c.label}
              className={`flex gap-3 items-start p-3 rounded-lg cursor-pointer border transition-all ${
                item.userAnswer === c.label
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40 hover:bg-muted/50'
              }`}
            >
              <input
                type="radio"
                name={`q-${current}`}
                value={c.label}
                checked={item.userAnswer === c.label}
                onChange={() => setAnswer(c.label)}
                className="mt-0.5 accent-[oklch(0.65_0.2_290)]"
              />
              <span className="text-sm text-foreground leading-relaxed">
                <span className="font-semibold text-primary mr-1">{c.label}</span>
                {c.text}
              </span>
            </label>
          ))}
        </div>

        {/* Status */}
        <div className="flex gap-3">
          {(['헷갈림', '찍음'] as QuestionStatus[]).map((s) => (
            <label key={s} className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={item.status === s}
                onChange={() => setStatus(s)}
                className="accent-[oklch(0.65_0.2_290)]"
              />
              <span className="text-muted-foreground">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-2">
        <button
          onClick={() => goToQuestion(Math.max(0, current - 1))}
          disabled={current === 0}
          className="flex-1 py-2 bg-muted rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-muted/70 transition-colors"
        >
          이전
        </button>
        {current < questions.length - 1 ? (
          <button
            onClick={() => goToQuestion(Math.min(questions.length - 1, current + 1))}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            다음
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            채점하기
          </button>
        )}
      </div>

      {/* Dot navigation */}
      <div className="flex flex-wrap gap-1 justify-center">
        {items.map((it, idx) => (
          <button
            key={idx}
            onClick={() => goToQuestion(idx)}
            className={`w-6 h-6 rounded text-xs font-medium transition-all ${
              idx === current
                ? 'bg-primary text-primary-foreground'
                : it.userAnswer !== null
                  ? 'bg-muted-foreground/30 text-foreground'
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

function StudyPreview({ question, onReady }: { question: Question; onReady: () => void }) {
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="bg-purple-800/50 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-700/40">
            선학습 미리보기
          </span>
          <span className="text-xs text-muted-foreground">{question.subject} · {question.year}년</span>
        </div>
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{question.passage}</p>
        <div className="space-y-2">
          {question.choices.map((c) => (
            <div
              key={c.label}
              className={`flex gap-3 items-start p-3 rounded-lg border text-sm ${
                c.label === question.answer
                  ? 'border-emerald-600 bg-emerald-900/20'
                  : 'border-border'
              }`}
            >
              <span className={`font-semibold ${c.label === question.answer ? 'text-emerald-400' : 'text-primary'}`}>
                {c.label}
              </span>
              <span className="text-foreground">{c.text}</span>
            </div>
          ))}
        </div>
        {question.explanation && (
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
            <p className="text-sm text-foreground leading-relaxed">{question.explanation}</p>
          </div>
        )}
      </div>
      <button
        onClick={onReady}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
      >
        학습 완료 — 풀기
      </button>
    </div>
  )
}

function ResultsView({
  results,
  items,
  onFinish,
}: {
  results: { correct: number; wrong: WrongNote[] }
  items: QuizItem[]
  onFinish: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const total = items.filter((i) => i.userAnswer !== null).length
  const pct = total > 0 ? Math.round((results.correct / total) * 100) : 0

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-xl p-5 text-center space-y-2">
        <p className="text-4xl font-bold text-foreground">{pct}점</p>
        <p className="text-muted-foreground text-sm">
          {total}문항 중 <span className="text-emerald-400 font-medium">{results.correct}개 정답</span>,{' '}
          <span className="text-red-400 font-medium">{results.wrong.length}개 오답</span>
        </p>
      </div>

      {results.wrong.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground px-1">오답 분석 결과</h3>
          {results.wrong.map((note) => (
            <div key={note.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === note.id ? null : note.id)}
                className="w-full p-4 text-left flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{note.question.subject}</span>
                    {note.dominantCause && <CauseBadge cause={note.dominantCause} />}
                    {note.analysis && <StarRating value={note.analysis.위험도} />}
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{note.question.passage.slice(0, 80)}...</p>
                  <p className="text-xs text-muted-foreground">
                    내 답: {note.userAnswer} · 정답: {note.question.answer}
                  </p>
                </div>
                <span className="text-muted-foreground text-sm shrink-0">{expandedId === note.id ? '▲' : '▼'}</span>
              </button>

              {expandedId === note.id && note.analysis && (
                <div className="border-t border-border px-4 py-3 space-y-3 text-sm">
                  <InfoRow label="핵심개념" value={note.analysis.핵심개념} />
                  <InfoRow label="관련조문" value={note.analysis.관련조문} />
                  <InfoRow label="원인상세" value={note.analysis.원인상세} />
                  <InfoRow label="개념요약" value={note.analysis.개념요약} />
                  <InfoRow label="혼동주의" value={note.analysis.혼동주의} />
                  <InfoRow label="체크포인트" value={note.analysis.체크포인트} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onFinish}
        className="w-full py-2.5 bg-muted text-foreground rounded-lg font-medium text-sm hover:bg-muted/70 transition-colors"
      >
        완료 — 목록으로
      </button>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
      <p className="text-foreground leading-relaxed">{value}</p>
    </div>
  )
}