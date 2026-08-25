'use client'

import { useState } from 'react'
import type { Question } from '@/lib/types'
import { updateQuestionUnit, updateQuestionYear } from '@/lib/store'
import {
  buildParseReview, isMinorUnit, unitOptionsFor, yearOptions, formatMissing, allMissing, UNKNOWN_YEAR,
  type GroupCheck, type UnitCount, type YearCount, type QuestionPage,
} from '@/lib/parseReview'

// 결번이 난 회차를 다시 파싱해달라는 요청. 실제 재파싱은 원본 PDF와 API 키를 쥔 상위(pdf-tab)가 한다
export interface ReparseRequest {
  sourceFile: string
  subject: string
  examType: string
  year: number
  nos: number[] // 이미 확인된 번호 (페이지 추정용)
  missing: number[]
  // 파싱 때 기록된 실제 페이지 구간. 이게 있으면 번호 비율로 어림잡지 않아도 된다.
  // 1단계 이전에 파싱된 문제집에서는 빈 배열이다
  pages: QuestionPage[]
}

interface Props {
  questions: Question[]      // 검토 대상 (이번에 파싱한 파일들의 문제)
  onUnitChanged: () => void  // 단원을 고쳤을 때 상위에서 목록을 다시 읽도록
  // 없으면 재파싱 버튼을 숨긴다 (원본을 다룰 수 없는 화면에서도 이 패널을 쓸 수 있게)
  onReparse?: (req: ReparseRequest) => void
  reparseDisabled?: boolean
}

// 파싱 직후 결과를 점검하는 패널.
// A: 문제번호가 연속인지 (빠진 번호 = 파싱 누락 의심)
// B: 단원 분포 (엉뚱한 단원이 섞였는지 육안 확인 + 수정)
export function ParseReview({ questions, onUnitChanged, onReparse, reparseDisabled }: Props) {
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

  // 검토 대상 파일명 (문제에 기록된 sourceFile에서 뽑는다)
  const reviewedFiles = Array.from(new Set(questions.map((q) => q.sourceFile).filter(Boolean))) as string[]

  const maxCount = review.units[0]?.count ?? 1

  return (
    <div className="border border-border rounded-lg divide-y divide-border text-sm">
      <div className="px-3 py-2 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">파싱 결과 검토</span>
          <span className="text-xs text-muted-foreground">총 {review.total}문제</span>
        </div>
        {/* 어떤 파일에 대한 검토인지 밝힌다. 같은 문제집을 나눠 파싱하면 누적 집계가 나오므로
            "이번에 추가된 것만"으로 오해하지 않도록 파일명을 함께 보여준다 */}
        {reviewedFiles.length > 0 && (
          <p className="text-[11px] text-muted-foreground truncate">{reviewedFiles.join(', ')}</p>
        )}
      </div>

      {/* A. 번호 연속성 */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground">번호 연속성</p>
        {review.skippedUnknownYear > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 연도 미상 {review.skippedUnknownYear}문제는 어느 회차인지 알 수 없어 검사에서 뺐습니다.
            아래 &apos;출제연도 분포&apos;에서 연도를 지정한 뒤 다시 확인해주세요
          </p>
        )}
        {review.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">번호를 확인할 수 있는 문제가 없습니다</p>
        ) : (
          review.groups.map((g) => (
            <GroupRow
              key={g.runId}
              g={g}
              onReparse={onReparse}
              reparseDisabled={reparseDisabled}
            />
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

// 한 회차의 번호 연속성. 이상이 없을 때도 "무엇을 근거로 괜찮다고 하는지"를 함께 적는다.
// 예전에는 "✓ 빠짐없이 이어집니다"만 띄웠는데, 뒷부분이 통째로 잘린 경우도 남은 번호끼리는
// 연속이라 그 문구가 그대로 떴다. 실제 범위를 보여주면 사용자가 눈으로 잡을 수 있다
function GroupRow({
  g,
  onReparse,
  reparseDisabled,
}: {
  g: GroupCheck
  onReparse?: (req: ReparseRequest) => void
  reparseDisabled?: boolean
}) {
  // 한 파일에 같은 과목·연도의 토막이 여럿일 수 있으므로(단원별 문제집) 페이지 구간까지 붙인다.
  // 연도는 이제 묶는 기준이 아니라 이름표라, 섞여 있으면 섞였다고 밝힌다
  // 재파싱은 원본 파일이 있어야 걸 수 있다. 미리 뽑아 두어야 아래 콜백 안에서도 좁혀진 채로 쓰인다
  const sourceFile = g.sourceFile
  const yearLabel = g.yearMixed ? '연도 섞임' : g.year === UNKNOWN_YEAR ? '연도 미상' : `${g.year}년`
  const pageLabel = g.pageFrom !== null ? ` · ${g.pageFrom}~${g.pageTo}쪽` : ''
  const label = `${g.subject} · ${g.examType} · ${yearLabel}${pageLabel}`
  if (g.ok) {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        ✓ {label} <span className="tabular-nums">{g.min}~{g.max}번</span> 연속 ({g.count}문제)
        {g.expectedMax === null && (
          <span className="text-muted-foreground"> · 마지막 번호는 확인 불가</span>
        )}
      </p>
    )
  }
  return (
    <div className="text-xs space-y-0.5">
      <p className="text-amber-600 dark:text-amber-400 font-medium">⚠ 파싱 누락 의심</p>
      <p className="text-muted-foreground">
        {label} · <span className="tabular-nums">{g.min}~{g.max}번</span> 중 {g.count}개 확인
      </p>
      {g.headMissing > 0 && (
        <p className="text-foreground">
          앞부분 {g.headMissing}개 없음: <span className="tabular-nums">1~{g.min - 1}번</span>
        </p>
      )}
      {g.interior.length > 0 && (
        <p className="text-foreground">
          {g.sparse ? '확인된 문제보다 빠진 번호가 많습니다' : '빠진 번호'}:{' '}
          <span className="tabular-nums">{formatMissing(g.interior)}</span>
        </p>
      )}
      {g.tailMissing > 0 && (
        <p className="text-foreground">
          뒷부분 {g.tailMissing}개 없음: <span className="tabular-nums">{g.max + 1}~{g.expectedMax}번</span>
          <span className="text-muted-foreground"> (다른 회차는 {g.expectedMax}번까지 있습니다)</span>
        </p>
      )}
      <p className="text-muted-foreground">
        {g.sparse
          ? '→ 번호를 골라 담은 교재라면 정상입니다. 아니라면 해당 구간을 다시 파싱해보세요'
          : '→ 빠진 번호가 있는 페이지 구간만 다시 파싱할 수 있습니다'}
      </p>
      {onReparse && sourceFile && (
        <button
          type="button"
          disabled={reparseDisabled}
          onClick={() =>
            onReparse({
              sourceFile,
              subject: g.subject,
              examType: g.examType,
              year: g.year,
              nos: g.nos,
              missing: allMissing(g),
              pages: g.pages,
            })
          }
          className="mt-1 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🔁 이 구간 다시 파싱
        </button>
      )}
    </div>
  )
}
