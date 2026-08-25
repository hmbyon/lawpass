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

// 한 문제가 확인된 원본 PDF 구간. Question.pageFrom/pageTo를 번호별로 모은 것
export interface QuestionPage {
  no: number
  from: number
  to: number
}

// 한 '번호 런'의 연속성 점검 결과.
//
// 예전에는 과목·시험구분·연도(= 회차)로 묶었다. 회차별 기출 문제집에서는 그게 맞았지만
// 단원별 문제집에서는 무너진다. 한 단원 안에 여러 해의 문제가 1번부터 다시 번호를 달고
// 섞여 들어오기 때문에, 연도로 묶으면 번호가 뒤엉켜 있지도 않은 결번이 무더기로 뜬다.
//
// 그래서 이제는 연도를 묶는 기준에서 뺐다. 파일 안에서 페이지 순으로 세운 뒤,
// 번호가 뒤로 돌아가는 자리에서 자른다. 그 한 토막이 런이고, 회차별 문제집에서는
// 런이 곧 회차가 되므로 기존 동작이 그대로 유지된다.
//
// 결번은 "범위 안 결번"만 보지 않는다. 존재하는 번호에서 min/max를 뽑으면 앞뒤가
// 통째로 잘린 경우는 애초에 범위에 들어오지 않아 조용히 넘어가기 때문이다
export interface GroupCheck {
  runId: string // 런의 고유 식별자 (화면 key·재파싱 대상 구분용)
  runIndex: number // 이 파일·과목·시험구분 안에서 몇 번째 런인지 (0부터)
  subject: Subject
  examType: string
  // 이 런에서 가장 많이 나온 연도. **표시용일 뿐 묶는 기준이 아니다.**
  // 단원별 문제집처럼 한 런에 여러 해가 섞이면 yearMixed가 참이 된다
  year: number
  yearMixed: boolean // 런 안에 연도가 둘 이상
  count: number
  min: number
  max: number
  nos: number[] // 실제로 확인된 번호 (오름차순) — 재파싱할 페이지를 추정할 때 쓴다
  // 페이지를 아는 문제만 번호순으로. 페이지 기록 도입 이전에 파싱된 문제집은 비어 있다
  pages: QuestionPage[]
  pageFrom: number | null // 이 런에서 확인된 가장 이른 쪽
  pageTo: number | null // 가장 늦은 쪽
  sourceFile: string | null // 이 런이 나온 파일. 런은 정의상 한 파일에서만 나온다
  interior: number[] // min~max 사이에서 빠진 번호 (전체)
  headMissing: number // 1번부터 min-1번까지 몇 개가 없는지
  expectedMax: number | null // 형제 런들로 추정한 마지막 번호
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

// 파일명이 없는 문제들끼리는 한 덩어리로 본다. 파일을 모른다는 것 자체가 하나의 출처다
const NO_SOURCE_FILE = '(파일 미상)'

// 런을 나누는 첫 단계. 연도는 들어가지 않는다 — 그게 이번 변경의 핵심이다
function bucketKey(q: Question) {
  return `${q.sourceFile ?? NO_SOURCE_FILE}|${q.subject}|${q.examType}`
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

// 순서를 정하는 데 필요한 것만 요구한다. 덕분에 Question을 짓지 않고도 시험할 수 있다
export interface PagedItem {
  pageFrom?: number
  pageTo?: number
}

/**
 * 번호 런을 자르기 전에, 문제들을 '원본 PDF에서 놓여 있던 순서'로 세운다.
 *
 * 기준은 파싱 때 기록된 페이지다. 그런데 페이지를 모르는 문제가 섞일 수 있다 —
 * 페이지 기록 도입 이전에 파싱된 문제집이거나, 페이지를 알 수 없는 경로로 들어온 경우다.
 * 그런 문제를 맨 뒤로 밀거나 맨 앞에 세우면 없던 번호 역행이 생겨 런이 엉뚱하게 잘린다.
 *
 * 그래서 페이지가 없는 문제는 **저장 배열 순서상 바로 앞 문제의 페이지를 물려받는다.**
 * 저장 배열 순서는 addQuestions가 파싱한 순서 그대로 밀어 넣은 것이라, 페이지 기록이
 * 없던 시절에도 사실상 원본 순서다. 규칙 하나로 세 경우가 다 풀린다.
 *   - 전부 페이지 있음 → 순수 페이지 순
 *   - 전부 페이지 없음 → 물려받을 값이 모두 같아져 저장 배열 순서 그대로 (옛 데이터 폴백)
 *   - 섞임            → 아는 것끼리는 페이지 순, 모르는 것은 직전 문제 바로 뒤
 *
 * 물려받을 때 pageFrom뿐 아니라 pageTo까지 함께 가져간다. from만 물려받으면
 * 10~15쪽 청크 다음에 온 '페이지 모르는 문제'가 (10,10)이 되어 정작 그 청크(10,15)보다
 * 앞서는 뒤집힘이 생긴다.
 *
 * 원본 배열은 건드리지 않고 새 배열을 돌려준다.
 */
export function orderForRuns<T extends PagedItem>(list: T[]): T[] {
  // 저장 순서대로 훑으며 '지금까지 확인된 마지막 페이지'를 흘려보낸다
  let carriedFrom = 0
  let carriedTo = 0
  const keyed = list.map((item, index) => {
    if (item.pageFrom !== undefined) {
      carriedFrom = item.pageFrom
      carriedTo = item.pageTo ?? item.pageFrom
    }
    return { item, index, from: carriedFrom, to: carriedTo }
  })

  // index를 마지막 기준으로 두어, 같은 페이지 안에서는 저장 순서가 그대로 유지된다
  keyed.sort((a, b) => a.from - b.from || a.to - b.to || a.index - b.index)
  return keyed.map((k) => k.item)
}

// 런 하나. GroupCheck를 만들기 전 단계 — 형제 런의 마지막 번호를 참조해야 해서 둘로 나눠 둔다
interface Run {
  runId: string
  runIndex: number
  sourceFile: string | null
  subject: Subject
  examType: string
  year: number
  yearMixed: boolean
  nos: number[]
  pages: QuestionPage[]
}

function makeRun(key: string, runIndex: number, list: Question[]): Run {
  const head = list[0]
  const nos = Array.from(new Set(list.map((q) => Number(q.no)))).sort((a, b) => a - b)

  // 번호별 페이지 구간. 같은 번호의 판본이 여럿이면 더 좁은 쪽을 택한다
  // (store.ts의 병합 규칙과 같은 원칙 — 좁을수록 정확한 정보다)
  const pageByNo = new Map<number, { from: number; to: number }>()
  for (const q of list) {
    const no = Number(q.no)
    if (q.pageFrom === undefined || q.pageTo === undefined) continue
    const prev = pageByNo.get(no)
    if (!prev || q.pageTo - q.pageFrom < prev.to - prev.from) {
      pageByNo.set(no, { from: q.pageFrom, to: q.pageTo })
    }
  }
  const pages: QuestionPage[] = Array.from(pageByNo.entries())
    .map(([no, p]) => ({ no, from: p.from, to: p.to }))
    .sort((a, b) => a.no - b.no)

  // 연도는 이제 묶는 기준이 아니라 이 런이 무엇인지 알려주는 이름표다
  const yearCount = new Map<number, number>()
  for (const q of list) {
    const y = Number.isFinite(q.year) ? q.year : UNKNOWN_YEAR
    if (y === UNKNOWN_YEAR) continue
    yearCount.set(y, (yearCount.get(y) ?? 0) + 1)
  }
  // 최빈 연도. 같은 수라면 이른 해를 택해 결과가 실행마다 흔들리지 않게 한다
  const year =
    Array.from(yearCount.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? UNKNOWN_YEAR

  return {
    runId: `${key}#${runIndex}`,
    runIndex,
    sourceFile: head.sourceFile ?? null,
    subject: head.subject,
    examType: head.examType,
    year,
    yearMixed: yearCount.size > 1,
    nos,
    pages,
  }
}

/**
 * 한 버킷(파일·과목·시험구분)을 원본 순서로 세운 뒤 번호 런으로 자른다.
 *
 * 자르는 자리는 오직 하나, **번호가 뒤로 돌아가는 지점**이다.
 * 번호가 앞으로 건너뛰는 것은 자르지 않는다 — 그게 바로 우리가 찾으려는 결번이기 때문이다.
 * 여기서 같이 잘라버리면 유실이 다시 조용해진다.
 */
function cutRuns(key: string, list: Question[]): Run[] {
  const runs: Run[] = []
  let current: Question[] = []
  let lastNo = 0

  const close = () => {
    if (current.length === 0) return
    runs.push(makeRun(key, runs.length, current))
    current = []
    lastNo = 0
  }

  for (const q of orderForRuns(list)) {
    const no = Number(q.no)
    // 번호를 못 읽은 문제는 런을 잇지도 자르지도 않는다. 연속성을 논할 근거가 없다
    if (!Number.isFinite(no) || no <= 0) continue
    // 같은 번호가 잇달아 나오면 같은 문제의 다른 판본으로 보고 흡수한다 (병합이 놓친 몫).
    // 여기서 자르면 낱개 런만 늘어난다
    if (no < lastNo) close()
    current.push(q)
    lastNo = no
  }
  close()
  return runs
}

// 저장된 문제들로부터 검토 결과를 만든다.
// 청크 겹침으로 생긴 중복은 addQuestions가 이미 병합했으므로 여기서 다시 다루지 않는다
export function buildParseReview(questions: Question[]): ParseReview {
  // ── A. 번호 연속성 ──
  // 연도 미상은 어느 회차인지 알 수 없다. 별도 그룹으로 두면 그 안에서만 연속인지 보게 되어
  // "1~25는 2023, 26~50은 미상"처럼 갈린 경우 양쪽 다 통과해버린다. 그래서 아예 검사에서 뺀다
  const skippedUnknownYear = questions.filter((q) => (q.year || UNKNOWN_YEAR) === UNKNOWN_YEAR).length

  // 파일·과목·시험구분으로 먼저 나눈다. 이때 저장 배열 순서를 그대로 유지해야
  // orderForRuns의 옛 데이터 폴백이 근거를 잃지 않는다
  const byBucket = new Map<string, Question[]>()
  for (const q of questions) {
    if ((q.year || UNKNOWN_YEAR) === UNKNOWN_YEAR) continue
    const key = bucketKey(q)
    const list = byBucket.get(key)
    if (list) list.push(q)
    else byBucket.set(key, [q])
  }

  // 런 목록을 먼저 만든다 (형제 런의 마지막 번호를 참조해야 하므로 2단계로 나눈다).
  // 번호가 하나뿐인 런은 연속성을 논할 수 없어 뺀다
  const runs = Array.from(byBucket.entries())
    .flatMap(([key, list]) => cutRuns(key, list))
    .filter((r) => r.nos.length >= MIN_COUNT_FOR_GAP_CHECK)

  const groups: GroupCheck[] = runs.map((r) => {
    const min = r.nos[0]
    const max = r.nos[r.nos.length - 1]
    const present = new Set(r.nos)
    const interior = missingBetween(present, min, max)

    // 뒷부분 잘림은 같은 과목·시험구분의 다른 런과 견줘야만 보인다.
    // 견줄 런이 없는 파일에서는 판단 근거가 없어 검사하지 않는다 (UI에서 그 사실을 밝힌다)
    const siblingMaxes = runs
      .filter((o) => o.subject === r.subject && o.examType === r.examType && o.year !== r.year)
      .map((o) => o.nos[o.nos.length - 1])
    const expectedMax = siblingMaxes.length >= MIN_SIBLINGS_FOR_TAIL ? lowerMedian(siblingMaxes) : null

    const headMissing = min - 1
    const tailMissing = expectedMax !== null && expectedMax > max ? expectedMax - max : 0

    return {
      runId: r.runId,
      runIndex: r.runIndex,
      subject: r.subject,
      examType: r.examType,
      year: r.year,
      yearMixed: r.yearMixed,
      count: r.nos.length,
      min,
      max,
      nos: r.nos,
      sourceFile: r.sourceFile,
      pages: r.pages,
      pageFrom: r.pages.length > 0 ? Math.min(...r.pages.map((p) => p.from)) : null,
      pageTo: r.pages.length > 0 ? Math.max(...r.pages.map((p) => p.to)) : null,
      interior,
      headMissing,
      expectedMax,
      tailMissing,
      sparse: interior.length > r.nos.length * SPARSE_RATIO,
      ok: interior.length === 0 && headMissing === 0 && tailMissing === 0,
    }
  })
  // 화면에서는 원본을 넘길 때와 같은 순서로 읽히는 게 낫다.
  // runIndex가 이미 그 순서다 — 런은 페이지 순으로 세운 뒤 잘랐기 때문이다.
  // 여기서 pageFrom으로 다시 정렬하면 안 된다. 페이지를 아는 런만 앞으로 튀어나와,
  // 일부만 다시 파싱한 문제집에서 순서가 뒤엉킨다
  groups.sort(
    (a, b) =>
      (a.sourceFile ?? NO_SOURCE_FILE).localeCompare(b.sourceFile ?? NO_SOURCE_FILE, 'ko') ||
      a.subject.localeCompare(b.subject, 'ko') ||
      a.examType.localeCompare(b.examType, 'ko') ||
      a.runIndex - b.runIndex
  )

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

// 빠진 번호가 있을 만한 페이지 구간을, 기록된 실제 페이지로 좁힌다.
//
// 결번의 앞뒤 이웃 문제가 몇 쪽에 있었는지 알면 빠진 문제는 반드시 그 사이에 있다.
// 이때는 추정이 아니라 확정이다 (exact = true).
//
// 회차의 앞이나 뒤가 통째로 빠진 경우에는 한쪽 이웃이 없다. 그쪽만 어림하는데,
// 기준은 문서 전체가 아니라 **이 회차 안의 페이지 밀도**다.
// (예전 estimatePageRange는 "이 회차 번호 중 몇 번째"를 "문서 전체의 몇 %"로 환산해
//  242쪽 문서에서 111쪽을 내놓았다. 회차가 문서 어디에 있는지 모르는 채 계산했기 때문이다)
export function gapPageRange(
  pages: QuestionPage[],
  missing: number[],
  totalPages: number
): { from: number; to: number; exact: boolean } | null {
  if (pages.length === 0 || missing.length === 0 || totalPages <= 0) return null

  const first = Math.min(...missing)
  const last = Math.max(...missing)
  const prev = [...pages].reverse().find((p) => p.no < first)
  const next = pages.find((p) => p.no > last)

  const roundFrom = Math.min(...pages.map((p) => p.from))
  const roundTo = Math.max(...pages.map((p) => p.to))
  // 이 회차의 문제 하나가 차지하는 쪽수. 회차가 한 쪽에 여러 문제여도 최소 1쪽은 잡는다
  const perQuestion = Math.max(1, (roundTo - roundFrom + 1) / pages.length)

  // 이웃이 없는 쪽은 "몇 문제를 건너뛰어야 하는가"로 거리를 잰다.
  // 빠진 번호만 세면 안 된다 — 그 사이에 '파싱은 됐지만 페이지를 모르는' 문제가 있으면
  // 그만큼을 빠뜨려 범위가 짧아진다. 번호 거리로 재면 그 문제들도 자연히 포함된다
  const below = Math.max(0, pages[0].no - first)
  const above = Math.max(0, last - pages[pages.length - 1].no)

  const from = prev
    ? prev.from
    : Math.max(1, roundFrom - Math.ceil(below * perQuestion) - 1)
  const to = next
    ? next.to
    : Math.min(totalPages, roundTo + Math.ceil(above * perQuestion) + 1)

  return { from, to: Math.max(from, to), exact: Boolean(prev && next) }
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
