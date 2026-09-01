import type { CaseRef, ExplanationBlock, Question, Subject } from './types'

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
 */
const CASE_NUMBER = /(\d{4})\s*([가-힣]{1,4})\s*(\d+)/

export function normalizeCaseNumber(caseNumber: string): string {
  const m = CASE_NUMBER.exec(caseNumber ?? '')
  if (m) return `${m[1]}${m[2]}${m[3]}`
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

export function buildCaseDigest(questions: Question[], now: Date = new Date()): CaseDigest {
  const groups = new Map<string, { refs: CaseRef[]; questions: Question[] }>()
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
      const found = groups.get(key)
      if (found) {
        found.refs.push(c)
        found.questions.push(q)
      } else {
        groups.set(key, { refs: [c], questions: [q] })
      }
    }
  }

  const all: CaseGroup[] = Array.from(groups.entries()).map(([key, g]) => {
    const { summary, otherSummaries } = pick(g.refs.map((r) => r.summary))
    // 선고일·법원은 비어 있는 사본이 섞이므로, 적혀 있는 것 중 첫 번째를 쓴다
    const decidedDate = g.refs.find((r) => r.decidedDate?.trim())?.decidedDate
    return {
      key,
      caseNumber: g.refs[0].caseNumber,
      decidedDate,
      court: g.refs.find((r) => r.court?.trim())?.court,
      summary,
      otherSummaries,
      year: decidedYear(decidedDate),
      questions: g.questions,
      count: g.questions.length,
      subjects: Array.from(new Set(g.questions.map((q) => q.subject))),
      units: Array.from(new Set(g.questions.map((q) => q.unit?.trim()).filter((u): u is string => !!u))),
    }
  })

  return { groups: all, totalGroups: all.length, questionsWithCases }
}

export type CaseSort = 'count' | 'date'

/** 많이 나온 판례가 먼저. 같으면 최신 선고일, 그다음 사건번호로 순서를 고정한다 */
const byCount = (a: CaseGroup, b: CaseGroup) =>
  b.count - a.count || (b.year ?? 0) - (a.year ?? 0) || a.key.localeCompare(b.key)

/**
 * 최신 선고일이 먼저. 선고일을 모르는 판례는 맨 뒤로 민다 —
 * 0으로 쳐서 섞으면 "언제 것인지 모르는 판례"가 가장 오래된 판례인 척 자리를 차지한다
 */
const byDate = (a: CaseGroup, b: CaseGroup) => {
  if (a.year === null || b.year === null) {
    if (a.year === b.year) return byCount(a, b)
    return a.year === null ? 1 : -1
  }
  return b.year - a.year || b.count - a.count || a.key.localeCompare(b.key)
}

export function sortCases(groups: CaseGroup[], sort: CaseSort): CaseGroup[] {
  return [...groups].sort(sort === 'date' ? byDate : byCount)
}

/**
 * 화면에 세울 판례를 고른다. 세 조건은 서로 독립이다.
 *
 * 과목·단원은 **한 문제가 둘 다 만족**해야 한다. 따로 보면 "민법 문제에서도 인용됐고
 * 다른 과목의 물권법에서도 인용됐다"는 이유로 걸리는데, 그건 고른 조건과 다른 판례다.
 * 기간은 선고일을 아는 판례에만 걸린다 (모르는 것은 화면이 따로 모아 보여준다)
 */
export function filterCases(
  groups: CaseGroup[],
  opts: { years?: number | null; subjects?: string[]; units?: string[]; now?: Date }
): CaseGroup[] {
  const { years = null, subjects = [], units = [], now = new Date() } = opts
  return groups.filter((g) => {
    if (!inPeriod(g.year, years, now)) return false
    if (subjects.length === 0 && units.length === 0) return true
    return g.questions.some(
      (q) =>
        (subjects.length === 0 || subjects.includes(q.subject)) &&
        (units.length === 0 || units.includes(q.unit?.trim() ?? ''))
    )
  })
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
export function findCaseMentions(q: Question, caseNumber: string): CaseMention[] {
  const key = normalizeCaseNumber(caseNumber)
  if (!key) return []
  const out: CaseMention[] = []
  const push = (where: string, text: string | null | undefined) => {
    const t = (text ?? '').trim()
    if (!t) return
    // 본문에서도 사건번호가 띄어 적힐 수 있어 같은 정규화를 거쳐 견준다
    if (normalizeCaseNumber(t).includes(key)) out.push({ where, text: t })
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
