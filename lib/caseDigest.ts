import type { CaseRef, ExplanationBlock, Question, Subject } from './types'
import { SUBJECT_UNITS } from './units'

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
export function filterCases(
  groups: CaseGroup[],
  opts: { years?: number | null; subjects?: string[]; units?: string[]; now?: Date }
): CaseGroup[] {
  const { years = null, subjects = [], units = [], now = new Date() } = opts
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

  return groups.filter((g) => {
    if (!inPeriod(g.year, years, now)) return false
    if (subjects.length === 0 && units.length === 0) return true
    return g.questions.some((q) => {
      if (subjects.length > 0 && !subjects.includes(q.subject)) return false
      const only = unitsFor(q.subject)
      return only.length === 0 || only.includes(q.unit?.trim() ?? '')
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
    if (`${m[1]}${m[2]}${m[3]}` === key) return { at: m.index, len: m[0].length }
  }
  // 사건번호 형식이 아닌 표기(normalizeCaseNumber가 공백만 지워 돌려준 것)는 그 글자들을
  // 그대로 찾는다. 본문에서도 띄어 적힐 수 있어 글자 사이 공백을 허용한다
  const loose = key.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
  const m = new RegExp(loose).exec(text)
  return m ? { at: m.index, len: m[0].length } : null
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

  const start = Math.max(lo, backToSentence(text, Math.max(lo, found.at - EXCERPT_BEFORE)))
  const end = Math.min(hi, forwardToSentence(text, Math.min(hi, after + EXCERPT_AFTER)))
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
  return best
}
