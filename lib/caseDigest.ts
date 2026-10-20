import type { CaseRef, ExamType, ExplanationBlock, Question, Subject } from './types'
import { SUBJECT_UNITS } from './units'
import { examMonthOf, examMonthLabel, type ExamMonthLabel, type SourceBucket } from './questionSource'
import type { CaseIndex, CaseSubject, IndexProblem } from './caseStudy/types'
import { problemLabel } from './caseStudy/group'

/**
 * 해설에 인용된 판례를 판례 단위로 모은다.
 *
 * 문제는 판례를 여러 개 인용하고, 같은 판례가 여러 문제에 나온다. 그 관계를 뒤집어
 * "이 판례가 몇 문제에 나왔나"로 세우는 것이 이 모듈의 일이다.
 */

/**
 * 기간 옵션. quiz-filter 의 "최근 N개년"과 같은 뜻이다 — 올해를 포함해 N개 연도다
 * (거기서 yearOptions.slice(0, n) 으로 고르는 것과 맞춘다). null 은 '전체'
 */
export const PERIOD_OPTIONS: (number | null)[] = [1, 3, 5, null]

export function periodLabel(years: number | null): string {
  return years === null ? '전체' : `최근 ${years}개년`
}

/** 그 기간에 드는가. 선고일을 모르는 판례(year === null)는 여기서 가리지 않는다 */
export function inPeriod(year: number | null, years: number | null, now: Date): boolean {
  if (years === null || year === null) return true
  return year >= now.getFullYear() - (years - 1)
}

/**
 * 사건번호를 묶음 키로 바꾼다.
 *
 * 같은 판례라도 표기가 갈린다 — "2014다12345", "2014 다 12345", "2014다12345 판결",
 * 앞에 법원이나 선고일이 붙어 오기도 한다. 그대로 키로 쓰면 같은 판례가 여러 줄로 흩어진다.
 *
 * 사건번호의 뼈대는 '연도 + 사건부호 + 일련번호'다(2014다12345, 2019헌바13).
 * 그 세 토막을 뽑아 붙이는 것이 가장 확실하다. 뽑히지 않으면(형식이 다른 표기) 공백만
 * 지우고 그대로 쓴다 — 못 알아본 것을 억지로 합치면 다른 판례가 한 줄로 뭉친다.
 *
 * 지문 정규화(passageMatch.ts)와 달리 여기서는 글자를 지운다. 사건번호는 자연어가 아니라
 * 정해진 형식이라, 뼈대만 같으면 같은 판례로 봐도 안전하다
 *
 * 연도는 2자리도 받는다. 1990년대 이전 판례는 "95다8713", "62다801"처럼 적힌다 —
 * 4자리만 보면 이것들은 공백만 지운 원문이 키가 되어, "대법원 95다8713"·"95다8713 판결"이
 * 서로 다른 판례로 갈라진다. 2자리 연도는 키에서 4자리로 올린다(아래 fullYear).
 *
 * 연도 앞이 숫자면 연도로 보지 않는다 — "2016다…"의 "16"이나 "123다…"의 "23"을 집지
 * 않으려는 것이다. 빌드 타깃(ES6)이 정규식 lookbehind를 못 써서 앞 글자를 첫 그룹으로 잡는다
 */
const CASE_NUMBER = /(^|\D)(\d{4}|\d{2})\s*([가-힣]{1,4})\s*(\d+)/

/**
 * 2자리 연도를 4자리로: 00~29 → 20xx, 30~99 → 19xx.
 *
 * 대법원은 2000년부터 사건번호에 4자리 연도를 쓰므로, 2자리로 적힌 것은 사실상 전부 19xx다.
 * 00~29를 20xx로 두는 것은 "16다12345"처럼 줄여 적은 최근 판례를 "2016다12345"와 맞추려는
 * 것이다. 실제 데이터(선택형 판례 5,757건·사례형 495건)의 2자리 연도는 62~99뿐이라
 * 경계(29/30)에 걸리는 표기는 없다 — scripts/check-case-normalize.ts 에 경계를 고정해 둔다
 */
function fullYear(year: string): string {
  if (year.length === 4) return year
  const n = Number(year)
  return String(n <= 29 ? 2000 + n : 1900 + n)
}

function caseKey(m: RegExpExecArray): string {
  return `${fullYear(m[2])}${m[3]}${m[4]}`
}

export function normalizeCaseNumber(caseNumber: string): string {
  const m = CASE_NUMBER.exec(caseNumber ?? '')
  if (m) return caseKey(m)
  return (caseNumber ?? '').replace(/\s+/g, '')
}

/** 선고일 문자열에서 연도만 뽑는다 ("2015. 3. 12." → 2015). 못 읽으면 null */
export function decidedYear(decidedDate: string | undefined): number | null {
  const m = /(\d{4})/.exec(decidedDate ?? '')
  if (!m) return null
  const year = Number(m[1])
  return year >= 1900 && year <= 2100 ? year : null
}

export interface CaseGroup {
  key: string // 정규화한 사건번호
  caseNumber: string // 화면에 보여줄 표기 (가장 먼저 만난 것)
  decidedDate?: string
  court?: string
  summary: string // 대표 요지. 문제마다 조금씩 다르게 요약될 수 있어 가장 긴 것을 쓴다
  otherSummaries: number // 대표와 다른 요지가 몇 개 더 있는지
  year: number | null
  questions: Question[] // 이 판례를 인용한 문제들
  count: number
  // 한 판례가 여러 과목·단원에 걸쳐 인용될 수 있다. 인용한 문제들의 과목·단원을 모아 둔다
  subjects: Subject[]
  units: string[]
  // ── 통합 판례 DB (선택형 + 사례형) ──
  // 위 필드(questions·count·subjects·units·요지·선고일)는 전부 **선택형 값**이다 — 기존 화면이
  // 그대로 돌게 하려는 것이다. 사례형까지 합친 정보는 아래 셋에만 있다
  sources: CaseSource[] // 이 판례를 인용한 곳 전부 (선택형 문제 + 사례형 문항)
  counts: { objective: number; caseStudy: number; total: number } // total 은 정렬용 합계
  hasSummary: boolean // 요지가 있는가. 사례형에만 나온 판례는 요지가 없다(문구는 화면이 정한다)
}

/**
 * 판례를 인용한 출처 하나.
 *
 * objective — 선택형 문제. 이동·표시에 필요한 값은 question 에 다 있다(과목·시험종류·연도·번호)
 * caseStudy — 사례형 문항. 색인(_index.json v1.1)의 '문항 단위 cases' 에서 온다.
 *   problemLabel 은 사례형 목록의 문항 라벨과 같은 규칙(lib/caseStudy/group.ts problemLabel)이고,
 *   year 는 **시험 연도**다(변시 N회 → 2011+N, 모의 '24.6' → 2024). 판례 선고연도가 아니다
 */
export type CaseSource =
  | {
      kind: 'objective'
      questionId: string
      question: Question
      subject: Subject
      examType: ExamType
      year: number
      label: string // "12번"
    }
  | {
      kind: 'caseStudy'
      cardId: string
      problemId: string
      cardTitle: string
      problemLabel: string // "변시 11회 제2문의 1 문1", "모의 24.6 제2문의 2 문1"
      subject: CaseSubject
      examType: IndexProblem['kind'] // '변시' | '모의'
      exam: IndexProblem['exam'] // 회차 원값 (변시 11, 모의 '24.6') — 모의 회차(월) 필터용
      qno: string // '제2문의 1' — 판례 화면의 문항 버튼 라벨용
      sub: string // '문2' 또는 ''
      year: number | null
    }

// 사례형 문항의 시험 연도. 판례 선고연도로 쓰지 않는다
function caseStudyExamYear(p: IndexProblem): number | null {
  if (p.kind === '변시') {
    const round = Number(p.exam)
    return round > 0 ? 2011 + round : null
  }
  const yy = Number(String(p.exam).split('.')[0])
  return yy > 0 ? 2000 + yy : null
}

export interface CaseDigest {
  // 모은 판례 전부. 기간·과목·단원으로 좁히는 일은 화면이 한다 —
  // 여기서 미리 갈라 두면 필터 조합이 늘 때마다 목록을 하나씩 더 만들어야 한다
  groups: CaseGroup[]
  totalGroups: number
  questionsWithCases: number // 판례가 하나라도 달린 문제 수
}

function pick(list: string[]): { summary: string; otherSummaries: number } {
  const uniq = Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)))
  if (uniq.length === 0) return { summary: '', otherSummaries: 0 }
  // 가장 긴 요약을 대표로 둔다. 짧은 쪽은 대개 앞부분만 적힌 것이다
  const longest = uniq.reduce((best, s) => (s.length > best.length ? s : best), uniq[0])
  return { summary: longest, otherSummaries: uniq.length - 1 }
}

// now 는 예전부터 쓰이지 않던 인자다. 호출부를 깨지 않으려고 시그니처만 남겨 둔다
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildCaseDigest(questions: Question[], now: Date = new Date()): CaseDigest {
  return buildUnifiedCaseDigest(questions)
}

/**
 * 선택형 문제와 사례형 색인을 합쳐 판례 단위로 모은다. 같은 key(normalizeCaseNumber)면 한 판례다.
 *
 * caseIndex 가 없거나 비어 있으면 buildCaseDigest 와 같은 결과다 — 선택형 그룹을 먼저 만들고
 * 사례형은 그 뒤에 얹기만 하므로, 선택형 그룹의 순서와 기존 필드 값은 사례형이 있어도 그대로다.
 *
 * 사례형은 **문항 단위 cases** 만 쓴다. 카드 단위 cases 는 문항들의 합이라 같이 세면 두 번 센다.
 * stub 문항(답안이 다른 카드에 있음)은 건너뛴다 — 그 판례는 답안이 있는 문항이 이미 센다.
 *
 * 사례형에만 나온 판례(선택형에 같은 key 가 없는 것)의 처리:
 *  - 선고일·법원이 없다. 사건번호 연도로 선고연도를 짐작하지 않는다 → year = null.
 *    그래서 화면에서는 기존 '선고일 미상' 묶음에 들어가고, 선고 기간 필터(inPeriod 는
 *    year === null 을 거르지 않는다)에 걸리지 않고 늘 보인다.
 *  - 요지가 없다 → summary = '', hasSummary = false.
 *  - 선택형 필드(questions·count·subjects·units)는 비어 있다(0). 출제 횟수는 counts 에 있다
 */
export function buildUnifiedCaseDigest(questions: Question[], caseIndex?: CaseIndex | null): CaseDigest {
  const groups = new Map<string, { refs: CaseRef[]; questions: Question[]; sources: CaseSource[]; firstRaw: string; caseStudy: number }>()
  let questionsWithCases = 0

  for (const q of questions) {
    if (!q.cases?.length) continue
    questionsWithCases++
    // 한 문제가 같은 판례를 두 번 인용해도 출제횟수는 1이다
    const seen = new Set<string>()
    for (const c of q.cases) {
      const key = normalizeCaseNumber(c.caseNumber)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const source: CaseSource = {
        kind: 'objective', questionId: q.id, question: q, subject: q.subject, examType: q.examType, year: q.year, label: `${q.no}번`,
      }
      const found = groups.get(key)
      if (found) {
        found.refs.push(c)
        found.questions.push(q)
        found.sources.push(source)
      } else {
        groups.set(key, { refs: [c], questions: [q], sources: [source], firstRaw: c.caseNumber, caseStudy: 0 })
      }
    }
  }

  for (const card of caseIndex?.cards ?? []) {
    for (const p of card.problems ?? []) {
      if (p.stubFor || !p.cases?.length) continue
      // 한 문항이 같은 판례를 두 번 인용해도 1건이다 (선택형과 같은 원칙)
      const seen = new Set<string>()
      for (const raw of p.cases) {
        const key = normalizeCaseNumber(raw)
        if (!key || seen.has(key)) continue
        seen.add(key)
        const source: CaseSource = {
          kind: 'caseStudy', cardId: card.id, problemId: p.id, cardTitle: card.title, problemLabel: problemLabel(p),
          subject: card.subject, examType: p.kind, exam: p.exam, qno: p.qno, sub: p.sub ?? '', year: caseStudyExamYear(p),
        }
        const found = groups.get(key)
        if (found) {
          found.sources.push(source)
          found.caseStudy++
        } else {
          groups.set(key, { refs: [], questions: [], sources: [source], firstRaw: raw, caseStudy: 1 })
        }
      }
    }
  }

  const all: CaseGroup[] = Array.from(groups.entries()).map(([key, g]) => {
    const { summary, otherSummaries } = pick(g.refs.map((r) => r.summary))
    // 선고일·법원은 비어 있는 사본이 섞이므로, 적혀 있는 것 중 첫 번째를 쓴다
    const decidedDate = g.refs.find((r) => r.decidedDate?.trim())?.decidedDate
    const objective = g.questions.length
    return {
      key,
      // 선택형 표기가 있으면 그것(기존과 같다), 사례형에만 있으면 처음 만난 사례형 표기
      caseNumber: g.refs[0]?.caseNumber ?? g.firstRaw,
      decidedDate,
      court: g.refs.find((r) => r.court?.trim())?.court,
      summary,
      otherSummaries,
      year: decidedYear(decidedDate),
      questions: g.questions,
      count: g.questions.length,
      subjects: Array.from(new Set(g.questions.map((q) => q.subject))),
      units: Array.from(new Set(g.questions.map((q) => q.unit?.trim()).filter((u): u is string => !!u))),
      sources: g.sources,
      counts: { objective, caseStudy: g.caseStudy, total: objective + g.caseStudy },
      hasSummary: summary !== '',
    }
  })

  return { groups: all, totalGroups: all.length, questionsWithCases }
}

export type CaseSort = 'count' | 'date'

/**
 * 판례 화면의 출처 칩. 'objective' 는 기존 선택형 화면과 같다 — 기준이 counts.objective(= count)라
 * 숫자도 정렬도 예전 그대로다. 'all' 은 선택형·사례형 합(counts.total)
 */
export type CaseOrigin = 'all' | 'objective' | 'caseStudy'

/** 그 칩에서의 출제 횟수 */
export function originCount(g: CaseGroup, origin: CaseOrigin): number {
  return origin === 'all' ? g.counts.total : origin === 'objective' ? g.counts.objective : g.counts.caseStudy
}

/** 그 칩에 드는 판례인가 (그 출처에서 한 번이라도 인용됐나) */
export function inOrigin(g: CaseGroup, origin: CaseOrigin): boolean {
  return originCount(g, origin) > 0
}

type Metric = (g: CaseGroup) => number
const countMetric: Metric = (g) => g.count

/** 많이 나온 판례가 먼저. 같으면 최신 선고일, 그다음 사건번호로 순서를 고정한다 */
const byCountOf = (n: Metric) => (a: CaseGroup, b: CaseGroup) =>
  n(b) - n(a) || (b.year ?? 0) - (a.year ?? 0) || a.key.localeCompare(b.key)
const byCount = byCountOf(countMetric)

/**
 * 최신 선고일이 먼저. 선고일을 모르는 판례는 맨 뒤로 민다 —
 * 0으로 쳐서 섞으면 "언제 것인지 모르는 판례"가 가장 오래된 판례인 척 자리를 차지한다
 */
const byDateOf = (n: Metric) => {
  const cnt = byCountOf(n)
  return (a: CaseGroup, b: CaseGroup) => {
    if (a.year === null || b.year === null) {
      if (a.year === b.year) return cnt(a, b)
      return a.year === null ? 1 : -1
    }
    return b.year - a.year || n(b) - n(a) || a.key.localeCompare(b.key)
  }
}
const byDate = byDateOf(countMetric)

/**
 * origin 을 주면 출제 횟수를 그 칩 기준(originCount)으로 센다. 안 주면 예전과 같이 count(선택형)
 */
export function sortCases(groups: CaseGroup[], sort: CaseSort, origin?: CaseOrigin): CaseGroup[] {
  if (!origin) return [...groups].sort(sort === 'date' ? byDate : byCount)
  const n: Metric = (g) => originCount(g, origin)
  return [...groups].sort(sort === 'date' ? byDateOf(n) : byCountOf(n))
}

/**
 * 고른 단원 중 그 과목의 것만 추린다.
 *
 * 단원 선택은 과목마다 따로 읽어야 한다. 한 줄로 뭉쳐 보면 형법 단원 하나를 고른 순간
 * 그 목록에 없는 민법 판례까지 사라진다 — 민법은 아무것도 고르지 않았는데도.
 * 화면도 과목마다 칩을 끊어 보여주므로, 판정이 과목별이어야 보이는 것과 결과가 같다.
 *
 * 빈 배열 = 그 과목은 단원 제한이 없다(= 그 과목 전체). 커리큘럼에 없는 값은 화면에서
 * 고를 수 없으므로 여기서 걸러진다.
 *
 * 이름이 같은 단원이 두 과목에 있으면(민사소송법·형사소송법의 '증거'·'상소') 둘 다
 * 걸린다. 선택 상태가 단원 이름의 목록이라 어느 과목에서 눌렀는지가 남지 않는다 —
 * 다만 칩도 두 과목에서 함께 보라로 켜지므로 화면과 결과는 여전히 어긋나지 않는다
 */
export function selectedUnitsOf(subject: Subject, units: string[]): string[] {
  if (units.length === 0) return []
  return (SUBJECT_UNITS[subject] ?? []).filter((u) => units.includes(u))
}

/**
 * 한 과목 줄에서 온 단원 선택을 다른 과목의 선택과 합친다.
 *
 * 칩은 과목마다 따로 그려지고, 그 줄은 자기 칩만 안다 — 전체 포함 상태에서 하나를 누르면
 * [누른 것] 하나만 돌려준다. 그대로 받으면 다른 과목에서 골라 둔 단원이 함께 지워진다.
 * 그 과목 몫만 갈아끼우고 나머지는 그대로 둔다
 */
export function mergeUnitSelection(subject: Subject, current: string[], next: string[]): string[] {
  const mine = new Set(SUBJECT_UNITS[subject] ?? [])
  return [...current.filter((u) => !mine.has(u)), ...next.filter((u) => mine.has(u))]
}

/**
 * 화면에 세울 판례를 고른다. 세 조건은 서로 독립이다.
 *
 * 과목·단원은 **한 문제가 둘 다 만족**해야 한다. 따로 보면 "민법 문제에서도 인용됐고
 * 다른 과목의 물권법에서도 인용됐다"는 이유로 걸리는데, 그건 고른 조건과 다른 판례다.
 * 단, 단원 조건은 그 문제의 과목에서 고른 것만 본다 — 과목마다 독립이다.
 * 기간은 선고일을 아는 판례에만 걸린다 (모르는 것은 화면이 따로 모아 보여준다)
 */
// 사례형 과목 이름 → 선택형 과목 이름 (필터 칩은 선택형 이름으로 그려진다)
export const CASE_STUDY_SUBJECT: Record<CaseSubject, Subject> = { 민법: '민법', 민소: '민사소송법' }

/** 출제연도 라벨. 칩에 그대로 쓰는 문자열이라 필터와 화면이 같은 함수를 쓴다 (문제 풀기 화면의 연도 칩과 같은 표기) */
export function examYearLabel(year: number): string {
  return String(year)
}

export function filterCases(
  groups: CaseGroup[],
  opts: {
    years?: number | null
    subjects?: string[]
    units?: string[]
    examTypes?: ExamType[]
    examMonths?: ExamMonthLabel[]
    /** 출제연도 라벨("2025"). 변호사시험·모의고사에 똑같이 걸리고, 6/8/10모와 함께 걸면 "2025년 6모"로 좁혀진다 */
    examYears?: string[]
    now?: Date
    /** 출처 칩. 주면 그 출처에서 인용된 판례만 남기고, 과목 등 조건도 그 출처에서 판정한다. 안 주면 예전과 같다 */
    origin?: CaseOrigin
  }
): CaseGroup[] {
  const {
    years = null,
    subjects = [],
    units = [],
    examTypes = [],
    examMonths = [],
    examYears = [],
    now = new Date(),
    origin,
  } = opts
  // 과목별로 한 번만 추려 둔다. 문제마다 다시 계산하면 목록 전체를 훑는 일이 반복된다
  const chosen = new Map<string, string[]>()
  const unitsFor = (subject: Subject): string[] => {
    let got = chosen.get(subject)
    if (!got) {
      got = selectedUnitsOf(subject, units)
      chosen.set(subject, got)
    }
    return got
  }

  // 사례형 문항이 조건에 드는가. 과목·시험유형은 선택형 이름으로 옮겨 견준다.
  // 사례형에는 단원이 없다 — 그 과목의 단원을 골랐으면 사례형 출처는 빠진다
  const caseStudyMatches = (s: Extract<CaseSource, { kind: 'caseStudy' }>): boolean => {
    const subject = CASE_STUDY_SUBJECT[s.subject]
    if (subjects.length > 0 && !subjects.includes(subject)) return false
    if (unitsFor(subject).length > 0) return false
    const examType: ExamType = s.examType === '변시' ? '변호사시험' : '모의고사'
    if (examTypes.length > 0 && !examTypes.includes(examType)) return false
    if ((examTypes.length === 0 || examTypes.includes('모의고사')) && examMonths.length > 0 && s.examType === '모의') {
      const month = Number(String(s.exam).split('.')[1])
      // 월을 읽었으면 그 달 칩이 골라져 있어야 한다(1월 모의는 6/8/10모 칩 어디에도 들지 않는다)
      if (month && !(examMonths as string[]).includes(`${month}모`)) return false
    }
    if (examYears.length > 0 && s.year && !examYears.includes(examYearLabel(s.year))) return false
    return true
  }

  return groups.filter((g) => {
    if (origin && !inOrigin(g, origin)) return false
    if (!inPeriod(g.year, years, now)) return false
    if (subjects.length === 0 && units.length === 0 && examTypes.length === 0 && examYears.length === 0) return true
    if (origin && origin !== 'objective') {
      const cs = g.sources.some((s) => s.kind === 'caseStudy' && caseStudyMatches(s))
      if (cs) return true
      if (origin === 'caseStudy') return false
    }
    return g.questions.some((q) => {
      if (subjects.length > 0 && !subjects.includes(q.subject)) return false
      const only = unitsFor(q.subject)
      if (!(only.length === 0 || only.includes(q.unit?.trim() ?? ''))) return false
      if (examTypes.length > 0 && !examTypes.includes(q.examType)) return false
      // 회차(6/8/10모)는 '모의고사'가 범위 안에 있을 때만 의미가 있다 — 명시로 골랐을 때뿐
      // 아니라 시험유형을 아무것도 안 골라 전체가 암묵적으로 포함된 때(examTypes가 빈
      // 배열)도 '모의고사'가 범위 안이므로 같이 적용한다. 월을 못 읽은 문제는 (다른
      // 필터들의 '미상' 처리와 같은 원칙으로) 거르지 않는다
      if (
        (examTypes.length === 0 || examTypes.includes('모의고사')) &&
        examMonths.length > 0 &&
        q.examType === '모의고사'
      ) {
        const month = examMonthOf(q.sourceFile)
        if (month && !examMonths.includes(examMonthLabel(month))) return false
      }
      // 출제연도는 시험유형과 무관하게 같은 연도 칩 하나로 건다 (문제 풀기 화면과 같은 방식).
      // 연도를 못 읽은 문제(0)는 (다른 필터들의 '미상' 처리와 같은 원칙으로) 거르지 않는다
      if (examYears.length > 0 && q.year && !examYears.includes(examYearLabel(q.year))) return false
      return true
    })
  })
}



/**
 * 검색어 한 줄로 목록을 더 좁힌다.
 *
 * 기간·과목·단원 필터가 "어떤 판례들을 볼까"를 정하는 것이라면, 검색은 그 안에서 하나를
 * 집어내는 일이다. 그래서 필터와 AND로 겹쳐 걸고, 집계·정규화는 그대로 둔 채 결과만
 * 한 번 더 거른다.
 *
 * 찾는 자리는 셋 — 요지, 사건번호, 그 판례를 인용한 문제번호
 */
function squash(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toLowerCase()
}

export function matchesCaseQuery(g: CaseGroup, query: string): boolean {
  const q = squash(query)
  if (!q) return true
  // 한두 자리 숫자만 친 것은 문제번호로 본다. 사건번호는 늘 네 자리 연도로 시작하므로,
  // 이때까지 요지·사건번호를 부분일치로 훑으면 "9"가 2019다·제9조를 죄다 끌어온다
  const no = query.trim()
  if (/^\d{1,3}$/.test(no)) return g.questions.some((item) => String(item.no).trim() === no)
  // 띄어쓰기를 지우고 견준다. "2019 다 12345"로 저장된 것을 "2019다12345"라고 쳐도 찾힌다
  if (squash(g.summary).includes(q)) return true
  if (squash(g.caseNumber).includes(q)) return true
  // 사건번호는 뼈대(연도+부호+번호)만 남긴 것끼리도 견준다. 앞에 법원·선고일이 붙어
  // 저장된 표기를 번호만 쳐서 찾을 수 있어야 한다
  if (normalizeCaseNumber(g.caseNumber).includes(normalizeCaseNumber(query))) return true
  // 번호가 아닌 말이어도 문제번호와 정확히 같으면 친다 (부분일치는 두지 않는다)
  return g.questions.some((item) => String(item.no).trim() === no)
}

export function searchCases(groups: CaseGroup[], query: string): CaseGroup[] {
  if (!squash(query)) return groups
  return groups.filter((g) => matchesCaseQuery(g, query))
}

/** 해설 안에서 그 판례가 언급된 자리 */
export interface CaseMention {
  where: string // "해설", "③번 해설" 처럼 어디였는지
  text: string // 그 조각의 전문
}

function blockText(v: string | ExplanationBlock[] | undefined): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.map((b) => [b.title, b.content].filter(Boolean).join(' '))
  return []
}

/**
 * 이 문제의 해설 어디에서 그 판례가 인용됐는지 찾는다.
 *
 * 판례를 뽑을 때 어느 해설에서 왔는지는 저장하지 않는다(CaseRef 에 그 필드가 없다).
 * 대신 사건번호를 원문 표기 그대로 담게 해 두었으므로, 그 번호로 해설을 뒤지면 된다 —
 * 재파싱이 필요 없다.
 *
 * 비교는 정규화한 사건번호로 한다. 해설 본문의 "2014다12345"와 판례 항목의
 * "2014 다 12345"가 표기만 다른 같은 번호인 경우를 놓치지 않기 위해서다
 */
/**
 * 언급 조각을 사건번호 둘레만 잘라 낼 길이 기준.
 *
 * 해설이 문단으로 나뉘어 있으면 조각은 저절로 짧지만, 한 덩어리 문자열이면 조각이 곧
 * 해설 전문이 된다. 그러면 "이 판례가 언급된 부분"과 "해설 전체 보기"가 같은 글이 되어,
 * 토글을 눌러도 아무 일도 일어나지 않은 것처럼 보인다 — 두 블록은 분량으로 구분돼야 한다.
 *
 * 앞뒤 폭을 합치면 250자다. 기준을 그보다 넉넉히 잡아, 조금 긴 해설을 굳이 잘라
 * 몇 글자 아끼는 대신 문맥을 통째로 남긴다
 */
const EXCERPT_LIMIT = 320
const EXCERPT_BEFORE = 100
const EXCERPT_AFTER = 150

/** 문장 경계를 찾아 넘어갈 수 있는 폭. 이보다 멀면 그냥 그 자리에서 자르고 "…"를 붙인다 */
const EXCERPT_SLACK = 40
const SENTENCE_END = /[.。!?\n]/

/**
 * 항목 하나를 통째로 보여줄 수 있는 상한. 이보다 긴 항목은 그 안에서 다시 사건번호
 * 둘레만 자른다 — 조각 자리에 한 화면을 넘는 글을 쏟으면 카드 목록이 읽히지 않는다
 */
const ITEM_LIMIT = 600

/**
 * 항목 마커 — 한 해설에 여러 보기·선지 설명이 이어 붙었을 때 그 경계다.
 *
 * 해설은 흔히 "① (X) …  ② (O) …" 또는 "ㄱ. (O) …  ㄴ. (X) …"처럼 항목 설명을 한
 * 문자열에 죽 이어 붙인다. 그 경계를 모르면 사건번호 뒤 150자를 채우다가 상관없는
 * 다음 보기 설명까지 조각에 딸려 온다.
 *
 * 원문자만으로는 마커라고 볼 수 없다 — 해설이 인용하는 법조문의 항 번호도 원문자다
 * ("민법 제109조(착오로 인한 의사표시) ① 의사표시는 …"). 그래서 원문자는 뒤에 (O)·(X)가
 * 붙거나 줄머리에 선 것만 마커로 친다. 자음은 뒤의 마침표가 그 구실을 한다
 */
const ITEM_MARKER =
  /(?:^|\n)[ \t]*[①-⑮]|[\s(][①-⑮][ \t]*[(（][ \t]*[OXox○×][ \t]*[)）]|[\s(][ㄱ-ㅁ][ \t]*\./g

/** 매치 안에서 마커 글자가 선 자리. 앞의 공백·줄바꿈은 마커가 아니다 */
function markerIndex(m: RegExpExecArray): number {
  return m.index + m[0].search(/[①-⑮ㄱ-ㅁ]/)
}

/** 그 자리 앞에 있는 마지막 마커 = 지금 읽고 있는 항목이 시작된 자리 */
function lastMarkerBefore(text: string, before: number): number | null {
  ITEM_MARKER.lastIndex = 0
  let hit: number | null = null
  for (let m = ITEM_MARKER.exec(text); m; m = ITEM_MARKER.exec(text)) {
    const at = markerIndex(m)
    if (at >= before) break
    hit = at
  }
  return hit
}

/** 그 자리 뒤에 오는 첫 마커 = 다음 항목이 시작되는 자리 */
function firstMarkerAfter(text: string, from: number): number | null {
  ITEM_MARKER.lastIndex = 0
  for (let m = ITEM_MARKER.exec(text); m; m = ITEM_MARKER.exec(text)) {
    const at = markerIndex(m)
    if (at >= from) return at
  }
  return null
}

/**
 * 원문에서 그 사건번호가 적힌 자리. 없으면 null.
 *
 * 예전에는 normalizeCaseNumber(t)로 텍스트를 한 번 정규화해 key와 견줬는데, 그 함수는
 * 텍스트에서 **맨 앞 사건번호 하나만** 뽑아 돌려준다. 그래서 한 해설에 판례가 여럿
 * 인용되면 두 번째부터는 본문에 분명히 적혀 있어도 "못 찾음"이 됐다.
 *
 * 그러니 텍스트에 있는 사건번호를 **전부** 훑어 하나씩 정규화해 견준다. 자리를 정확히
 * 짚어야 발췌(excerptAround)도 그 판례 둘레를 자른다 — 첫 번째 번호 자리를 자르면
 * 다른 판례 이야기를 이 판례의 조각이라고 보여주게 된다
 */
const CASE_NUMBER_ALL = new RegExp(CASE_NUMBER.source, 'g')

function caseNumberAt(text: string, key: string): { at: number; len: number } | null {
  CASE_NUMBER_ALL.lastIndex = 0
  for (let m = CASE_NUMBER_ALL.exec(text); m; m = CASE_NUMBER_ALL.exec(text)) {
    // 첫 그룹은 연도 앞 글자다(정규식 설명 참고). 자리는 그 글자를 빼고 사건번호부터 잡는다
    if (caseKey(m) === key) return { at: m.index + m[1].length, len: m[0].length - m[1].length }
  }
  // 사건번호 형식이 아닌 표기(normalizeCaseNumber가 공백만 지워 돌려준 것)는 그 글자들을
  // 그대로 찾는다. 본문에서도 띄어 적힐 수 있어 글자 사이 공백을 허용한다
  const loose = key.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
  const m = new RegExp(loose).exec(text)
  return m ? { at: m.index, len: m[0].length } : null
}

/**
 * 문장이 여기서 끝나는가.
 *
 * 마침표를 그냥 세면 "(대판 2024.08.01. 2023다318857)"의 날짜에서 문장이 끊긴다. 앞이
 * 숫자인 마침표를 문장 끝으로 치지 않는 이유다 — 사건번호 바로 앞은 늘 선고일이라,
 * 하필 결론 문장에서만 이 실수가 난다
 */
function isSentenceEnd(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === '\n') return true
  if (!SENTENCE_END.test(ch ?? '')) return false
  return !(ch === '.' && /\d/.test(text[i - 1] ?? ''))
}

/**
 * 결론 문장을 찾을 때 물러설 수 있는 폭. 이보다 멀리까지 경계가 없으면 문장이 아니라
 * 글 전체를 끌어오는 셈이라 포기하고 종전 폭으로 자른다
 */
const CITE_MAX = 400

/** 그 자리가 든 문장의 첫머리. 경계를 못 찾으면 null */
function sentenceHead(text: string, at: number, lo: number): number | null {
  for (let i = at; i > lo && at - i < CITE_MAX; i--) {
    if (!isSentenceEnd(text, i - 1)) continue
    let head = i
    while (head < at && /\s/.test(text[head])) head++
    return head
  }
  return at - lo < CITE_MAX ? lo : null
}

/** 그 자리가 든 문장의 끝(문장부호 포함). 경계를 못 찾으면 null */
function sentenceTail(text: string, at: number, hi: number): number | null {
  for (let i = at; i < hi && i - at < CITE_MAX; i++) {
    if (isSentenceEnd(text, i)) return i + 1
  }
  return hi - at < CITE_MAX ? hi : null
}

/** 자를 자리를 문장 첫머리까지 뒤로 물린다. 가까이에 경계가 없으면 그대로 둔다 */
function backToSentence(text: string, from: number): number {
  for (let i = from; i > Math.max(0, from - EXCERPT_SLACK); i--) {
    if (SENTENCE_END.test(text[i - 1])) return i
  }
  return from
}

/** 자를 자리를 문장 끝까지 밀어낸다. 가까이에 경계가 없으면 그대로 둔다 */
function forwardToSentence(text: string, from: number): number {
  for (let i = from; i < Math.min(text.length, from + EXCERPT_SLACK); i++) {
    if (SENTENCE_END.test(text[i])) return i + 1
  }
  return from
}

/**
 * 그 판례가 인용된 대목만 잘라 낸다.
 *
 * 항목 마커로 경계가 잡히면 **그 항목 전체**를 보여준다. 글자수로 자르면 "민법 제485조는
 * …"으로 시작하는 앞 맥락이 날아가고 "…자신의 담보권을"부터 나오는데, 그건 발췌가 아니라
 * 문장을 반토막 낸 것이다. 마커에서 시작해 다음 마커 직전에 끝나므로 잘린 것이 아니고,
 * 그래서 "…"도 붙이지 않는다.
 *
 * 경계를 못 잡았거나(서술형 해설) 항목이 너무 길면 종전대로 사건번호 둘레만 자른다.
 * 그때도 자르는 범위는 항목 안으로 가둔다
 */
function excerptAround(text: string, found: { at: number; len: number }): string {
  const after = found.at + found.len
  const itemStart = lastMarkerBefore(text, found.at)
  const itemEnd = firstMarkerAfter(text, after)
  const lo = itemStart ?? 0
  const hi = itemEnd ?? text.length

  // 항목 하나가 통째로 들어갈 만하면 전부
  if (itemStart !== null && hi - lo <= ITEM_LIMIT) return text.slice(lo, hi).trim()
  // 잘라 보여줄 만큼 길지 않은데 자르면 없는 말을 지우는 셈이다
  if (hi - lo <= EXCERPT_LIMIT) return text.slice(lo, hi).trim()

  let start = Math.max(lo, backToSentence(text, Math.max(lo, found.at - EXCERPT_BEFORE)))
  let end = Math.min(hi, forwardToSentence(text, Math.min(hi, after + EXCERPT_AFTER)))
  // 사건번호가 든 문장은 글자수를 넘겨서라도 통째로 남긴다. 그 판례를 어떻게 인용했는지가
  // 조각의 전부인데, 폭을 맞추다 결론 문장을 반토막 내면 조각이 아무 말도 하지 않는다
  const head = sentenceHead(text, found.at, lo)
  const tail = sentenceTail(text, after, hi)
  if (head !== null) start = Math.min(start, head)
  if (tail !== null) end = Math.max(end, tail)
  const body = text.slice(start, end).trim()
  return `${start > lo ? '…' : ''}${body}${end < hi ? '…' : ''}`
}

export function findCaseMentions(q: Question, caseNumber: string): CaseMention[] {
  const key = normalizeCaseNumber(caseNumber)
  if (!key) return []
  const out: CaseMention[] = []
  const push = (where: string, text: string | null | undefined) => {
    const t = (text ?? '').trim()
    if (!t) return
    // 본문에 적힌 사건번호를 전부 훑어 찾는다. 그 자리가 곧 발췌의 기준이 된다
    const found = caseNumberAt(t, key)
    if (found) out.push({ where, text: excerptAround(t, found) })
  }

  push('해설', q.explanation)
  for (const e of q.explanations ?? []) if (e !== q.explanation) push('해설', e)
  for (const [label, v] of Object.entries(q.choiceExplanations ?? {})) {
    for (const t of blockText(v)) push(`${label}번 해설`, t)
  }
  for (const [label, t] of Object.entries(q.subChoiceExplanations ?? {})) push(`보기 ${label} 해설`, t)
  for (const item of q.subItems ?? []) {
    for (const t of blockText(item.explanation)) push(`보기 ${item.label} 해설`, t)
  }
  return out
}

/** 그 문제의 해설 전문 (조각을 못 찾았을 때 통째로 보여주기 위한 것) */
export function allExplanationText(q: Question): CaseMention[] {
  const out: CaseMention[] = []
  const push = (where: string, text: string | null | undefined) => {
    const t = (text ?? '').trim()
    if (t) out.push({ where, text: t })
  }
  push('해설', q.explanation)
  for (const e of q.explanations ?? []) if (e !== q.explanation) push('해설', e)
  for (const [label, v] of Object.entries(q.choiceExplanations ?? {})) {
    for (const t of blockText(v)) push(`${label}번 해설`, t)
  }
  for (const [label, t] of Object.entries(q.subChoiceExplanations ?? {})) push(`보기 ${label} 해설`, t)
  for (const item of q.subItems ?? []) {
    for (const t of blockText(item.explanation)) push(`보기 ${item.label} 해설`, t)
  }
  return out
}

/**
 * 카드에 접어 넣을 조각의 길이. 카드는 목록을 훑는 자리라 몇 줄로 접어 두는데,
 * 그 접힘(line-clamp)은 뒤에서부터 가린다. 항목 전체를 그대로 실으면 결론 문장이 접힌
 * 자리 아래로 밀려나, 정작 그 판례를 어떻게 인용했는지가 카드에서 사라진다
 */
const PREVIEW_LIMIT = 170

/**
 * 카드용으로 조각을 줄인다. 결론 문장(사건번호가 든 문장)을 먼저 확보하고, 남는 자리에
 * 앞 맥락을 채운다 — 접히더라도 결론은 남게 하려는 것이다.
 *
 * 펼친 화면("이 판례가 언급된 부분")은 줄이지 않는다. 거기서는 항목 전체가 보여야 한다
 */
function clipForCard(text: string, key: string): string {
  if (text.length <= PREVIEW_LIMIT) return text
  const found = caseNumberAt(text, key)
  if (!found) return text
  const after = found.at + found.len
  const head = sentenceHead(text, found.at, 0)
  const tail = sentenceTail(text, after, text.length)
  // 문장 경계를 못 찾으면 사건번호 둘레만이라도 보이게 한다
  const from = head ?? Math.max(0, found.at - 60)
  const to = tail ?? Math.min(text.length, after + 40)
  const room = PREVIEW_LIMIT - (to - from)
  const start = room > 0 ? Math.max(0, backToSentence(text, Math.max(0, from - room))) : from
  const body = text.slice(start, to).trim()
  return `${start > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}

/** 카드에 미리 보여줄 조각 하나와, 그것을 찾은 문제 */
export interface CasePreview {
  q: Question
  mention: CaseMention
}

/**
 * 판례 카드에 접힌 채로 보여줄 대표 조각을 고른다.
 *
 * 고르는 기준은 대표 요지(pick)와 같다 — **가장 긴 것**. 같은 판례라도 문제마다 인용하는
 * 분량이 다르고, 짧은 쪽은 대개 "위 판례 참조"처럼 사건번호만 스친 것이다.
 *
 * 인용 문제 전부를 뒤진다. 한 문제에서 못 찾았다고 멈추면(대표 문제만 보면) 표기가
 * 어긋난 한 문제 때문에 카드가 비어 보인다
 */
export function previewMention(group: CaseGroup): CasePreview | null {
  let best: CasePreview | null = null
  for (const q of group.questions) {
    for (const mention of findCaseMentions(q, group.caseNumber)) {
      if (!best || mention.text.length > best.mention.text.length) best = { q, mention }
    }
  }
  if (!best) return null
  return { ...best, mention: { ...best.mention, text: clipForCard(best.mention.text, normalizeCaseNumber(group.caseNumber)) } }
}

/** 사례형 출처가 달린 사례형 문항 수 (문항 id 기준, 여러 판례에 걸쳐도 한 번) */
export function caseStudyProblemCount(groups: CaseGroup[]): number {
  const ids = new Set<string>()
  for (const g of groups) for (const s of g.sources) if (s.kind === 'caseStudy') ids.add(s.problemId)
  return ids.size
}

/**
 * 판례 목록 위 요약 줄의 뒷부분. 선택형 칩(통합 화면이 아닐 때 포함)은 예전 문구 그대로다
 *  - 전체: "선택형 문제 N · 사례형 문항 M" / 선택형: "판례가 달린 문제 N개" / 사례형: "사례형 문항 M"
 */
export function casesSummaryTail(origin: CaseOrigin, questionsWithCases: number, caseStudyProblems: number): string {
  if (origin === 'objective') return `판례가 달린 문제 ${questionsWithCases}개`
  if (origin === 'caseStudy') return `사례형 문항 ${caseStudyProblems}`
  return `선택형 문제 ${questionsWithCases} · 사례형 문항 ${caseStudyProblems}`
}

// ── 사례형 답안 발췌 ───────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

/** 카드 html 조각을 글자로만. 태그는 지우고(<br> 은 띄어쓰기) 흔한 엔티티를 되돌린다 — 화면에는 텍스트로만 넣는다 */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim()
}

// ── 판례 화면의 출처 표시 ───────────────────────────────────────────

type CaseStudySourceItem = Extract<CaseSource, { kind: 'caseStudy' }>

/**
 * 출처 라벨 끝의 괄호를 뗀다 ("2026년 8모(민법_변시)" → "2026년 8모"). 판례 화면 표시 전용 —
 * 문제집 라벨 규칙(questionSource.sourceLabel)과 다른 화면은 그대로다
 */
export function stripSourceSuffix(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, '')
}

/** 괄호를 뗀 라벨로 다시 묶는다. 같은 라벨이 된 묶음은 하나로 합치고(처음 나온 자리) 문제번호순으로 둔다 */
export function stripBucketLabels(buckets: SourceBucket[]): SourceBucket[] {
  const merged = new Map<string, Question[]>()
  for (const b of buckets) {
    const label = stripSourceSuffix(b.label)
    merged.set(label, [...(merged.get(label) ?? []), ...b.questions])
  }
  return Array.from(merged, ([label, questions]) => ({
    label,
    questions: questions.length > 1 ? [...questions].sort((a, b) => Number(a.no) - Number(b.no)) : questions,
  }))
}

/**
 * 사례형 시험 라벨. 선택형 출처 라벨(sourceLabel)과 같은 모양으로 — "15회 변시", "2026년 1모".
 * 모의 회차는 색인에 'YY.M'(두 자리 연도)으로 온다. 법전협 모의는 2000년대 시험이라 YY → 20YY 이고,
 * 네 자리로 오면 그대로 쓴다
 */
export function caseStudyExamLabel(kind: IndexProblem['kind'], exam: number | string): string {
  if (kind === '변시') return `${exam}회 변시`
  const [y, m] = String(exam).split('.').map(Number)
  if (!y || !m) return `모의 ${exam}`
  return `${y < 100 ? 2000 + y : y}년 ${m}모`
}

/** 사례형 문항 버튼 라벨: "제2문의 3", 소문항이 있으면 "제2문의 1 문2" */
export function caseStudyQuestionLabel(qno: string, sub?: string): string {
  return [qno, sub].filter(Boolean).join(' ')
}

// 최근 시험일수록 크다. 변시는 1월 시행으로 친다
function caseStudyExamRank(s: CaseStudySourceItem): number {
  const month = s.examType === '모의' ? Number(String(s.exam).split('.')[1]) || 0 : 1
  return (s.year ?? 0) * 100 + month
}

export interface CaseStudyBucket {
  label: string
  sources: CaseStudySourceItem[]
}

/** 사례형 출처를 시험(회차)별로 묶는다. 최근 시험이 위, 묶음 안은 문항 순 */
export function groupCaseStudySources(sources: CaseStudySourceItem[]): CaseStudyBucket[] {
  const coll = new Intl.Collator('ko', { numeric: true })
  const sorted = [...sources].sort(
    (a, b) =>
      caseStudyExamRank(b) - caseStudyExamRank(a) ||
      coll.compare(a.qno, b.qno) ||
      coll.compare(a.sub, b.sub) ||
      a.problemId.localeCompare(b.problemId)
  )
  const buckets = new Map<string, CaseStudySourceItem[]>()
  for (const s of sorted) {
    const label = caseStudyExamLabel(s.examType, s.exam)
    buckets.set(label, [...(buckets.get(label) ?? []), s])
  }
  return Array.from(buckets, ([label, list]) => ({ label, sources: list }))
}

/** 텍스트에서 그 판례번호가 적힌 자리 전부 (2자리/4자리 표기 모두). 형식 밖 표기는 글자 사이 공백을 허용해 찾는다 */
export function caseNumberSpans(text: string, caseNumber: string): { at: number; len: number }[] {
  const key = normalizeCaseNumber(caseNumber)
  if (!key) return []
  const out: { at: number; len: number }[] = []
  const re = new RegExp(CASE_NUMBER.source, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (caseKey(m) === key) out.push({ at: m.index + m[1].length, len: m[0].length - m[1].length })
  }
  if (out.length > 0) return out
  const loose = new RegExp(key.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g')
  for (let m = loose.exec(text); m; m = loose.exec(text)) out.push({ at: m.index, len: m[0].length })
  return out
}

/**
 * 사례형 문항의 모범답안에서 그 판례가 나온 문단(답안 블록 p 하나)을 **통째로** 돌려준다 —
 * 앞뒤를 자르지 않는다. 같은 문단은 한 번만. 글자로만 바꾼 것이라 화면에 그대로 넣어도 된다
 */
export function caseStudyParagraphs(
  problem: { answer?: { blocks: { t?: string; html: string }[] } } | undefined,
  caseNumber: string
): string[] {
  const out: string[] = []
  for (const b of problem?.answer?.blocks ?? []) {
    if (b.t && b.t !== 'p') continue
    const text = htmlToText(b.html)
    if (text && !out.includes(text) && caseNumberSpans(text, caseNumber).length > 0) out.push(text)
  }
  return out
}
