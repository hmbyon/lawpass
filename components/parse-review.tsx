'use client'

import { useState } from 'react'
import type { Question, Subject } from '@/lib/types'
import {
  updateQuestionUnit, updateQuestionYear, updateQuestionSubject, deleteQuestion, mergeQuestionInto,
} from '@/lib/store'
import { canonicalUnit } from '@/lib/units'
import {
  buildParseReview, unitWarning, unitOptionsFor, subjectOptions, yearOptions, formatMissing, allMissing,
  gapLabel, gapNumbers, UNKNOWN_YEAR,
  type GroupCheck, type UnitCount, type YearCount, type QuestionPage, type SimilarPair,
  // 이 파일의 컴포넌트 이름과 겹쳐서 갈아 끼운다
  type ParseReview as ParseReviewData,
} from '@/lib/parseReview'

// 화면에 보이는 순서만 문제번호 오름차순으로 바꾼다. 저장 배열은 절대 손대지 않는다 —
// parseReview.ts의 런 자르기가 페이지 정보 없는 옛 데이터에서 '저장 순서'를 순서의 근거로 쓰고,
// 그게 결번 검사의 마지막 버팀목이다. 그래서 여기서 사본을 만들어 정렬한다.
//
// 번호를 읽지 못한 문제(null·NaN)는 맨 뒤로 보낸다. 번호가 없다는 것 자체가 확인이 필요한
// 상태라 목록 중간에 끼어 있으면 눈에 띄지 않는다.
// 정렬은 안정적이므로 같은 번호가 두 벌이면 저장된 순서대로 나란히 붙는다 (중복 대조에 그게 낫다)
function byQuestionNo(list: Question[]): Question[] {
  // 타입은 number지만 실제로는 null이 들어올 수 있다 — 모델이 번호를 확인하지 못하면
  // null을 주도록 프롬프트에 적어두었고, 그 값이 그대로 저장된다.
  // Number(null)은 0이라 그냥 Number로 바꾸면 번호 미상이 1번보다 앞에 서버린다
  const no = (q: Question): number => {
    const raw = q.no as unknown
    if (raw === null || raw === undefined || raw === '') return NaN
    const n = Number(raw)
    return Number.isFinite(n) ? n : NaN
  }
  return [...list].sort((a, b) => {
    const na = no(a)
    const nb = no(b)
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0
    if (Number.isNaN(na)) return 1
    if (Number.isNaN(nb)) return -1
    return na - nb
  })
}

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
  // 빠진 번호 덩어리의 앞뒤 이웃으로 확정한 쪽 구간. 있으면 이것만 쓰면 된다 —
  // 어디가 비었는지 이미 알고 요청하는 것이라 다시 어림잡을 이유가 없다
  pageHint?: { from: number; to: number }
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
  // 여러 줄을 동시에 펼쳐둘 수 있다. 단원 분포와 연도 분포를 오가며 견주는 일이 잦은데,
  // 하나만 열리면 앞서 본 줄이 계속 접혀 비교가 끊긴다.
  // 연도는 숫자지만 키를 문자열로 통일해 두 집합이 같은 방식으로 다뤄지게 한다
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set())
  const [openYears, setOpenYears] = useState<Set<string>>(new Set())
  // 지문이 길어서 한 번에 하나만 펼친다
  const [openQuestion, setOpenQuestion] = useState<string | null>(null)
  // 집합을 제자리에서 고치면 참조가 그대로라 리렌더가 일어나지 않는다. 새 Set으로 바꾼다
  function toggleIn(setState: (fn: (prev: Set<string>) => Set<string>) => void, key: string) {
    setState((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  // 수정 직후에도 화면이 바로 갱신되도록 로컬 변경분을 따로 들고 있는다
  const [editedUnit, setEditedUnit] = useState<Record<string, string>>({})
  const [editedYear, setEditedYear] = useState<Record<string, number>>({})
  const [editedSubject, setEditedSubject] = useState<Record<string, Subject>>({})

  const review = buildParseReview(
    questions.map((q) => {
      const unit = editedUnit[q.id]
      const year = editedYear[q.id]
      const subject = editedSubject[q.id]
      if (unit === undefined && year === undefined && subject === undefined) return q
      return {
        ...q,
        ...(unit !== undefined && { unit }),
        ...(year !== undefined && { year }),
        // 사람이 골랐으면 미판정 표시도 함께 걷는다 (store.updateQuestionSubject와 같은 판단).
        // 그래야 이 문제가 '과목 미판정' 목록에서 바로 빠진다
        ...(subject !== undefined && { subject, subjectUnsure: undefined }),
      }
    })
  )
  if (review.total === 0) return null

  function changeUnit(q: Question, unit: string) {
    updateQuestionUnit(q.id, unit)
    setEditedUnit((prev) => ({ ...prev, [q.id]: unit }))
    onUnitChanged()
  }

  function changeSubject(q: Question, subject: Subject) {
    updateQuestionSubject(q.id, subject)
    setEditedSubject((prev) => ({ ...prev, [q.id]: subject }))
    onUnitChanged()
  }

  // 사람이 "이 둘은 다른 문제"라고 판단한 쌍. 이 화면에서만 기억한다 —
  // 검토 화면은 한 번 보고 닫는 자리라 굳이 저장까지 할 일이 아니다
  const [ignoredPairs, setIgnoredPairs] = useState<Set<string>>(new Set())
  const pairKey = (p: SimilarPair) => `${p.a.id}|${p.b.id}`

  function mergePair(p: SimilarPair) {
    if (
      !confirm(
        `${p.a.no}번 두 문제를 하나로 합칩니다.\n\n` +
          '아래쪽 문제가 지워지고 그 해설은 위쪽으로 옮겨집니다.\n' +
          '되돌릴 수 없습니다 — 두 지문이 정말 같은 문제인지 확인하고 눌러주세요.'
      )
    ) {
      return
    }
    mergeQuestionInto(p.a.id, p.b.id)
    setIgnoredPairs((prev) => new Set(prev).add(pairKey(p)))
    onUnitChanged()
  }

  function changeYear(q: Question, year: number) {
    updateQuestionYear(q.id, year)
    setEditedYear((prev) => ({ ...prev, [q.id]: year }))
    onUnitChanged()
  }

  // 되돌릴 수 없으므로 지문 앞부분까지 보여주고 확인을 받는다
  function removeQuestion(q: Question) {
    const preview = q.passage.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!confirm(`${q.no}번 문제를 삭제할까요?\n\n${preview}…\n\n되돌릴 수 없습니다.`)) return
    deleteQuestion(q.id)
    setOpenQuestion(null)
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
        {review.unknownYearCount > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 연도를 확인하지 못한 문제가 {review.unknownYearCount}개 있습니다. 번호 연속성 검사에는 함께
            넣었지만, 아래 &apos;출제연도 분포&apos;에서 연도를 지정해주세요
          </p>
        )}
        {review.similarPairs.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ 지문이 거의 같은 쌍 {review.similarPairs.length}건은 합치지 않고 따로 세었습니다.
          </p>
        )}
        {review.yearConflicts.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ 연도가 갈린 문제 {review.yearConflicts.length}개는 먼저 읽은 연도 기준으로 검사했습니다.
          </p>
        )}
        {review.unsureSubjects.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 과목을 판정하지 못한 문제 {review.unsureSubjects.length}개는 임시로 담긴 과목 기준으로 검사했습니다.
            아래 &apos;과목 미판정&apos;에서 지정해주세요
          </p>
        )}
        {Object.keys(review.duplicateIds).length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 같은 문제가 두 벌 저장된 것이 {Object.keys(review.duplicateIds).length}개 있습니다.
            아래 &apos;단원 분포&apos;를 펼치면 해당 문제에 &apos;⚠ 중복&apos; 표시가 붙습니다 — 눌러서 지문을 견줘보세요
          </p>
        )}
        {review.singletonRuns > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 앞뒤 번호와 이어지지 않는 낱개 문제 {review.singletonRuns}개는 연속성 검사에서 뺐습니다.
            번호를 잘못 읽었거나 다른 회차의 문제가 섞여 들어왔을 수 있습니다
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

      {/* 과목 미판정 — 있을 때만 나온다 */}
      {review.similarPairs.filter((p) => !ignoredPairs.has(pairKey(p))).length > 0 && (
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">유사 후보</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 지문이 거의 같은 문제가{' '}
            {review.similarPairs.filter((p) => !ignoredPairs.has(pairKey(p))).length}쌍 있습니다.
            글자가 조금 달라 자동으로 합치지 않았습니다 — 두 지문을 보고 같은 문제인지 정해주세요
          </p>
          {review.similarPairs
            .filter((p) => !ignoredPairs.has(pairKey(p)))
            .map((p) => (
              <div key={pairKey(p)} className="rounded border border-border p-2 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="flex-1">
                    {p.a.subject} · {p.a.no}번 · {p.distance}글자 다름
                  </span>
                  <button
                    type="button"
                    onClick={() => mergePair(p)}
                    className="shrink-0 px-2 py-0.5 border border-primary/40 text-primary rounded hover:bg-primary/10 transition-colors"
                  >
                    같은 문제 — 합치기
                  </button>
                  <button
                    type="button"
                    onClick={() => setIgnoredPairs((prev) => new Set(prev).add(pairKey(p)))}
                    className="shrink-0 px-2 py-0.5 border border-border text-muted-foreground rounded hover:bg-muted transition-colors"
                  >
                    다른 문제
                  </button>
                </div>
                {/* 두 지문을 그대로 나란히 놓는다. 어디가 다른지는 사람이 봐야 안다 */}
                <p className="text-[11px] text-foreground whitespace-pre-wrap break-all">
                  <span className="text-muted-foreground">위 </span>
                  {p.a.passage}
                </p>
                <p className="text-[11px] text-foreground whitespace-pre-wrap break-all">
                  <span className="text-muted-foreground">아래 </span>
                  {p.b.passage}
                </p>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground pt-1">
            합치면 아래쪽이 지워지고 해설은 위쪽으로 옮겨집니다. 되돌릴 수 없습니다.
          </p>
        </div>
      )}

      {review.yearConflicts.length > 0 && (
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">연도 갈림</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 같은 문제를 두 번 읽으면서 연도가 다르게 나온 문제가 {review.yearConflicts.length}개 있습니다.
            어느 쪽이 맞는지 정할 수 없어 먼저 읽은 값을 그대로 두었습니다 — 아래에서 지정해주세요
          </p>
          <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
            {byQuestionNo(review.yearConflicts).map((q) => (
              <QuestionRow
                key={q.id}
                q={q}
                duplicates={review.duplicateIds[q.id] ?? 0}
                open={openQuestion === q.id}
                onToggle={() => setOpenQuestion(openQuestion === q.id ? null : q.id)}
                onDelete={removeQuestion}
              >
                {/* 후보를 그대로 보여준다. 어느 값들 사이에서 갈렸는지가 판단 근거다 */}
                <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
                  {(q.yearConflict ?? []).map((y) => (y === UNKNOWN_YEAR ? '미상' : `${y}년`)).join(' / ')}
                </span>
                <select
                  value=""
                  onChange={(e) => e.target.value && changeYear(q, Number(e.target.value))}
                  className="shrink-0 bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">연도 지정…</option>
                  {yearOptions().map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>
              </QuestionRow>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            청크가 겹치는 구간에서 같은 문제를 두 번 읽으면 생깁니다. 지정하면 표시가 사라집니다.
          </p>
        </div>
      )}

      {review.unsureSubjects.length > 0 && (
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">과목 미판정</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 어느 과목인지 판정할 근거를 찾지 못한 문제가 {review.unsureSubjects.length}개 있습니다.
            고른 과목 중 첫 번째로 임시로 담아 두었습니다 — 아래에서 실제 과목을 지정해주세요
          </p>
          <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
            {byQuestionNo(review.unsureSubjects).map((q) => (
              <QuestionRow
                key={q.id}
                q={q}
                duplicates={review.duplicateIds[q.id] ?? 0}
                open={openQuestion === q.id}
                onToggle={() => setOpenQuestion(openQuestion === q.id ? null : q.id)}
                onDelete={removeQuestion}
              >
                {/* 지금 담긴 과목을 선택 상태로 두지 않는다. 판정된 값처럼 보이면 안 되므로 */}
                <select
                  value=""
                  onChange={(e) => e.target.value && changeSubject(q, e.target.value as Subject)}
                  className="shrink-0 bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">과목 지정…</option>
                  {subjectOptions().map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </QuestionRow>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            과목은 번호 연속성 검사에서 문제를 묶는 기준이기도 합니다. 임시로 담긴 채 두면 결번 검사도 함께 어긋납니다.
            펼치면 지금 담긴 과목과 쪽 번호를 볼 수 있습니다.
          </p>
        </div>
      )}

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
                onClick={() => toggleIn(setOpenYears, String(row.year))}
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
              {openYears.has(String(row.year)) && (
                <YearQuestionList
                  row={row}
                  review={review}
                  openId={openQuestion}
                  onOpen={setOpenQuestion}
                  onDelete={removeQuestion}
                  onChange={changeYear}
                />
              )}
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
          const warning = unitWarning(row, review)
          return (
            <div key={key}>
              <button
                onClick={() => toggleIn(setOpenUnits, key)}
                className="w-full flex items-center gap-2 text-xs py-0.5 hover:opacity-80 transition-opacity"
              >
                {/* 과목까지 적는다. '총론'은 형법·헌법·행정법에, '증거'는 두 소송법에 다 있어서
                    단원 이름만 찍으면 여러 과목이 섞인 파일에서 같은 줄이 여러 번 나온 것처럼 보인다 */}
                <span className="w-36 text-left truncate text-foreground">
                  <span className="text-muted-foreground">{row.subject}</span> · {row.unit}
                </span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{row.count}</span>
                <span className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                  <span
                    className={`block h-full rounded ${warning ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </span>
                {warning && (
                  <span className="text-amber-600 dark:text-amber-400 shrink-0">⚠ {warning}</span>
                )}
              </button>
              {openUnits.has(key) && (
                <UnitQuestionList
                  row={row}
                  review={review}
                  openId={openQuestion}
                  onOpen={setOpenQuestion}
                  onDelete={removeQuestion}
                  onChange={changeUnit}
                />
              )}
            </div>
          )
        })}
        {review.units.some((u) => unitWarning(u, review) === '목록 밖') && (
          <p className="text-[11px] text-muted-foreground pt-1">
            &apos;목록 밖&apos;은 AI가 정해진 단원 목록에 없는 값을 넣은 경우입니다. 눌러서 고쳐주세요.
          </p>
        )}
        {review.units.some((u) => unitWarning(u, review) === '과목 미판정') && (
          <p className="text-[11px] text-muted-foreground pt-1">
            &apos;과목 미판정&apos;은 AI가 과목을 정하지 못해 임시로 담아둔 문제입니다. 단원이 아니라 위쪽
            &apos;과목 미판정&apos; 목록에서 과목부터 고쳐주세요.
          </p>
        )}
      </div>
    </div>
  )
}

// 단원·연도 목록의 한 줄. 눌러서 지문 전체를 펼친다.
// 40자로 잘린 미리보기만으로는 두 판본이 같은 문제인지 가릴 수가 없어서 만들었다
function QuestionRow({
  q,
  duplicates,
  open,
  onToggle,
  onDelete,
  children,
}: {
  q: Question
  duplicates: number // 같은 문제가 몇 벌 저장돼 있는지 (2 이상이면 표시)
  open: boolean
  onToggle: () => void
  onDelete: (q: Question) => void
  children: React.ReactNode // 단원/연도 변경 드롭다운
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          <span className="shrink-0 text-muted-foreground">{open ? '▾' : '▸'}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums w-9">{q.no}번</span>
          <span className="flex-1 truncate text-foreground">{q.passage.slice(0, 40)}</span>
          {duplicates >= 2 && (
            <span className="shrink-0 text-amber-600 dark:text-amber-400">⚠ 중복 {duplicates}건</span>
          )}
        </button>
        {/* 드롭다운 조작이 펼침을 건드리지 않도록 버튼 밖에 둔다 */}
        {children}
      </div>
      {open && <QuestionDetail q={q} duplicates={duplicates} onDelete={onDelete} />}
    </div>
  )
}

function QuestionDetail({
  q,
  duplicates,
  onDelete,
}: {
  q: Question
  duplicates: number
  onDelete: (q: Question) => void
}) {
  const pages = q.pageFrom !== undefined ? `${q.pageFrom}~${q.pageTo}쪽` : '쪽 모름'
  const meta = [
    q.subject,
    q.examType,
    q.year === UNKNOWN_YEAR ? '연도 미상' : `${q.year}년`,
    q.unit?.trim() || '단원 없음',
    pages,
    q.sourceFile ?? '파일 미상',
  ].join(' · ')
  const filled = q.choices.filter((c) => c.text?.trim())
  const explanation = q.explanations?.[0] ?? q.explanation
  return (
    <div className="ml-6 mt-1 mb-2 p-2 rounded bg-muted/50 border border-border space-y-1.5 text-xs">
      <p className="text-muted-foreground">{meta}</p>
      {duplicates >= 2 && (
        <p className="text-amber-600 dark:text-amber-400">
          같은 번호·같은 지문이 {duplicates}벌 저장돼 있습니다. 쪽 번호를 견줘 한쪽을 지워주세요
        </p>
      )}
      <p className="text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">{q.passage}</p>
      {filled.length > 0 && (
        <div className="space-y-0.5">
          {filled.map((c) => (
            <p key={c.label} className={c.label === q.answer ? 'text-foreground font-medium' : 'text-muted-foreground'}>
              {c.label} {c.text}
              {c.label === q.answer && <span className="text-emerald-600 dark:text-emerald-400"> ← 정답</span>}
            </p>
          ))}
        </div>
      )}
      {explanation && (
        <p className="text-muted-foreground">
          해설: {typeof explanation === 'string' ? explanation.slice(0, 200) : ''}
          {typeof explanation === 'string' && explanation.length > 200 ? '…' : ''}
        </p>
      )}
      {(q.subItems?.length || q.passageTable?.length) && (
        <p className="text-muted-foreground">
          {q.subItems?.length ? `보기 ${q.subItems.length}개 ` : ''}
          {q.passageTable?.length ? `표 ${q.passageTable.length}개` : ''}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <p className="text-[11px] text-muted-foreground break-all">id: {q.id}</p>
        <button
          type="button"
          onClick={() => onDelete(q)}
          className="shrink-0 px-2 py-1 border border-red-400/40 text-red-400 rounded text-xs font-medium hover:bg-red-400/10 transition-colors"
        >
          이 문제 삭제
        </button>
      </div>
    </div>
  )
}

function YearQuestionList({
  row,
  review,
  openId,
  onOpen,
  onDelete,
  onChange,
}: {
  row: YearCount
  review: ParseReviewData
  openId: string | null
  onOpen: (id: string | null) => void
  onDelete: (q: Question) => void
  onChange: (q: Question, year: number) => void
}) {
  const options = yearOptions()
  return (
    <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
      {byQuestionNo(row.questions).map((q) => (
        <QuestionRow
          key={q.id}
          q={q}
          duplicates={review.duplicateIds[q.id] ?? 0}
          open={openId === q.id}
          onToggle={() => onOpen(openId === q.id ? null : q.id)}
          onDelete={onDelete}
        >
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
        </QuestionRow>
      ))}
    </div>
  )
}

function UnitQuestionList({
  row,
  review,
  openId,
  onOpen,
  onDelete,
  onChange,
}: {
  row: UnitCount
  review: ParseReviewData
  openId: string | null
  onOpen: (id: string | null) => void
  onDelete: (q: Question) => void
  onChange: (q: Question, unit: string) => void
}) {
  const options = unitOptionsFor(row.subject)
  // 과목명이 앞에 붙은 값("행정법총론")은 저장된 그대로는 목록에 없다. 가리키는 정식 단원을
  // 골라 둬야 드롭다운이 "단원 변경…"이 아니라 그 단원을 가리킨다
  const selected = canonicalUnit(row.subject, row.unit) ?? ''
  return (
    <div className="ml-2 mt-1 mb-1.5 pl-2 border-l-2 border-border space-y-1">
      {byQuestionNo(row.questions).map((q) => (
        <QuestionRow
          key={q.id}
          q={q}
          duplicates={review.duplicateIds[q.id] ?? 0}
          open={openId === q.id}
          onToggle={() => onOpen(openId === q.id ? null : q.id)}
          onDelete={onDelete}
        >
          <select
            value={selected}
            onChange={(e) => e.target.value && onChange(q, e.target.value)}
            className="shrink-0 bg-input border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">단원 변경…</option>
            {options.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </QuestionRow>
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
  if (g.verdict === 'ok') {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        ✓ {label} · <span className="tabular-nums">{g.min}~{g.max}번</span> 연속 ({g.count}문제)
        {g.expectedMax === null && (
          <span className="text-muted-foreground"> · 마지막 번호는 확인 불가</span>
        )}
      </p>
    )
  }
  // 빠진 번호가 전부 '애초에 안 실린 것'으로 판정된 런. 경고가 아니라 사실 확인이다.
  // 판정은 하되 번호는 숨기지 않는다 — 사용자가 눈으로 반박할 여지를 남겨야 한다
  if (g.verdict === 'excerpt') {
    return (
      <div className="text-xs space-y-0.5">
        <p className="text-emerald-600 dark:text-emerald-400">
          ✓ {label} · <span className="tabular-nums">{g.min}~{g.max}번</span> 중 {g.count}문제 · 발췌본으로 보입니다
        </p>
        <p className="text-muted-foreground">
          빠진 번호(<span className="tabular-nums">{formatMissing(allMissing(g))}</span>)는 자리에 빈 쪽이 없어
          애초에 실리지 않은 것으로 봅니다
        </p>
      </div>
    )
  }

  const unknown = g.verdict === 'unknown'
  return (
    <div className="text-xs space-y-0.5">
      <p className={`font-medium ${unknown ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
        {unknown ? '? 판단 보류' : '⚠ 파싱 누락 의심'}
      </p>
      <p className="text-muted-foreground">
        {label} · <span className="tabular-nums">{g.min}~{g.max}번</span> 중 {g.count}개 확인
      </p>

      {/* 빠진 번호를 덩어리로 하나씩. 왜 그렇게 봤는지를 번호 옆에 붙여 둔다 */}
      {g.gaps.map((gap) => (
        <div key={`${gap.kind}-${gap.from}`} className="space-y-0.5">
          <p className={gap.verdict === 'suspect' ? 'text-foreground' : 'text-muted-foreground'}>
            <span className="tabular-nums">{gapLabel(gap)}</span>
            {gap.verdict === 'excerpt' ? ' 없음(실리지 않은 것으로 보임)' : ' 없음'} — {gap.reason}
          </p>
          {gap.verdict === 'suspect' && onReparse && sourceFile && (
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
                  missing: gapNumbers(gap),
                  pages: g.pages,
                  // 덩어리의 쪽을 알면 그것만 보낸다. 모르면(앞뒤 잘림) 예전처럼 추정에 맡긴다
                  ...(gap.pageFrom !== undefined &&
                    gap.pageTo !== undefined && { pageHint: { from: gap.pageFrom, to: gap.pageTo } }),
                })
              }
              className="mb-1 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              🔁 {gap.pageFrom !== undefined ? `${gap.pageFrom}~${gap.pageTo}쪽` : '이 구간'} 다시 파싱
            </button>
          )}
        </div>
      ))}

      {unknown && (
        <p className="text-muted-foreground">
          → 페이지 기록이 없어 유실인지 발췌인지 가릴 수 없습니다. 이 문제집을 다시 파싱하면 페이지가 기록되어
          판정할 수 있습니다
        </p>
      )}
    </div>
  )
}
