'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Question, QuestionStatus, WrongNote, CauseType } from '@/lib/types'
import { analyzeWrongAnswer, mapWithConcurrency } from '@/lib/gemini'
import { addWrongNote, addCorrectNote, addFlaggedCorrectNote, recordSolved, saveSession, clearSavedSession, getRiskLevel } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { PassageTable } from '@/components/passage-table'
import { QuestionImages } from '@/components/question-images'
import { DrawLayer, useDrawBoard } from '@/components/quiz/draw-layer'
import { SubItemList } from '@/components/quiz/sub-item-list'
import { confusionLabels, confusedKind } from '@/lib/subChoices'
import { isAnswerLabel, formatAnswer, isCorrectSelection, isMultiAnswer, selectedLabels, toggleSelection, NO_ANSWER } from '@/lib/answers'

interface QuizItem {
  question: Question
  userAnswer: string | null
  status: QuestionStatus
  // 헷갈림/찍음일 때 같이 헷갈린 선지 (예: ['①','③'])
  confusedWith: string[]
}

interface QuizEngineProps {
  questions: Question[]
  mode: 'cbt' | 'study'
  timeLimitSeconds: number | null
  // completed=false 면 "임시저장 후 나가기". 실제로 답한 문항만 전달한다
  onFinish: (result?: { completed: boolean; answeredQuestionIds: string[] }) => void
  initialIndex?: number
  initialAnswers?: Record<string, string | null>
  initialStatuses?: Record<string, QuestionStatus>
  initialConfusedWith?: Record<string, string[]>
  initialElapsed?: number
  sessionId?: string
}

function getDominantCause(analysis: WrongNote['analysis'], isStudyMode: boolean): CauseType | null {
  if (!analysis) return null
  // 새 구조는 AI가 원인 하나를 이미 판정해 준다
  if (analysis.오답원인?.판정) return analysis.오답원인.판정
  // 구버전: 선학습 실패가 있으면 우선, 아니면 가장 길게 서술된 가설
  const { 가설A = '', 가설B = '', 가설C = '', 선학습적용실패 } = analysis.오답원인 ?? {}
  if (isStudyMode && 선학습적용실패 && 선학습적용실패 !== 'null' && 선학습적용실패 !== '-') return 'study'
  const scores: Record<CauseType, number> = { A: 가설A.length, B: 가설B.length, C: 가설C.length, study: 0 }
  return (['A', 'B', 'C'] as CauseType[]).reduce((a, b) => (scores[a] > scores[b] ? a : b))
}

export function QuizEngine({
  questions,
  mode,
  timeLimitSeconds,
  onFinish,
  initialIndex = 0,
  initialAnswers = {},
  initialStatuses = {},
  initialConfusedWith = {},
  initialElapsed = 0,
  sessionId,
}: QuizEngineProps) {
  const [items, setItems] = useState<QuizItem[]>(() =>
    questions.map((q) => ({
      question: q,
      userAnswer: initialAnswers[q.id] ?? null,
      status: initialStatuses[q.id] ?? null,
      // 표시가 없는 문제에 옛 값이 남아 있어도 쓰지 않는다
      confusedWith: initialStatuses[q.id] ? (initialConfusedWith[q.id] ?? []) : [],
    }))
  )
  const [current, setCurrent] = useState(initialIndex)
  const [submitted, setSubmitted] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<{ correct: number; wrong: WrongNote[] } | null>(null)
  // AI 분석이 실패한 문제 id → 이유. 채점 화면에서 왜 실패했는지 보이게 한다
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(
    timeLimitSeconds !== null ? timeLimitSeconds - initialElapsed : null
  )
  const [elapsed, setElapsed] = useState(initialElapsed)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)
  const [unansweredWarning, setUnansweredWarning] = useState(false)
  // 문제 위에 그린 필기. 문제를 넘겨도 이 컴포넌트는 살아 있어 그림이 남고,
  // 채점을 끝내거나 나가면 통째로 사라진다 — 저장도 정리도 하지 않는다
  const board = useDrawBoard()
  const sid = sessionId ?? `session_${Date.now()}`

  // 자동 임시저장 (10초마다)
  useEffect(() => {
    if (submitted) return
    const interval = setInterval(() => {
      const answers: Record<string, string | null> = {}
      const statuses: Record<string, QuestionStatus> = {}
      const confusedWith: Record<string, string[]> = {}
      items.forEach((it) => {
        answers[it.question.id] = it.userAnswer
        statuses[it.question.id] = it.status
        if (it.confusedWith.length > 0) confusedWith[it.question.id] = it.confusedWith
      })
      saveSession({
        id: sid,
        mode,
        questions,
        answers,
        statuses,
        confusedWith,
        currentIndex: current,
        timeLimitSeconds,
        elapsedSeconds: elapsed,
        savedAt: Date.now(),
      })
    }, 10000)
    return () => clearInterval(interval)
  }, [items, current, elapsed, submitted, sid, mode, questions, timeLimitSeconds])

  // 경과 시간 추적
  useEffect(() => {
    if (submitted) return
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(interval)
  }, [submitted])

  const handleSubmit = useCallback(async () => {
    if (submitted) return

    const unanswered = items.filter((item) => item.userAnswer === null)
    if (unanswered.length > 0) {
      setUnansweredWarning(true)
      return
    }

    setSubmitted(true)
    setUnansweredWarning(false)
    clearSavedSession()

    const apiKey = typeof window !== 'undefined'
      ? localStorage.getItem('lawpass_api_key') ?? ''
      : ''

    const correctItems = items.filter(
      (item) => item.userAnswer !== null && isCorrectSelection(item.question.answer, item.userAnswer)
    )
    const wrongItems = items.filter(
      (item) => item.userAnswer !== null && !isCorrectSelection(item.question.answer, item.userAnswer)
    )

    // 채점된 문제는 맞혔든 틀렸든 푼 문제로 센다. 오답노트에는 틀린 것만 남아 맞힌 문제가 빠졌었다
    recordSolved([...correctItems, ...wrongItems].map((item) => item.question.id))

    for (const item of correctItems) {
      // 맞혔어도 헷갈림/찍음으로 표시했다면 다시 볼 문제라서 오답노트에 남긴다
      if (item.status) {
        addFlaggedCorrectNote(item.question, item.userAnswer!, item.status, mode === 'study', item.confusedWith)
      } else {
        addCorrectNote(item.question.id)
      }
    }

    if (wrongItems.length === 0) {
      setResults({ correct: correctItems.length, wrong: [] })
      return
    }

    // AI 분석은 API 키가 있는 계정(관리자)만 돌린다. 일반 사용자는 키를 넣을 곳이 없어
    // 요청이 항상 거절됐다 — 호출하지 않고 분석 없이 오답노트에 남긴다
    const aiEnabled = apiKey.trim().length > 0
    if (!aiEnabled) {
      const plain = wrongItems.map((item) => {
        const note: WrongNote = {
          id: `${item.question.id}_${Date.now()}`,
          questionId: item.question.id,
          question: item.question,
          userAnswer: item.userAnswer!,
          status: item.status,
          ...(item.confusedWith.length > 0 ? { confusedWith: item.confusedWith } : {}),
          isStudyMode: mode === 'study',
          analysis: null,
          analysisHistory: [],
          dominantCause: null,
          createdAt: Date.now(),
          wrongCount: 1,
          totalCount: 1,
          isBookmarked: false,
        }
        addWrongNote(note)
        return note
      })
      setResults({ correct: correctItems.length, wrong: plain })
      return
    }

    setAnalyzing(true)
    setAnalyzeProgress(0)

    // 오답을 동시에 분석한다. 무제한 병렬은 Gemini rate limit(429)을 유발하므로 3개로 제한
    const ANALYSIS_CONCURRENCY = 3
    const wrongs = await mapWithConcurrency(
      wrongItems,
      ANALYSIS_CONCURRENCY,
      async (item) => {
      try {
        const analysis = await analyzeWrongAnswer(
          apiKey,
          item.question,
          item.userAnswer!,
          item.status,
          mode === 'study',
          item.confusedWith
        )
        const note: WrongNote = {
          id: `${item.question.id}_${Date.now()}`,
          questionId: item.question.id,
          question: item.question,
          userAnswer: item.userAnswer!,
          status: item.status,
          ...(item.confusedWith.length > 0 ? { confusedWith: item.confusedWith } : {}),
          isStudyMode: mode === 'study',
          analysis,
          analysisHistory: [],
          dominantCause: getDominantCause(analysis, mode === 'study'),
          createdAt: Date.now(),
          wrongCount: 1,
          totalCount: 1,
          isBookmarked: false,
        }
        addWrongNote(note)
        return note
      } catch (err) {
        console.error('[v0] Analysis failed for question', item.question.id, err)
        setAnalysisErrors((prev) => ({
          ...prev,
          [item.question.id]: err instanceof Error ? err.message : String(err),
        }))
        const failNote: WrongNote = {
          id: `${item.question.id}_${Date.now()}`,
          questionId: item.question.id,
          question: item.question,
          userAnswer: item.userAnswer!,
          status: item.status,
          ...(item.confusedWith.length > 0 ? { confusedWith: item.confusedWith } : {}),
          isStudyMode: mode === 'study',
          analysis: null,
          analysisHistory: [],
          dominantCause: null,
          createdAt: Date.now(),
          wrongCount: 1,
          totalCount: 1,
          isBookmarked: false,
        }
        addWrongNote(failNote)
        return failNote
      }
      },
      // 완료 순서와 무관하게 끝난 개수만큼 올린다
      (completed, total) => setAnalyzeProgress(Math.round((completed / total) * 100))
    )

    setAnalyzing(false)
    setResults({ correct: correctItems.length, wrong: wrongs })
  }, [items, submitted, mode])

  useEffect(() => {
    if (timeLimitSeconds === null || submitted) return
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
    setUnansweredWarning(false)
  }

  function setAnswer(val: string) {
    setItems((prev) => {
      const next = [...prev]
      next[current] = {
        ...next[current],
        userAnswer: toggleSelection(next[current].userAnswer, val, isMultiAnswer(next[current].question.answer)),
      }
      return next
    })
    setUnansweredWarning(false)
  }

  function setStatus(val: QuestionStatus) {
    setItems((prev) => {
      const next = [...prev]
      const off = next[current].status === val
      next[current] = {
        ...next[current],
        status: off ? null : val,
        // 표시를 끄면 같이 고른 선지도 비운다. 헷갈림↔찍음으로 바꿀 때는 그대로 둔다
        confusedWith: off ? [] : next[current].confusedWith,
      }
      return next
    })
  }

  function toggleConfused(label: string) {
    setItems((prev) => {
      const next = [...prev]
      const cur = next[current].confusedWith
      const picked = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
      // 칩이 늘어선 순서(①②③… 또는 ㄱㄴㄷ…)로 둔다 — 고른 순서가 아니라 보기 좋은 순서로 남긴다
      const order = confusionLabels(next[current].question).labels
      picked.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      next[current] = { ...next[current], confusedWith: picked }
      return next
    })
  }

  // 나가기 (임시저장)
  function handleExit() {
    if (!confirm('지금까지 푼 내용을 임시저장하고 나갈까요?')) return
    const answers: Record<string, string | null> = {}
    const statuses: Record<string, QuestionStatus> = {}
      const confusedWith: Record<string, string[]> = {}
    items.forEach((it) => {
        answers[it.question.id] = it.userAnswer
        statuses[it.question.id] = it.status
        if (it.confusedWith.length > 0) confusedWith[it.question.id] = it.confusedWith
      })
    saveSession({
      id: sid,
      mode,
      questions,
      answers,
      statuses,
      confusedWith,
      currentIndex: current,
      timeLimitSeconds,
      elapsedSeconds: elapsed,
      savedAt: Date.now(),
    })
    onFinish({
      completed: false,
      answeredQuestionIds: items.filter((it) => it.userAnswer !== null).map((it) => it.question.id),
    })
  }

  const item = items[current]
  const q = item.question
  // 정답이 둘 이상이거나 하나도 없는 문제는 드물어서 풀기 전에 미리 알려 준다.
  // 복수정답은 체크박스로 모두 고르게 하고, 정답 없음 문제에는 '정답 없음'을 고르는 칸을 둔다
  const isMulti = isMultiAnswer(q.answer)
  const isNoAnswerQuestion = q.answer?.trim() === NO_ANSWER
  const isNoAnswer = item.userAnswer?.trim() === NO_ANSWER
  const isCurrentAnswered = item.userAnswer !== null
  const unansweredCount = items.filter((i) => i.userAnswer === null).length

  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="text-4xl animate-spin">⚙️</div>
        <p className="text-foreground font-medium">오답 분석 중...</p>
        <p className="text-sm text-muted-foreground">
          Gemini가 {items.filter(i => !isCorrectSelection(i.question.answer, i.userAnswer) && i.userAnswer !== null).length}개의 오답을 분석하고 있습니다
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
    return (
      <ResultsView
        results={results}
        items={items}
        analysisErrors={analysisErrors}
        onFinish={() =>
          onFinish({
            completed: true,
            answeredQuestionIds: items.filter((it) => it.userAnswer !== null).map((it) => it.question.id),
          })
        }
      />
    )
  }

  const answeredCount = items.filter((i) => i.userAnswer !== null).length
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const isTimeCritical = timeLeft !== null && timeLeft < 300

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{q.subject} · {q.year}년</span>
          <button
            onClick={handleExit}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 transition-colors"
          >
            임시저장 후 나가기
          </button>
        </div>
      </div>

      <DrawLayer board={board} questionId={q.id} className="bg-card border border-border rounded-xl p-5 space-y-4">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{q.passage}</p>
        {/* 보기(ㄱㄴㄷ)가 지문과 따로 저장된 문제는 여기서 이어 붙인다 */}
        <SubItemList question={q} />
        {q.passageTable && q.passageTable.length > 0 && (
          <div className="mt-3">
            <PassageTable tables={q.passageTable} />
          </div>
        )}
        {/* 지금 보는 문제 것만 그려지므로 그 문제의 그림만 그때 읽는다 — 세션 전체를 미리 받지 않는다 */}
        <QuestionImages questionId={q.id} imageIds={q.images} poolId={q.poolId} readOnly />
        {isMulti && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            복수정답 문제예요 — 정답인 선지를 모두 골라야 맞은 걸로 채점돼요
          </p>
        )}
        {isNoAnswerQuestion && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            정답이 없는 문제예요 — 아래 '정답 없음'을 골라야 맞은 걸로 채점돼요
          </p>
        )}
        <div className="space-y-2">
          {q.choices.map((c) => (
            <label
              key={c.label}
              className={`flex gap-3 items-start p-3 rounded-lg cursor-pointer border transition-all ${
                selectedLabels(item.userAnswer).includes(c.label)
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40 hover:bg-muted/50'
              }`}
            >
              {/* 임시 그리기를 켜 두면 캔버스가 카드 전체를 덮어 선지 체크가 안 눌린다.
                  체크 칸만 캔버스 위(z-10)로 올린다 — 선지 글자 위로는 계속 그릴 수 있다.
                  손가락으로 누르기 쉽게 눌리는 자리는 -m-2/p-2 로 넓히고 배치는 그대로 둔다 */}
              <span className="relative z-10 -m-2 shrink-0 p-2">
                <input
                  type={isMulti ? 'checkbox' : 'radio'}
                  name={`q-${current}`}
                  value={c.label}
                  checked={selectedLabels(item.userAnswer).includes(c.label)}
                  onChange={() => setAnswer(c.label)}
                  className="mt-0.5 block accent-[oklch(0.65_0.2_290)]"
                />
              </span>
              <span className="text-sm text-foreground leading-relaxed">
                <span className="font-semibold text-primary mr-1">{c.label}</span>
                {c.text}
              </span>
            </label>
          ))}
        </div>

        {isNoAnswerQuestion && (
          <label className="relative z-10 flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={isNoAnswer}
              onChange={() => {
                setItems((prev) => {
                  const next = [...prev]
                  next[current] = { ...next[current], userAnswer: isNoAnswer ? null : NO_ANSWER }
                  return next
                })
                setUnansweredWarning(false)
              }}
              className="accent-[oklch(0.65_0.2_290)]"
            />
            <span className="text-foreground font-medium">정답 없음</span>
          </label>
        )}

        <div className="flex gap-3">
          {(['헷갈림', '찍음'] as QuestionStatus[]).map((s) => (
            // 헷갈림/찍음 칸도 같은 이유로 캔버스 위로 올린다
            <label key={s} className="relative z-10 flex items-center gap-1.5 cursor-pointer text-xs">
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

        {/* 헷갈림·찍음을 눌렀을 때만. 어느 선지와 헷갈렸는지 골라 두면 채점 뒤 분석과 오답노트에 남는다 */}
        {item.status && (
          <div className="relative z-10 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {item.status === '찍음'
                ? `어느 ${confusionLabels(q).kind} 사이에서 찍었나요?`
                : `어느 ${confusionLabels(q).kind}와 헷갈렸나요?`}
            </span>
            {confusionLabels(q).labels.map((label) => {
              const on = item.confusedWith.includes(label)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleConfused(label)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    on
                      ? 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'border-border text-muted-foreground hover:border-amber-500/60'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}
      </DrawLayer>

      {unansweredWarning && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-300">
          ⚠ 아직 {unansweredCount}개 문제에 답을 선택하지 않았습니다.
        </div>
      )}

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
            disabled={!isCurrentAnswered}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
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
                  : unansweredWarning
                    ? 'bg-red-900/50 text-red-300'
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

function ResultsView({
  results,
  items,
  analysisErrors,
  onFinish,
}: {
  results: { correct: number; wrong: WrongNote[] }
  items: QuizItem[]
  analysisErrors: Record<string, string>
  onFinish: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const total = items.filter((i) => i.userAnswer !== null).length
  const pct = total > 0 ? Math.round((results.correct / total) * 100) : 0
  // 맞혔지만 헷갈림/찍음으로 표시한 문제. 오답노트에는 따로 들어가지만 채점 화면에서도 바로 보이게 한다
  const flaggedCorrect = items.filter(
    (i) => i.status && i.userAnswer !== null && isCorrectSelection(i.question.answer, i.userAnswer)
  )

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
                    <StarRating value={getRiskLevel(note)} />
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{note.question.passage.slice(0, 80)}...</p>
                  <p className="text-xs text-muted-foreground">
                    내 답: {formatAnswer(note.userAnswer)} · 정답: {formatAnswer(note.question.answer)}
                    {note.status && note.confusedWith && note.confusedWith.length > 0 && (
                      <span className="ml-2 text-amber-500">
                        {note.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'} {note.confusedWith.join(' ')}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-muted-foreground text-sm shrink-0">{expandedId === note.id ? '▲' : '▼'}</span>
              </button>

              {/* 토글을 누르면 늘 문제 전문(지문·선지·해설)을 먼저 보여준다. AI 분석은
                  성공했을 때만 그 아래 덧붙인다. 전에는 note.analysis가 없으면(AI 분석
                  실패) 토글을 눌러도 이 블록 자체가 안 그려져 — 그림도 없는 문제는 —
                  아무 반응이 없는 것처럼 보였다 */}
              {expandedId === note.id && (
                <div className="border-t border-border px-4 py-3 space-y-3 text-sm">
                  <QuestionImages questionId={note.question.id} imageIds={note.question.images} poolId={note.question.poolId} readOnly />

                  <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">문제 지문</p>
                    <p className="text-foreground leading-relaxed text-xs whitespace-pre-wrap">{note.question.passage}</p>
                    <div className="mt-2">
                      <SubItemList question={note.question} small />
                    </div>
                  </div>

                  <div className="space-y-1">
                    {note.question.choices.map((c) => (
                      <div
                        key={c.label}
                        className={`flex gap-2 p-2 rounded-lg text-xs border ${
                          isAnswerLabel(note.question.answer, c.label)
                            ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300'
                            : selectedLabels(note.userAnswer).includes(c.label)
                              ? 'border-red-500 bg-red-100 text-red-900 dark:border-red-600 dark:bg-red-900/20 dark:text-red-300'
                              : 'border-border text-muted-foreground'
                        }`}
                      >
                        <span className="font-semibold shrink-0">{c.label}</span>
                        <span className="flex-1">{c.text}</span>
                        {note.confusedWith?.includes(c.label) && (
                          <span className="ml-auto shrink-0 text-amber-600 dark:text-amber-400">
                            {note.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'}
                          </span>
                        )}
                        {isAnswerLabel(note.question.answer, c.label) && (
                          <span className="ml-auto shrink-0">
                            ✓ 정답{isMultiAnswer(note.question.answer) && !selectedLabels(note.userAnswer).includes(c.label) ? ' · 놓침' : ''}
                          </span>
                        )}
                        {selectedLabels(note.userAnswer).includes(c.label) && !isAnswerLabel(note.question.answer, c.label) && (
                          <span className="ml-auto shrink-0">✗ 내 답</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {note.question.explanation && (
                    <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
                      <p className="text-foreground text-xs leading-relaxed whitespace-pre-wrap break-words">
                        {note.question.explanation}
                      </p>
                    </div>
                  )}

                  {note.analysis ? (
                    <>
                      <InfoRow label="핵심개념" value={note.analysis.핵심개념} />
                      <InfoRow label="관련조문" value={note.analysis.관련조문} />
                      <InfoRow label="원인상세" value={note.analysis.원인상세} />
                      <InfoRow label="개념요약" value={note.analysis.개념요약} />
                      <InfoRow label="혼동주의" value={note.analysis.혼동주의} />
                      <InfoRow label="체크포인트" value={note.analysis.체크포인트} />
                    </>
                  ) : (
                    <div className="space-y-1">
                      {/* 분석을 시도했다가 실패한 경우에만 알린다. 분석이 꺼진 계정은 아무 말도 하지 않는다 */}
                      {analysisErrors[note.question.id] && (
                        <>
                          <p className="text-xs text-muted-foreground">AI 분석에 실패했습니다.</p>
                          <p className="text-xs text-red-400 break-words">
                            이유: {explainAnalysisError(analysisErrors[note.question.id])}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {flaggedCorrect.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground px-1">맞혔지만 표시한 문제</h3>
          {flaggedCorrect.map((it) => (
            <div key={it.question.id} className="bg-card border border-border rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">{it.question.subject}</span>
                <span className="text-xs text-amber-500">
                  {it.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'}
                </span>
              </div>
              <p className="text-sm text-foreground line-clamp-2">{it.question.passage.slice(0, 80)}...</p>
              <p className="text-xs text-muted-foreground">
                내 답(정답): {formatAnswer(it.userAnswer)}
                {it.confusedWith.length > 0 && (
                  <span className="ml-2 text-amber-500">
                    같이 헷갈린 {confusedKind(it.question, it.confusedWith)} {it.confusedWith.join(' ')}
                  </span>
                )}
              </p>
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

// 분석 실패 메시지를 알아볼 수 있는 한 줄로 바꾼다. 서버가 `[상태코드] 본문`으로 전해 주는 것을 이용한다
function explainAnalysisError(message: string): string {
  const code = message.match(/\[(\d{3})\]/)?.[1]
  if (code === '429') return 'Gemini 요청 한도를 넘었어요(429). 잠시 뒤 다시 시도하거나, 하루 한도라면 내일 풀어주세요.'
  if (code === '400' || code === '401' || code === '403') {
    return `API 키가 올바르지 않을 수 있어요(${code}). PDF 분석 탭의 키를 확인해 주세요.`
  }
  if (code === '503' || code === '504') return 'Gemini 서버가 바쁜 상태예요. 잠시 뒤 다시 시도해 주세요.'
  return message.length > 160 ? `${message.slice(0, 160)}…` : message
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
      <p className="text-foreground leading-relaxed">{value}</p>
    </div>
  )
}
