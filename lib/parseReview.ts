import type { Question, Subject } from './types'
import { SUBJECT_UNITS, isValidUnit } from './units'

// 결번 목록이 길어지면 UI가 감당하지 못하므로 표시 개수를 제한한다
const MAX_MISSING_SHOWN = 20
// 번호가 하나뿐이면 연속성을 논할 수 없다
const MIN_COUNT_FOR_GAP_CHECK = 2
// 결번이 확인된 문항 수보다 많으면 "번호가 연속인 시험지"라는 전제가 흔들린다.
// (문제를 골라 담은 교재이거나, 정말로 대량 유실이거나 — 번호만으로는 구분할 수 없다)
// 예전에는 이때 검사를 통째로 건너뛰었는데, 그러면 많이 잃을수록 조용해지는 정반대 동작이 됐다.
// 이제는 건너뛰지 않고 '비연속 의심'이라는 다른 문구로 표시한다
const SPARSE_RATIO = 1
// 뒷부분이 잘렸는지는 번호만으로는 알 수 없다. 같은 과목·시험구분의 다른 회차가
// 이만큼 있으면 그 회차들의 마지막 번호를 기준으로 삼는다
const MIN_SIBLINGS_FOR_TAIL = 2

// 연도를 확인하지 못한 문제는 year가 0으로 저장된다 (gemini.ts의 resolveYear)
export const UNKNOWN_YEAR = 0
// 한 연도가 이 비율을 넘으면 "쏠림"으로 본다. 여러 회차 기출 모음이라면 파싱 오류 신호다
const YEAR_DOMINANT_RATIO = 0.7
// 변호사시험 제1회가 2012년. 그 이전 연도는 기출로 존재하지 않는다
const EARLIEST_YEAR = 2010

// 한 회차(과목·시험구분·연도)의 번호 연속성 점검 결과.
// 예전에는 "범위 안 결번"만 봤는데, 그러면 앞뒤가 통째로 잘린 경우를 전부 놓쳤다.
// 존재하는 번호에서 min/max를 뽑으니 잘린 쪽은 애초에 범위에 들어오지 않기 때문이다
export interface GroupCheck {
  subject: Subject
  examType: string
  year: number
  count: number
  min: number
  max: number
  nos: number[] // 실제로 확인된 번호 (오름차순) — 재파싱할 페이지를 추정할 때 쓴다
  sourceFiles: string[] // 이 회차의 문제가 들어 있는 파일 (많이 나온 순)
  interior: number[] // min~max 사이에서 빠진 번호 (전체)
  headMissing: number // 1번부터 min-1번까지 몇 개가 없는지
  expectedMax: number | null // 형제 회차들로 추정한 마지막 번호
  tailMissing: number // expectedMax까지 몇 개가 없는지
  sparse: boolean // 결번이 확인된 문항 수보다 많음
  ok: boolean
}

export interface UnitCount {
  subject: Subject
  unit: string
  count: number
  valid: boolean // 해당 과목의 유효 단원 목록에 있는 값인지
  questions: Question[]
}

export interface YearCount {
  year: number // 0이면 연도 미상
  count: number
  ratio: number
  questions: Question[]
  problem: 'unknown' | 'future' | 'tooOld' | null
}

export interface ParseReview {
  total: number
  groups: GroupCheck[]
  // 연도를 모르면 어느 회차의 몇 번인지 알 수 없어 결번 검사에서 뺀 문항 수
  skippedUnknownYear: number
  units: UnitCount[]
  years: YearCount[]
  yearDominant: YearCount | null // 70% 이상을 차지하는 연도 (있을 때만)
  hasWarning: boolean
}

function roundKey(q: Question) {
  return `${q.subject}|${q.examType}|${q.year}`
}

// 하한(lower median). 형제가 둘이면 작은 쪽을 택해 과하게 경고하지 않는다
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function missingBetween(present: Set<number>, from: number, to: number): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n++) if (!present.has(n)) out.push(n)
  return out
}

// 저장된 문제들로부터 검토 결과를 만든다.
// 청크 겹침으로 생긴 중복은 addQuestions가 이미 병합했으므로 여기서 다시 다루지 않는다
export function buildParseReview(questions: Question[]): ParseReview {
  // ── A. 번호 연속성 ──
  // 연도 미상은 어느 회차인지 알 수 없다. 별도 그룹으로 두면 그 안에서만 연속인지 보게 되어
  // "1~25는 2023, 26~50은 미상"처럼 갈린 경우 양쪽 다 통과해버린다. 그래서 아예 검사에서 뺀다
  const skippedUnknownYear = questions.filter((q) => (q.year || UNKNOWN_YEAR) === UNKNOWN_YEAR).length

  const byRound = new Map<string, Question[]>()
  for (const q of questions) {
    if ((q.year || UNKNOWN_YEAR) === UNKNOWN_YEAR) continue
    const list = byRound.get(roundKey(q))
    if (list) list.push(q)
    else byRound.set(roundKey(q), [q])
  }

  // 회차별 번호 집합을 먼저 만든다 (형제 회차의 마지막 번호를 참조해야 하므로 2단계로 나눈다)
  const rounds = Array.from(byRound.values())
    .map((list) => {
      const nos = Array.from(
        new Set(list.map((q) => Number(q.no)).filter((n) => Number.isFinite(n) && n > 0))
      ).sort((a, b) => a - b)
      const head = list[0]
      // 재파싱은 파일 단위로 하므로 어느 파일에서 온 회차인지 알아야 한다.
      // 보통 하나지만 같은 회차를 여러 파일에 나눠 올렸을 수 있어 많이 나온 순으로 둔다
      const fileCount = new Map<string, number>()
      for (const q of list) {
        if (!q.sourceFile) continue
        fileCount.set(q.sourceFile, (fileCount.get(q.sourceFile) ?? 0) + 1)
      }
      const sourceFiles = Array.from(fileCount.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)
      return { subject: head.subject, examType: head.examType, year: head.year, nos, sourceFiles }
    })
    .filter((r) => r.nos.length >= MIN_COUNT_FOR_GAP_CHECK)

  const groups: GroupCheck[] = rounds.map((r) => {
    const min = r.nos[0]
    const max = r.nos[r.nos.length - 1]
    const present = new Set(r.nos)
    const interior = missingBetween(present, min, max)

    // 뒷부분 잘림은 같은 과목·시험구분의 다른 회차와 견줘야만 보인다.
    // 회차가 하나뿐인 파일에서는 판단 근거가 없어 검사하지 않는다 (UI에서 그 사실을 밝힌다)
    const siblingMaxes = rounds
      .filter((o) => o.subject === r.subject && o.examType === r.examType && o.year !== r.year)
      .map((o) => o.nos[o.nos.length - 1])
    const expectedMax = siblingMaxes.length >= MIN_SIBLINGS_FOR_TAIL ? lowerMedian(siblingMaxes) : null

    const headMissing = min - 1
    const tailMissing = expectedMax !== null && expectedMax > max ? expectedMax - max : 0

    return {
      subject: r.subject,
      examType: r.examType,
      year: r.year,
      count: r.nos.length,
      min,
      max,
      nos: r.nos,
      sourceFiles: r.sourceFiles,
      interior,
      headMissing,
      expectedMax,
      tailMissing,
      sparse: interior.length > r.nos.length * SPARSE_RATIO,
      ok: interior.length === 0 && headMissing === 0 && tailMissing === 0,
    }
  })
  groups.sort((a, b) => a.year - b.year || a.subject.localeCompare(b.subject, 'ko'))

  // ── B. 단원 분포. 과목이 섞여 있을 수 있으므로 과목+단원으로 묶는다 ──
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

  // ── 연도 분포 ──
  const thisYear = new Date().getFullYear()
  const byYear = new Map<number, YearCount>()
  for (const q of questions) {
    const year = Number.isFinite(q.year) ? q.year : UNKNOWN_YEAR
    const row = byYear.get(year)
    if (row) {
      row.count++
      row.questions.push(q)
    } else {
      byYear.set(year, {
        year,
        count: 1,
        ratio: 0,
        questions: [q],
        problem:
          year === UNKNOWN_YEAR ? 'unknown' : year > thisYear ? 'future' : year < EARLIEST_YEAR ? 'tooOld' : null,
      })
    }
  }
  const years = Array.from(byYear.values()).sort((a, b) => b.year - a.year)
  for (const row of years) row.ratio = questions.length > 0 ? row.count / questions.length : 0
  // 미상은 "쏠림" 판정에서 제외한다. 그건 별도 문제로 이미 표시된다
  const yearDominant =
    years.find((y) => y.year !== UNKNOWN_YEAR && y.ratio >= YEAR_DOMINANT_RATIO) ?? null

  return {
    total: questions.length,
    groups,
    skippedUnknownYear,
    units,
    years,
    yearDominant,
    hasWarning:
      groups.some((g) => !g.ok) ||
      skippedUnknownYear > 0 ||
      units.some((u) => !u.valid) ||
      years.some((y) => y.problem !== null) ||
      yearDominant !== null,
  }
}

// 앞·중간·뒤에서 빠진 번호를 한 줄로 모은다. 재파싱 대상 구간을 잡을 때 쓴다
export function allMissing(g: GroupCheck): number[] {
  const head = Array.from({ length: g.headMissing }, (_, i) => i + 1)
  const tail =
    g.tailMissing > 0 && g.expectedMax !== null
      ? Array.from({ length: g.tailMissing }, (_, i) => g.max + 1 + i)
      : []
  return [...head, ...g.interior, ...tail]
}

// 결번 목록을 화면에 넣을 문자열로. 너무 길면 뒤를 접는다
export function formatMissing(missing: number[]): string {
  const shown = missing.slice(0, MAX_MISSING_SHOWN).join(', ')
  return missing.length > MAX_MISSING_SHOWN
    ? `${shown} 외 ${missing.length - MAX_MISSING_SHOWN}개`
    : shown
}

// 연도 수정 드롭다운에 넣을 후보. 최신 연도가 위로 오게 한다
export function yearOptions(): number[] {
  const thisYear = new Date().getFullYear()
  const out: number[] = []
  for (let y = thisYear; y >= EARLIEST_YEAR; y--) out.push(y)
  return out
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
