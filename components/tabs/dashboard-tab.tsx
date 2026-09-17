'use client'

import { useMemo } from 'react'
import type { Question, WrongNote } from '@/lib/types'
import { makeSourceLabeler } from '@/lib/questionSource'
import { ProgressTable, computeProgress } from '@/components/progress-table'

/**
 * 일반 사용자의 첫 탭 — 학습 현황.
 *
 * 관리자에게는 같은 자리에 'PDF 분석'(업로드·파싱·검토)이 뜬다. 일반 사용자는 문제를 만들지
 * 않고 받아서 푼다 — 그래서 여기에는 조회만 있다: 가진 문제의 요약과 진도표.
 *
 * 세는 대상은 CBT·선학습이 쓰는 것과 같은 목록(내 문제 + 공유받은 문제집)이다. 진도표를 내 문제로만
 * 세면, 올린 문제가 없는 일반 사용자에게는 늘 빈 표가 뜬다
 */

const SUBJECT_ORDER = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']

interface Props {
  questions: Question[]
  wrongNotes: WrongNote[]
}

export function DashboardTab({ questions, wrongNotes }: Props) {
  // 진도표와 같은 기준으로 '푼 문제'를 센다 (한 번이라도 채점된 문제)
  const solvedIds = useMemo(
    () => new Set(wrongNotes.filter((n) => (n.totalCount ?? 0) > 0).map((n) => n.questionId)),
    [wrongNotes]
  )
  const progress = useMemo(() => computeProgress(questions, wrongNotes), [questions, wrongNotes])

  const solved = questions.filter((q) => solvedIds.has(q.id)).length

  const subjects = useMemo(() => {
    const map = new Map<string, { count: number; solved: number; min: number; max: number }>()
    for (const q of questions) {
      const row = map.get(q.subject) ?? { count: 0, solved: 0, min: Infinity, max: -Infinity }
      row.count += 1
      if (solvedIds.has(q.id)) row.solved += 1
      // 연도 미상(0)은 범위에서 뺀다 — "0~2026년"으로 적히면 읽는 사람이 헷갈린다
      if (q.year) {
        row.min = Math.min(row.min, q.year)
        row.max = Math.max(row.max, q.year)
      }
      map.set(q.subject, row)
    }
    const rank = (s: string) => (SUBJECT_ORDER.includes(s) ? SUBJECT_ORDER.indexOf(s) : SUBJECT_ORDER.length)
    return Array.from(map.entries()).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [questions, solvedIds])

  // 문제집(출처)별. 이름은 기출판례 탭과 같은 규칙으로 붙인다 (같은 회차에 판본이 여럿일 때만 파일명)
  const sources = useMemo(() => {
    const label = makeSourceLabeler(questions)
    const map = new Map<string, { count: number; solved: number; shared: boolean; year: number }>()
    for (const q of questions) {
      const key = label(q)
      const row = map.get(key) ?? { count: 0, solved: 0, shared: false, year: 0 }
      row.count += 1
      if (solvedIds.has(q.id)) row.solved += 1
      if (q.poolId) row.shared = true
      row.year = Math.max(row.year, q.year || 0)
      map.set(key, row)
    }
    // 최근 회차가 위로
    return Array.from(map.entries()).sort((a, b) => b[1].year - a[1].year || a[0].localeCompare(b[0]))
  }, [questions, solvedIds])

  if (questions.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center space-y-1">
        <p className="text-sm font-medium text-foreground">아직 풀 수 있는 문제가 없습니다</p>
        <p className="text-xs text-muted-foreground">
          공유받은 문제집이 있으면 ⚙️ 설정의 &apos;공유받은 문제집&apos;에서 받아올 수 있어요
        </p>
      </div>
    )
  }

  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

  return (
    <div className="space-y-4">
      {/* 문제 정보 — 조회만 한다 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제 정보</h2>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '전체 문제', value: `${questions.length}` },
            { label: '풀어본 문제', value: `${solved}`, sub: `${rate(solved, questions.length)}%` },
            { label: '문제집', value: `${sources.length}` },
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
          {subjects.map(([subject, row]) => (
            <div key={subject} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{subject}</span>
                {row.min !== Infinity && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {row.min === row.max ? `${row.min}년` : `${row.min}~${row.max}년`}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {row.solved}/{row.count}문제 · {rate(row.solved, row.count)}%
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">문제집별</p>
          {sources.map(([name, row]) => (
            <div key={name} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium text-foreground truncate">{name}</span>
                {row.shared && (
                  <span className="shrink-0 text-[10px] text-primary border border-primary/30 rounded px-1">공유</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {row.solved}/{row.count}문제
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 진도표 — 관리자 화면과 같은 컴포넌트 */}
      <ProgressTable progress={progress} />
    </div>
  )
}
