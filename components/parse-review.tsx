'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { updateQuestionUnit, updateQuestionYear } from '@/lib/store'
import {
  buildParseReview, isMinorUnit, unitOptionsFor, yearOptions, UNKNOWN_YEAR,
  type UnitCount, type YearCount,
} from '@/lib/parseReview'

interface Props {
  questions: Question[]      // 검토 대상 (이번에 파싱한 파일들의 문제)
  onUnitChanged: () => void  // 단원을 고쳤을 때 상위에서 목록을 다시 읽도록
}

// 파싱 직후 결과를 점검하는 패널.
// A: 문제번호가 연속인지 (빠진 번호 = 파싱 누락 의심)
// B: 단원 분포 (엉뚱한 단원이 섞였는지 육안 확인 + 수정)
export function ParseReview({ questions, onUnitChanged }: Props) {
  const [openUnit, setOpenUnit] = useState<string | null>(null)
  const [openYear, setOpenYear] = useState<number | null>(null)
  // 수정 직후에도 화면이 바로 갱신되도록 로컬 변경분을 따로 들고 있는다
  const [editedUnit, setEditedUnit] = useState<Record<string, string>>({})
  const [editedYear, setEditedYear] = useState<Record<string, number>>({})

  const review = buildParseReview(
    questions.map((q) => {
      const unit = editedUnit[q.id]
      const year = editedYear[q.id]
      if (unit === undefined && year === undefined) return q
      return { ...q, ...(unit !== undefined && { unit }), ...(year !== undefined && { year }) }
    })
  )
  if (review.total === 0) return null

  function changeUnit(q: Question, unit: string) {
    updateQuestionUnit(q.id, unit)
    setEditedUnit((prev) => ({ ...prev, [q.id]: unit }))
    onUnitChanged()
  }

  function changeYear(q: Question, year: number) {
    updateQuestionYear(q.id, year)
    setEditedYear((prev) => ({ ...prev, [q.id]: year }))
    onUnitChanged()
  }

  const maxCount = review.units[0]?.count ?? 1

  return (
    <div className="border border-border rounded-lg divide-y divide-border text-sm">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="font-medium text-foreground">파싱 결과 검토</span>
        <span className="text-xs text-muted-foreground">총 {review.total}문제</span>
      </div>

      {/* A. 번호 연속성 */}
      <div className="px-3 py-2 space-y-1.5">
        {review.gaps.length === 0 ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ 문제 번호가 빠짐없이 이어집니다
          </p>
        ) : (
          review.gaps.map((g) => (
            <div key={`${g.subject}-${g.examType}-${g.year}`} className="text-xs space-y-0.5">
              <p className="text-amber-600 dark:text-amber-400 font-medium">⚠ 파싱 누락 의심</p>
              <p className="text-muted-foreground">
                {g.year} {g.examType} · {g.subject} · {g.min}~{g.max}번 중 {g.count}개 확인
              </p>
              <p className="text-foreground">
                빠진 번호: {g.missing.join(', ')}
                {g.missingTotal > g.missing.length && ` 외 ${g.missingTotal - g.missing.length}개`}
              </p>
              <p className="text-muted-foreground">→ 해당 페이지가 있는 청크를 다시 파싱해보세요</p>
            </div>
          ))
        )}
      </div>

      {/* 연도 분포 */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground">출제연도 분포</p>
        {review.yearDominant && review.years.length <= 1 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 전부 {review.yearDominant.year}년으로 판정됐습니다. 여러 회차 기출 모음이라면 파싱 오류일 수 있습니다
          </p>
        )}
        {review.yearDominant && review.years.length > 1 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ {review.yearDominant.year}년이 {Math.round(review.yearDominant.ratio * 100)}%로 몰려 있습니다
          </p>
        )}
        {review.years.map((row) => {
          const label = row.year === UNKNOWN_YEAR ? '연도 미상' : `${row.year}년`
          const note =
            row.problem === 'unknown' ? '⚠ 확인 실패'
            : row.problem === 'future' ? '⚠ 미래 연도'
            : row.problem === 'tooOld' ? '⚠ 범위 밖'
            : null
          return (
            <div key={row.year}>
              <button
                onClick={() => setOpenYear(openYear === row.year ? null : row.year)}
                className="w-full flex items-center gap-2 text-xs py-0.5 hover:opacity-80 transition-opacity"
              >
                <span className="w-24 text-left truncate text-foreground">{label}</span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{row.count}</span>
                <span className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                  <span
                    className={`block h-full rounded ${note ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${row.ratio * 100}%` }}
                  />
                </span>
                {note && <span className="text-amber-600 dark:text-amber-400 shrink-0">{note}</span>}
              </button>
              {openYear === row.year && <YearQuestionList row={row} onChange={changeYear} />}
            </div>
          )
        })}
        {review.years.some((y) => y.problem === 'unknown') && (
          <p className="text-[11px] text-muted-foreground pt-1">
            &apos;연도 미상&apos;은 AI가 해당 페이지에서 연도를 확인하지 못한 경우입니다. 눌러서 지정해주세요.
          </p>
        )}
      </div>

      {/* B. 단원 분포 */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground">단원 분포</p>
        {review.units.map((row) => {
          const key = `${row.subject}|${row.unit}`
          const suspicious = !row.valid || isMinorUnit(row, review)
          return (
            <div key={key}>
              <button
                onClick={() => setOpenUnit(openUnit === key ? null : key)}
                className="w-full flex items-center gap-2 text-xs py-0.5 hover:opacity-80 transition-opacity"
              >
                <span className="w-24 text-left truncate text-foreground">{row.unit}</span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{row.count}</span>
                <span className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                  <span
                    className={`block h-full rounded ${suspicious ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </span>
                {suspicious && (
                  <span className="text-amber-600 dark:text-amber-400 shrink-0">
                    {row.valid ? '⚠ 소수' : '⚠ 목록 밖'}
                  </span>
                )}
              </button>
              {openUnit === key && (
                <UnitQuestionList row={row} onChange={changeUnit} />
              )}
            </div>
          )
        })}
        {review.units.some((u) => !u.valid) && (
          <p className="text-[11px] text-muted-foreground pt-1">
            &apos;목록 밖&apos;은 AI가 정해진 단원 목록에 없는 값을 넣은 경우입니다. 눌러서 고쳐주세요.
          </p>
        )}
      </div>
    </div>
  )
}

function YearQuestionList({
  row,
  onChange,
}: {
  row: YearCount
  onChange: (q: Question, year: number) => void
}) {
  const options = yearOptions()
  return (
    <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
      {row.questions.map((q) => (
        <div key={q.id} className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground tabular-nums w-9">{q.no}번</span>
          <span className="flex-1 truncate text-foreground">{q.passage.slice(0, 40)}</span>
          <select
            value={options.includes(row.year) ? row.year : ''}
            onChange={(e) => e.target.value && onChange(q, Number(e.target.value))}
            className="shrink-0 bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">연도 변경…</option>
            {options.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

function UnitQuestionList({
  row,
  onChange,
}: {
  row: UnitCount
  onChange: (q: Question, unit: string) => void
}) {
  const options = unitOptionsFor(row.subject)
  return (
    <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
      {row.questions.map((q) => (
        <div key={q.id} className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground tabular-nums w-9">{q.no}번</span>
          <span className="flex-1 truncate text-foreground">{q.passage.slice(0, 40)}</span>
          <select
            value={options.includes(row.unit) ? row.unit : ''}
            onChange={(e) => e.target.value && onChange(q, e.target.value)}
            className="shrink-0 bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">단원 변경…</option>
            {options.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
