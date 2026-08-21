import type { Question, Subject } from './types'
import { SUBJECT_UNITS, isValidUnit } from './units'

// 결번 목록이 길어지면 UI가 감당하지 못하므로 표시 개수를 제한한다
const MAX_MISSING_SHOWN = 20
// 번호가 너무 적으면 연속성을 논할 수 없다 (한두 문제만 뽑아 넣은 파일 등)
const MIN_COUNT_FOR_GAP_CHECK = 3
// 결번이 실제 문항 수보다 많으면 "번호가 연속인 시험지"라는 전제 자체가 틀린 것이다.
// (문제집 여러 회차가 한 파일에 섞였거나 번호가 비연속인 교재) 이럴 땐 경고하지 않는다
const MAX_MISSING_RATIO = 1

export interface NumberGap {
  subject: Subject
  examType: string
  year: number
  min: number
  max: number
  count: number
  missing: number[] // MAX_MISSING_SHOWN개까지만
  missingTotal: number
}

export interface UnitCount {
  subject: Subject
  unit: string
  count: number
  valid: boolean // 해당 과목의 유효 단원 목록에 있는 값인지
  questions: Question[]
}

export interface ParseReview {
  total: number
  gaps: NumberGap[]
  units: UnitCount[]
  hasWarning: boolean
}

function groupKey(q: Question) {
  return `${q.subject}|${q.examType}|${q.year}`
}

// 저장된 문제들로부터 검토 결과를 만든다.
// 청크 겹침으로 생긴 중복은 addQuestions가 이미 병합했으므로 여기서 다시 다루지 않는다
export function buildParseReview(questions: Question[]): ParseReview {
  const gaps: NumberGap[] = []

  const byRound = new Map<string, Question[]>()
  for (const q of questions) {
    const list = byRound.get(groupKey(q))
    if (list) list.push(q)
    else byRound.set(groupKey(q), [q])
  }

  for (const list of byRound.values()) {
    const nos = Array.from(
      new Set(list.map((q) => Number(q.no)).filter((n) => Number.isFinite(n) && n > 0))
    ).sort((a, b) => a - b)
    if (nos.length < MIN_COUNT_FOR_GAP_CHECK) continue

    const min = nos[0]
    const max = nos[nos.length - 1]
    const present = new Set(nos)
    const missing: number[] = []
    for (let n = min; n <= max; n++) if (!present.has(n)) missing.push(n)
    if (missing.length === 0) continue
    if (missing.length > nos.length * MAX_MISSING_RATIO) continue

    const head = list[0]
    gaps.push({
      subject: head.subject,
      examType: head.examType,
      year: head.year,
      min,
      max,
      count: nos.length,
      missing: missing.slice(0, MAX_MISSING_SHOWN),
      missingTotal: missing.length,
    })
  }
  gaps.sort((a, b) => a.year - b.year || a.subject.localeCompare(b.subject, 'ko'))

  // 단원 분포. 과목이 섞여 있을 수 있으므로 과목+단원으로 묶는다
  const byUnit = new Map<string, UnitCount>()
  for (const q of questions) {
    const unit = q.unit?.trim() || '(단원 없음)'
    const key = `${q.subject}|${unit}`
    const row = byUnit.get(key)
    if (row) {
      row.count++
      row.questions.push(q)
    } else {
      byUnit.set(key, {
        subject: q.subject,
        unit,
        count: 1,
        valid: isValidUnit(q.subject, q.unit),
        questions: [q],
      })
    }
  }
  const units = Array.from(byUnit.values()).sort(
    (a, b) => b.count - a.count || a.unit.localeCompare(b.unit, 'ko')
  )

  return {
    total: questions.length,
    gaps,
    units,
    hasWarning: gaps.length > 0 || units.some((u) => !u.valid),
  }
}

// 특정 단원이 "소수라 의심스러운지". 전체의 20% 미만이면서 최다 단원이 따로 있을 때만 표시한다.
// 고르게 섞인 파일에서 모든 단원에 경고가 붙는 것을 막는다
export function isMinorUnit(row: UnitCount, review: ParseReview): boolean {
  if (review.units.length < 2) return false
  const top = review.units[0].count
  return row.count < top && row.count / review.total < 0.2
}

export function unitOptionsFor(subject: Subject): string[] {
  return SUBJECT_UNITS[subject] ?? []
}
