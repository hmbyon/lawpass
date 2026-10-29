'use client'

import { useState } from 'react'
import { getAppMode } from '@/lib/appMode'
import { fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import { missProblems } from '@/lib/caseStudy/missView'
import { caseProgress, groupRows, groupRowsByYear, type CaseProgress } from '@/lib/caseStudy/progress'
import { loadMissData } from '@/components/case-study/case-miss-shared'

/**
 * 사례형 학습 현황 — 선택형 학습 현황(components/tabs/dashboard-tab, progress-table)과 같은 모양·클래스.
 * 문항 정보 3칸, 과목별, 시험별, 진도표(연도별/단원별/전체목록). 조회만 한다(AI 를 부르지 않는다).
 * 오답노트 문항 수도 함께 세어 탭 배지·헤더 숫자에 쓴다
 */

export interface CaseStatusData {
  progress: CaseProgress
  /** 오답노트 목록의 문항 수(필터 없음) */
  missCount: number
}

export async function loadCaseStatus(): Promise<CaseStatusData> {
  const [index, misses] = await Promise.all([
    fetchCaseIndex(getAppMode()).catch(() => {
      throw new Error('목차를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
    }),
    loadMissData(),
  ])
  return { progress: caseProgress(index, misses.submitted), missCount: missProblems(misses.result.items).length }
}

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function progressStatus(solved: number, total: number) {
  const icon = solved === 0 ? '⬜' : solved === total ? '✅' : '🔄'
  const label = solved === 0 ? '미완료' : solved === total ? '완료' : '진행중'
  return `${icon} ${label} (${solved}/${total})`
}

type ProgressView = 'year' | 'unit' | 'all'
const VIEWS: { id: ProgressView; label: string }[] = [
  { id: 'year', label: '연도별' },
  { id: 'unit', label: '단원별' },
  { id: 'all', label: '전체목록' },
]
const yearLabel = (y: number | null) => (y === null ? '연도 없음' : `${y}년`)

export function CaseStatus({
  data, error, loading, onRetry,
}: { data: CaseStatusData | null; error: string; loading: boolean; onRetry: () => void }) {
  const [view, setView] = useState<ProgressView>('all')
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set())
  const [openYears, setOpenYears] = useState<Set<string>>(new Set())
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (loading && !data) return <p className="py-8 text-center text-xs text-muted-foreground animate-pulse">불러오는 중…</p>
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400">
        {error}
        <button onClick={onRetry} className="min-h-8 px-1 text-primary hover:underline">다시 시도</button>
      </div>
    )
  }
  if (!data) return null
  const p = data.progress
  if (p.total === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center">
        <p className="text-sm font-medium text-foreground">아직 풀 수 있는 사례형 문항이 없습니다</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제 정보</h2>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '전체 문항', value: `${p.total}` },
            { label: '풀어본 문항', value: `${p.solved}`, sub: `${rate(p.solved, p.total)}%` },
            { label: '시험 수', value: `${p.examCount}` },
          ].map((tile) => (
            <div key={tile.label} className="bg-muted rounded-lg px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{tile.label}</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">
                {tile.value}
                {tile.sub && <span className="ml-1 text-xs font-normal text-muted-foreground">{tile.sub}</span>}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">과목별</p>
          {p.subjects.map((s) => (
            <div key={s.subject} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{s.label}</span>
                {s.minYear !== null && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {s.minYear === s.maxYear ? `${s.minYear}년` : `${s.minYear}~${s.maxYear}년`}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {s.solved}/{s.total}문항 · {rate(s.solved, s.total)}%
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">시험별</p>
          {p.exams.map((e) => (
            <div key={e.key} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
              <span className="text-xs font-medium text-foreground truncate">{e.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {e.solved}/{e.total}문항
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 진도표 — components/progress-table 과 같은 모양. 단원은 카드 분류(답안·목차와 같은 이름) */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-sm text-foreground">진도표</h2>
          <div className="flex gap-1.5">
            {VIEWS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setView(opt.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  view === opt.id
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
          {p.subjects.map((s) => {
            const rows = p.rows.filter((r) => r.subject === s.subject)
            const expanded = openSubjects.has(s.subject)
            return (
              <div key={s.subject} className="bg-muted rounded-lg overflow-hidden">
                <button
                  onClick={() => toggle(setOpenSubjects, s.subject)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/70 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`transition-transform text-muted-foreground ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {s.solved}/{s.total}문항
                  </span>
                </button>
                {expanded && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {view === 'all' &&
                      groupRowsByYear(rows).map((yg) => {
                        const yearKey = `${s.subject}|${yg.key}`
                        const yearOpen = openYears.has(yearKey)
                        return (
                          <div key={yearKey} className="bg-card border border-border rounded-lg overflow-hidden">
                            <button
                              onClick={() => toggle(setOpenYears, yearKey)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-xs transition-transform text-muted-foreground ${yearOpen ? 'rotate-90' : ''}`}>▶</span>
                                <span className="text-xs font-medium text-foreground">{yearLabel(yg.key)}</span>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {yg.solved}/{yg.total}문항
                              </span>
                            </button>
                            {yearOpen && (
                              <div className="px-3 pb-2 space-y-1.5">
                                {yg.rows.map((r) => (
                                  <div key={`${r.examKey}|${r.unit}`} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-foreground truncate">
                                        {r.exam} · {r.unit}
                                      </p>
                                    </div>
                                    <span className="text-xs shrink-0">{progressStatus(r.solved, r.total)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}

                    {view === 'year' &&
                      groupRowsByYear(rows).map((yg) => (
                        <div key={String(yg.key)} className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2">
                          <span className="text-xs font-medium text-foreground">{yearLabel(yg.key)}</span>
                          <span className="text-xs shrink-0">{progressStatus(yg.solved, yg.total)}</span>
                        </div>
                      ))}

                    {view === 'unit' &&
                      groupRows(rows, (r) => r.unit).map((ug) => (
                        <div key={ug.key} className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2">
                          <span className="text-xs font-medium text-foreground truncate">{ug.key}</span>
                          <span className="text-xs shrink-0">{progressStatus(ug.solved, ug.total)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
