'use client'

import { useState, useMemo } from 'react'
import { FilterChips } from '@/components/filter-chips'
import { getAppMode } from '@/lib/appMode'
import type { Question, Subject, ExamType } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const COUNT_OPTIONS = [10, 20, 40, 70] as const

const DEFAULT_TIME: Record<number, number> = {
  10: 17,
  20: 34,
  40: 70,
  70: 120,
}

const SUBJECT_GROUPS = [
  { label: '민사법', subjects: ['민법', '민사소송법', '상법'] as Subject[] },
  { label: '형사법', subjects: ['형법', '형사소송법'] as Subject[] },
  { label: '공법', subjects: ['헌법', '행정법'] as Subject[] },
]

const UNITS: Record<Subject, string[]> = {
  '민법': ['민법총칙', '물권법', '채권총론', '채권각론', '가족법'],
  '민사소송법': ['소송요건', '소송절차', '증거', '상소', '강제집행'],
  '상법': ['총칙', '회사법', '어음수표법', '보험법', '해상법'],
  '형법': ['총론', '각론', '특별형법'],
  '형사소송법': ['수사', '공소', '공판', '증거', '상소'],
  '헌법': ['총론', '기본권', '통치구조'],
  '행정법': ['총론', '각론'],
}

interface QuizFilterProps {
  questions: Question[]
  mode: 'cbt' | 'study'
  onStart: (selected: Question[], timeLimitSeconds: number | null) => void
}

export function QuizFilter({ questions, mode, onStart }: QuizFilterProps) {
  const [appMode] = useState(() => getAppMode())
  const isGeneral = appMode === 'general'

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [generalSubjects, setGeneralSubjects] = useState<string[]>([])
  const [examTypes, setExamTypes] = useState<ExamType[]>([])
  const [years, setYears] = useState<string[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [count, setCount] = useState<number>(20)
  const [useTimer, setUseTimer] = useState(mode === 'cbt')
  const [allQuestions, setAllQuestions] = useState(false)

  const activeSubjects: string[] = isGeneral ? generalSubjects : subjects

  const generalSubjectOptions = useMemo(() => {
    return Array.from(new Set(questions.map((q) => q.subject as string))).sort((a, b) => a.localeCompare(b))
  }, [questions])

  // general 모드: 선택된 과목 기준으로 연도/범위 후보를 좁힘 (과목 미선택 시 전체 문제 기준)
  const generalScopedQuestions = useMemo(() => {
    return generalSubjects.length > 0 ? questions.filter((q) => generalSubjects.includes(q.subject)) : questions
  }, [questions, generalSubjects])

  const generalAvailableYears = useMemo(() => {
    return Array.from(new Set(generalScopedQuestions.map((q) => String(q.year))))
      .sort((a, b) => Number(b) - Number(a))
  }, [generalScopedQuestions])

  const generalAvailableUnits = useMemo(() => {
    return Array.from(
      new Set(generalScopedQuestions.map((q) => q.unit?.trim()).filter((u): u is string => !!u))
    ).sort((a, b) => a.localeCompare(b))
  }, [generalScopedQuestions])

  const availableYears = useMemo(() => {
    return Array.from(new Set(questions.map((q) => String(q.year))))
      .sort((a, b) => Number(b) - Number(a))
  }, [questions])

  const yearOptions = isGeneral ? generalAvailableYears : availableYears
  const allYearsSelected = yearOptions.length > 0 && yearOptions.every((y) => years.includes(y))

  const availableUnits = useMemo(() => {
    return subjects.flatMap((s) => UNITS[s] ?? [])
  }, [subjects])

  const allGeneralUnitsSelected = generalAvailableUnits.length > 0 && generalAvailableUnits.every((u) => units.includes(u))
  const allLawUnitsSelected = availableUnits.length > 0 && availableUnits.every((u) => units.includes(u))

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      if (activeSubjects.length && !activeSubjects.includes(q.subject)) return false
      if (examTypes.length && !examTypes.includes(q.examType)) return false
      if (years.length > 0 && !years.includes(String(q.year))) return false
      if (units.length && q.unit && !units.includes(q.unit)) return false
      return true
    })
  }, [questions, activeSubjects, examTypes, years, units])

  function toggleGroup(groupSubjects: Subject[]) {
    const allSelected = groupSubjects.every((s) => subjects.includes(s))
    if (allSelected) {
      const newSubjects = subjects.filter((s) => !groupSubjects.includes(s))
      setSubjects(newSubjects)
      const removedUnits = groupSubjects.flatMap((s) => UNITS[s] ?? [])
      setUnits((prev) => prev.filter((u) => !removedUnits.includes(u)))
      if (newSubjects.length === 0) {
        setExamTypes([])
        setYears([])
      }
    } else {
      const newSubjects = Array.from(new Set([...subjects, ...groupSubjects]))
      setSubjects(newSubjects)
      const addedUnits = groupSubjects.flatMap((s) => UNITS[s] ?? [])
      setUnits((prev) => Array.from(new Set([...prev, ...addedUnits])))
      if (subjects.length === 0) {
        setExamTypes([...EXAM_TYPES])
        setYears(availableYears)
      }
    }
  }

  function handleSubjectsChange(newSubjects: Subject[]) {
    const added = newSubjects.filter((s) => !subjects.includes(s))
    const removed = subjects.filter((s) => !newSubjects.includes(s))
    const addedUnits = added.flatMap((s) => UNITS[s] ?? [])
    const removedUnits = removed.flatMap((s) => UNITS[s] ?? [])
    setSubjects(newSubjects)
    setUnits((prev) => Array.from(new Set([...prev.filter((u) => !removedUnits.includes(u)), ...addedUnits])))
    if (subjects.length === 0 && newSubjects.length > 0) {
      setExamTypes([...EXAM_TYPES])
      setYears(availableYears)
    }
    if (newSubjects.length === 0) {
      setExamTypes([])
      setYears([])
    }
  }

  function selectRecentYears(n: number) {
    setYears(yearOptions.slice(0, n))
  }

  function handleStart() {
    if (filtered.length === 0) return
    if (allQuestions) {
      const minutes = Math.ceil(filtered.length * 1.7)
      onStart(filtered, useTimer ? minutes * 60 : null)
    } else {
      const shuffled = [...filtered].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, count)
      const minutes = DEFAULT_TIME[count] ?? 60
      onStart(selected, useTimer ? minutes * 60 : null)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* 과목 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <label className="text-xs font-medium text-muted-foreground">과목</label>
        {isGeneral ? (
          generalSubjectOptions.length > 0 ? (
            <FilterChips options={generalSubjectOptions} selected={generalSubjects} onChange={setGeneralSubjects} />
          ) : (
            <p className="text-xs text-muted-foreground">PDF 탭에서 문제를 먼저 업로드해주세요.</p>
          )
        ) : (
          <>
            <div className="flex gap-2">
              {SUBJECT_GROUPS.map((g) => {
                const allSelected = g.subjects.every((s) => subjects.includes(s))
                const someSelected = g.subjects.some((s) => subjects.includes(s))
                return (
                  <button
                    key={g.label}
                    onClick={() => toggleGroup(g.subjects)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      allSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : someSelected
                          ? 'bg-primary/20 text-primary border-primary/50'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
                    }`}
                  >
                    {g.label}
                  </button>
                )
              })}
            </div>
            <FilterChips options={SUBJECTS} selected={subjects} onChange={handleSubjectsChange} />
          </>
        )}
      </div>

      {/* 시험 유형 */}
      {!isGeneral && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">시험 유형 (복수 선택)</label>
          <FilterChips options={EXAM_TYPES} selected={examTypes} onChange={setExamTypes} />
        </div>
      )}

      {/* 연도 */}
      {yearOptions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">연도 (복수 선택)</label>
            <div className="flex gap-1.5">
              {[1, 3, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => selectRecentYears(n)}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  최근 {n}개년
                </button>
              ))}
              <button
                onClick={() => setYears(allYearsSelected ? [] : yearOptions)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  allYearsSelected
                    ? 'border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                전체
              </button>
            </div>
          </div>
          <FilterChips options={yearOptions} selected={years} onChange={setYears} />
        </div>
      )}

      {/* 범위 */}
      {isGeneral ? (
        generalAvailableUnits.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">범위 (복수 선택)</label>
              <button
                onClick={() => setUnits(allGeneralUnitsSelected ? [] : generalAvailableUnits)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  allGeneralUnitsSelected
                    ? 'border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                전체
              </button>
            </div>
            <FilterChips options={generalAvailableUnits} selected={units} onChange={setUnits} />
          </div>
        )
      ) : (
        availableUnits.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">범위 (복수 선택)</label>
              <button
                onClick={() => setUnits(allLawUnitsSelected ? [] : availableUnits)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  allLawUnitsSelected
                    ? 'border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                전체
              </button>
            </div>
            <div className="space-y-2">
              {subjects.map((s) => {
                const subjectUnits = UNITS[s]
                if (!subjectUnits) return null
                return (
                  <div key={s} className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">{s}</p>
                    <FilterChips options={subjectUnits} selected={units} onChange={setUnits} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      )}

      {/* 문항 수 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">문항 수</label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={allQuestions}
              onChange={(e) => setAllQuestions(e.target.checked)}
              className="accent-[oklch(0.65_0.2_290)] w-3.5 h-3.5"
            />
            <span className="text-xs text-foreground">전문제 풀기</span>
          </label>
        </div>
        {!allQuestions && (
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
        )}
        {allQuestions && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            필터된 전체 <span className="text-foreground font-medium">{filtered.length}문제</span>를 순서대로 풀기
          </p>
        )}
      </div>

      {/* 타이머 */}
      {mode === 'cbt' && (
        <div className="bg-card border border-border rounded-xl p-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useTimer}
              onChange={(e) => setUseTimer(e.target.checked)}
              className="accent-[oklch(0.65_0.2_290)] w-4 h-4"
            />
            <span className="text-sm text-foreground">
              타이머 사용 ({allQuestions ? Math.ceil(filtered.length * 1.7) : DEFAULT_TIME[count]}분)
            </span>
          </label>
        </div>
      )}

      {/* 결과 */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          필터 결과: <span className="text-foreground font-medium">{filtered.length}문제</span>
        </span>
        {!allQuestions && filtered.length < count && filtered.length > 0 && (
          <span className="text-yellow-400 text-xs">전체 {filtered.length}문제만 출제</span>
        )}
      </div>

      <button
        onClick={handleStart}
        disabled={filtered.length === 0 || activeSubjects.length === 0}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {filtered.length === 0
          ? activeSubjects.length === 0
            ? '과목을 선택해주세요'
            : '문제은행에 문제가 없습니다'
          : allQuestions
            ? `${mode === 'cbt' ? 'CBT 시작' : '선학습 시작'} — 전체 ${filtered.length}문항`
            : `${mode === 'cbt' ? 'CBT 시작' : '선학습 시작'} — ${Math.min(count, filtered.length)}문항`}
      </button>
    </div>
  )
}
