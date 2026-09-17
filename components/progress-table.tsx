'use client'

import { useState } from 'react'
import type { ExamType, Question, Subject, WrongNote } from '@/lib/types'
import { getPoolQuestions, getQuestions } from '@/lib/store'

/**
 * 진도표 — 과목·연도·단원별 풀이 현황.
 *
 * 관리자의 'PDF 분석'과 일반 사용자의 '학습 현황'이 함께 쓴다. 원래 pdf-tab.tsx 안에 있던
 * 계산과 화면을 그대로 옮겼다 — 한 벌만 두어야 고칠 곳도 하나다
 */

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']

export interface ProgressRow {
  examType: ExamType
  year: number
  unit: string
  total: number
  solved: number
}

/**
 * 과목 → (시험구분·연도·단원)별 문제 수와 푼 수.
 *
 * 예전에는 안에서 getQuestions()·getWrongNotes() 를 읽었다. 이제 두 화면이 쓰므로 무엇을 셀지를
 * 밖에서 받고, 세는 규칙은 그대로 둔다. 세는 대상은 역할과 상관없이 하나다 — progressQuestions
 */
/**
 * 진도표가 세는 문제. 관리자든 일반 사용자든 같다 — 내 문제 + 공유받은 문제집.
 * CBT·선학습이 풀게 하는 목록(app-shell 의 [...questions, ...poolQuestions])과 같은 범위다.
 * 내 문제만 세면 올린 문제가 없는 사람에게는 늘 빈 표가 뜬다
 */
export function progressQuestions(): Question[] {
  return [...getQuestions(), ...getPoolQuestions()]
}

export function computeProgress(questions: Question[], wrongNotes: WrongNote[]): Record<string, ProgressRow[]> {
  const solvedIds = new Set(
    wrongNotes.filter((n) => (n.totalCount ?? 0) > 0).map((n) => n.questionId)
  )

  const rowMap = new Map<string, ProgressRow & { subject: Subject }>()
  for (const q of questions) {
    const unit = q.unit?.trim() || '(단원 미지정)'
    const key = `${q.subject}|${q.examType}|${q.year}|${unit}`
    const row = rowMap.get(key) ?? { subject: q.subject, examType: q.examType, year: q.year, unit, total: 0, solved: 0 }
    row.total += 1
    if (solvedIds.has(q.id)) row.solved += 1
    rowMap.set(key, row)
  }

  const bySubject: Record<string, ProgressRow[]> = {}
  for (const { subject, ...row } of rowMap.values()) {
    if (!bySubject[subject]) bySubject[subject] = []
    bySubject[subject].push(row)
  }
  for (const subject in bySubject) {
    bySubject[subject].sort((a, b) =>
      a.examType !== b.examType
        ? a.examType.localeCompare(b.examType)
        : b.year !== a.year
          ? b.year - a.year
          : a.unit.localeCompare(b.unit)
    )
  }
  return bySubject
}

function groupRowsByYear(rows: ProgressRow[]) {
  const map = new Map<number, ProgressRow[]>()
  for (const r of rows) {
    const arr = map.get(r.year) ?? []
    arr.push(r)
    map.set(r.year, arr)
  }
  return Array.from(map.entries())
    .map(([year, yearRows]) => ({
      year,
      rows: yearRows.slice().sort((a, b) => a.examType.localeCompare(b.examType) || a.unit.localeCompare(b.unit)),
      total: yearRows.reduce((sum, r) => sum + r.total, 0),
      solved: yearRows.reduce((sum, r) => sum + r.solved, 0),
    }))
    .sort((a, b) => b.year - a.year)
}

function groupRowsByUnit(rows: ProgressRow[]) {
  const map = new Map<string, ProgressRow[]>()
  for (const r of rows) {
    const arr = map.get(r.unit) ?? []
    arr.push(r)
    map.set(r.unit, arr)
  }
  return Array.from(map.entries())
    .map(([unit, unitRows]) => ({
      unit,
      total: unitRows.reduce((sum, r) => sum + r.total, 0),
      solved: unitRows.reduce((sum, r) => sum + r.solved, 0),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit))
}

function progressStatus(solved: number, total: number) {
  const icon = solved === 0 ? '⬜' : solved === total ? '✅' : '🔄'
  const label = solved === 0 ? '미완료' : solved === total ? '완료' : '진행중'
  return { icon, label }
}

type ProgressViewMode = 'year' | 'unit' | 'all'
const PROGRESS_VIEW_OPTIONS: { id: ProgressViewMode; label: string }[] = [
  { id: 'year', label: '연도별' },
  { id: 'unit', label: '단원별' },
  { id: 'all', label: '전체목록' },
]

export function ProgressTable({ progress }: { progress: Record<string, ProgressRow[]> }) {
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  const [progressView, setProgressView] = useState<ProgressViewMode>('all')

  function toggleSubjectExpand(s: string) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleYearExpand(key: string) {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (Object.keys(progress).length === 0) return null

  return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-sm text-foreground">진도표</h2>
          <div className="flex gap-1.5">
            {PROGRESS_VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setProgressView(opt.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  progressView === opt.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {[
            ...SUBJECTS.filter((s) => progress[s]?.length),
            ...Object.keys(progress).filter((s) => !SUBJECTS.includes(s as Subject) && progress[s]?.length),
          ].map((s) => {
            const rows = progress[s]
            const total = rows.reduce((sum, r) => sum + r.total, 0)
            const solved = rows.reduce((sum, r) => sum + r.solved, 0)
            const expanded = expandedSubjects.has(s)
            return (
              <div key={s} className="bg-muted rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSubjectExpand(s)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/70 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`transition-transform text-muted-foreground ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-sm font-medium text-foreground">{s}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {solved}/{total}문제
                  </span>
                </button>
                {expanded && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {progressView === 'all' &&
                      groupRowsByYear(rows).map((yg) => {
                        const yearKey = `${s}|${yg.year}`
                        const yearExpanded = expandedYears.has(yearKey)
                        return (
                          <div key={yg.year} className="bg-card border border-border rounded-lg overflow-hidden">
                            <button
                              onClick={() => toggleYearExpand(yearKey)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-xs transition-transform text-muted-foreground ${yearExpanded ? 'rotate-90' : ''}`}>▶</span>
                                <span className="text-xs font-medium text-foreground">{yg.year}년</span>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {yg.solved}/{yg.total}문제
                              </span>
                            </button>
                            {yearExpanded && (
                              <div className="px-3 pb-2 space-y-1.5">
                                {yg.rows.map((r, i) => {
                                  const { icon, label } = progressStatus(r.solved, r.total)
                                  return (
                                    <div
                                      key={i}
                                      className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">
                                          {r.examType} · {r.unit}
                                        </p>
                                      </div>
                                      <span className="text-xs shrink-0">
                                        {icon} {label} ({r.solved}/{r.total})
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}

                    {progressView === 'year' &&
                      groupRowsByYear(rows).map((yg) => {
                        const { icon, label } = progressStatus(yg.solved, yg.total)
                        return (
                          <div
                            key={yg.year}
                            className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2"
                          >
                            <span className="text-xs font-medium text-foreground">{yg.year}년</span>
                            <span className="text-xs shrink-0">
                              {icon} {label} ({yg.solved}/{yg.total})
                            </span>
                          </div>
                        )
                      })}

                    {progressView === 'unit' &&
                      groupRowsByUnit(rows).map((ug) => {
                        const { icon, label } = progressStatus(ug.solved, ug.total)
                        return (
                          <div
                            key={ug.unit}
                            className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2"
                          >
                            <span className="text-xs font-medium text-foreground truncate">{ug.unit}</span>
                            <span className="text-xs shrink-0">
                              {icon} {label} ({ug.solved}/{ug.total})
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
  )
}
