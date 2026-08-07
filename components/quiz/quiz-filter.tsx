'use client'

import { useState, useMemo } from 'react'
import { FilterChips } from '@/components/filter-chips'
import type { Question, Subject, ExamType } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const COUNT_OPTIONS = [10, 20, 40, 70] as const

// time in minutes per count (default)
const DEFAULT_TIME: Record<number, number> = {
  10: 17,
  20: 34,
  40: 70,
  70: 120,
}

interface QuizFilterProps {
  questions: Question[]
  mode: 'cbt' | 'study'
  onStart: (selected: Question[], timeLimitSeconds: number | null) => void
}

export function QuizFilter({ questions, mode, onStart }: QuizFilterProps) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [examTypes, setExamTypes] = useState<ExamType[]>([])
  const [years, setYears] = useState<string[]>([])
  const [count, setCount] = useState<number>(20)
  const [useTimer, setUseTimer] = useState(mode === 'cbt')

  const availableYears = useMemo(() => {
    const ys = Array.from(new Set(questions.map((q) => String(q.year)))).sort((a, b) =>
      Number(b) - Number(a)
    )
    return ys
  }, [questions])

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      if (subjects.length && !subjects.includes(q.subject)) return false
      if (examTypes.length && !examTypes.includes(q.examType)) return false
      if (years.length && !years.includes(String(q.year))) return false
      return true
    })
  }, [questions, subjects, examTypes, years])

  function handleStart() {
    if (filtered.length === 0) return
    const shuffled = [...filtered].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, count)
    const minutes = DEFAULT_TIME[count] ?? 60
    onStart(selected, useTimer ? minutes * 60 : null)
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">과목 (복수 선택)</label>
          <FilterChips options={SUBJECTS} selected={subjects} onChange={setSubjects} />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">시험 유형</label>
          <FilterChips options={EXAM_TYPES} selected={examTypes} onChange={setExamTypes} />
        </div>
        {availableYears.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">연도</label>
            <FilterChips options={availableYears} selected={years} onChange={setYears} />
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <label className="text-xs font-medium text-muted-foreground">문항 수</label>
        <div className="grid grid-cols-4 gap-2">
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                count === n
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
              }`}
            >
              {n}문항
              <div className="text-xs opacity-70 font-normal">{DEFAULT_TIME[n]}분</div>
            </button>
          ))}
        </div>
      </div>

      {mode === 'cbt' && (
        <div className="bg-card border border-border rounded-xl p-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useTimer}
              onChange={(e) => setUseTimer(e.target.checked)}
              className="accent-[oklch(0.65_0.2_290)] w-4 h-4"
            />
            <span className="text-sm text-foreground">타이머 사용 ({DEFAULT_TIME[count]}분)</span>
          </label>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          필터 결과: <span className="text-foreground font-medium">{filtered.length}문제</span>
        </span>
        {filtered.length < count && filtered.length > 0 && (
          <span className="text-yellow-400 text-xs">전체 {filtered.length}문제만 출제</span>
        )}
      </div>

      <button
        onClick={handleStart}
        disabled={filtered.length === 0}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {filtered.length === 0
          ? '문제은행에 문제가 없습니다'
          : `${mode === 'cbt' ? 'CBT 시작' : '선학습 시작'} — ${Math.min(count, filtered.length)}문항`}
      </button>
    </div>
  )
}
