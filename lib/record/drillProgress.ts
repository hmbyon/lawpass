/**
 * 기록형 문제 풀기 — 자가채점 결과와 카드 고르기. 화면·Firestore 없음(순수 함수).
 * 저장은 lib/firebaseServices/recordDrill.ts 가 사용자 본인 트리에 문서 하나(map)로 한다.
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */
import { examKey, sortedExamKeys } from './notes'
import type { RecordCard } from './cardStorage'
import { examYear } from '../caseStudy/progress'
import { mockValue } from '../caseStudy/group'
import { EXAM_MONTH_OPTIONS, examMonthLabel, type ExamMonthLabel } from '../questionSource'

/** 'o' 맞음 · 'h' 아쉬움 · 'x' 틀림 */
export type DrillMark = 'o' | 'h' | 'x'

export interface DrillRecord {
  last: DrillMark
  tries: number // 채점 횟수
  wrong: number // 틀림 누적
  meh: number // 아쉬움 누적
  at: number // 마지막 채점 시각(ms)
}

export type DrillResults = Record<string, DrillRecord>

/** 채점 하나를 반영한 새 결과(입력은 바꾸지 않는다) */
export function applyResult(results: DrillResults, cardId: string, mark: DrillMark, now: number): DrillResults {
  const prev = results[cardId]
  return {
    ...results,
    [cardId]: {
      last: mark,
      tries: (prev?.tries ?? 0) + 1,
      wrong: (prev?.wrong ?? 0) + (mark === 'x' ? 1 : 0),
      meh: (prev?.meh ?? 0) + (mark === 'h' ? 1 : 0),
      at: now,
    },
  }
}

/** 다시 풀 카드: 마지막 결과가 아쉬움·틀림 */
export function isWrong(rec: DrillRecord | undefined): boolean {
  return rec?.last === 'h' || rec?.last === 'x'
}

export interface DrillFilter {
  subjects?: string[] // '공법'·'민사'·'형사'. 비거나 없으면 전부
  kinds: string[] // '변시'·'모의'. 비면 전부
  exams: string[] // examKey("변시 15"). 비면 전부
  wrongOnly: boolean
}

/** 과목·종류·회차·오답만 조건으로 카드를 고른다 */
export function filterCards(cards: RecordCard[], f: DrillFilter, results: DrillResults): RecordCard[] {
  return cards.filter(
    (c) =>
      (!f.subjects?.length || f.subjects.includes(c.subject ?? '')) &&
      (f.kinds.length === 0 || f.kinds.includes(c.exam?.kind)) &&
      (f.exams.length === 0 || f.exams.includes(examKey(c.exam))) &&
      (!f.wrongOnly || isWrong(results[c.id]))
  )
}

/** 회차 칩: 고른 종류(없으면 전부)의 회차, 정리본과 같은 정렬 */
export function examChipsOfCards(cards: RecordCard[], kinds: string[]): string[] {
  return sortedExamKeys(cards.filter((c) => kinds.length === 0 || kinds.includes(c.exam?.kind)).map((c) => c.exam))
}

// 시드가 같으면 같은 수열 (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 풀 순서. 섞지 않으면 회차순(변시 → 모의, 번호순)이고 같은 회차 안은 원래 순서. 섞으면 seed 로 고정된 순서 */
export function orderCards(cards: RecordCard[], shuffle: boolean, seed: number): RecordCard[] {
  if (shuffle) {
    const out = [...cards]
    const r = rng(seed)
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const rank = new Map(sortedExamKeys(cards.map((c) => c.exam)).map((k, i) => [k, i]))
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (rank.get(examKey(a.c.exam)) ?? 0) - (rank.get(examKey(b.c.exam)) ?? 0) || a.i - b.i)
    .map((x) => x.c)
}

export interface DrillStats {
  o: number
  h: number
  x: number
  none: number // 안 푼
}

/** 카드들의 마지막 결과 통계 */
export function drillStats(cards: RecordCard[], results: DrillResults): DrillStats {
  const s: DrillStats = { o: 0, h: 0, x: 0, none: 0 }
  for (const c of cards) {
    const last = results[c.id]?.last
    if (last === 'o' || last === 'h' || last === 'x') s[last]++
    else s.none++
  }
  return s
}

const SUBJECT_ORDER = ['공법', '민사', '형사']

/** 과목 칩: 카드가 실제로 있는 과목만, 공법 → 민사 → 형사 (그 밖은 뒤) */
export function subjectsOfCards(cards: RecordCard[]): string[] {
  const rank = (s: string) => (SUBJECT_ORDER.includes(s) ? SUBJECT_ORDER.indexOf(s) : SUBJECT_ORDER.length)
  return Array.from(new Set(cards.map((c) => c.subject).filter((s): s is string => !!s))).sort((a, b) => rank(a) - rank(b))
}

// ── 시작 화면 필터 — 사례형 CBT 실전(components/case-study/case-cbt.tsx)과 같은 규칙 ──────────

/** 카드의 연도. CBT 의 examYear 와 같은 규칙(변시 N회 → 2011+N, 모의 'YY.M' → 20YY). 못 읽으면 null */
export function cardYear(card: RecordCard): string | null {
  const y = examYear(card.exam?.kind ?? '', card.exam?.exam ?? '')
  return y === null ? null : String(y)
}

/** 모의 회차(6·8·10모). CBT 의 mockMonth 와 같다 — 모의가 아니거나 6·8·10 이 아니면 null */
export function cardMonth(card: RecordCard): ExamMonthLabel | null {
  if (card.exam?.kind !== '모의') return null
  const m = Number(String(card.exam.exam).split('.')[1])
  return m === 6 || m === 8 || m === 10 ? examMonthLabel(m) : null
}

// 과목 → 시험 과목 묶음. CBT 와 같은 순서(민사법 → 형사법 → 공법)
const EXAM_GROUP: Record<string, string> = { 민사: '민사법', 형사: '형사법', 공법: '공법' }
const GROUP_ORDER = ['민사법', '형사법', '공법']
const groupOf = (subject: string) => EXAM_GROUP[subject] ?? subject

/** 과목 묶음 버튼과 그 아래 과목 칩. 카드가 있는 과목만 */
export function subjectGroupsOfCards(cards: RecordCard[]): { label: string; subjects: string[] }[] {
  const subjects = subjectsOfCards(cards)
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length)
  const names = [...new Set(subjects.map(groupOf))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return names.map((label) => ({ label, subjects: subjects.filter((s) => groupOf(s) === label) }))
}

/** 고를 수 있는 값 = 고른 과목에 실제로 있는 값. 과목을 안 골랐으면 모두 비어 칩이 회색이다(CBT 와 같다) */
export function selectableOf(cards: RecordCard[], subjects: string[]): { kinds: string[]; months: ExamMonthLabel[]; years: string[] } {
  const scoped = subjects.length === 0 ? [] : cards.filter((c) => subjects.includes(c.subject ?? ''))
  return {
    kinds: ['변시', '모의'].filter((k) => scoped.some((c) => c.exam?.kind === k)),
    months: EXAM_MONTH_OPTIONS.filter((m) => scoped.some((c) => cardMonth(c) === m)),
    years: [...new Set(scoped.map(cardYear).filter((y): y is string => !!y))],
  }
}

/** 연도 칩 후보: 전체 카드의 연도, 최신순 */
export function yearOptionsOf(cards: RecordCard[]): string[] {
  return [...new Set(cards.map(cardYear).filter((y): y is string => !!y))].sort((a, b) => Number(b) - Number(a))
}

/** "최근 N개년": 연도 후보 앞 N개 중 고를 수 있는 것 */
export function recentYears(options: string[], selectable: string[], n: number): string[] {
  return options.slice(0, n).filter((y) => selectable.includes(y))
}

export interface CbtFilter {
  subjects: string[]
  kinds: string[]
  months: ExamMonthLabel[]
  years: string[]
}

/** CBT 의 filteredAll 과 같다. 회차(월)는 모의를 골랐을 때 모의 카드에만, 월을 못 읽은 카드는 거르지 않는다. 연도를 못 읽은 카드는 연도를 고르면 빠진다 */
export function filterByCbt(cards: RecordCard[], f: CbtFilter): RecordCard[] {
  return cards.filter((c) => {
    const kind = c.exam?.kind
    const month = cardMonth(c)
    const year = cardYear(c)
    return (
      (f.subjects.length === 0 || f.subjects.includes(c.subject ?? '')) &&
      (f.kinds.length === 0 || f.kinds.includes(kind)) &&
      (!f.kinds.includes('모의') || f.months.length === 0 || kind !== '모의' || month === null || f.months.includes(month)) &&
      (f.years.length === 0 || (year !== null && f.years.includes(year)))
    )
  })
}

/** 안 푼 카드 = 풀이 결과 문서에 결과가 없는 카드 */
export function unsolvedCards(cards: RecordCard[], results: DrillResults): RecordCard[] {
  return cards.filter((c) => !results[c.id])
}

// CBT 목록 순서와 같다: 변시 → 모의, 변시는 회차 오름차순·모의는 최신순, 그다음 공법 → 형사 → 민사, 같으면 원래 순서
const LIST_SUBJECT_ORDER = ['공법', '형사', '민사']
// 변시 회차 오름차순. 숫자로 못 읽은 회차는 뒤로 (NaN 비교로 정렬이 흔들리지 않게)
function byNumber(a: unknown, b: unknown): number {
  const x = Number(a)
  const y = Number(b)
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y
  return Number.isFinite(x) ? -1 : Number.isFinite(y) ? 1 : 0
}
export function sortCardsForList(cards: RecordCard[]): RecordCard[] {
  const kindRank = (k: string) => (k === '변시' ? 0 : k === '모의' ? 1 : 2)
  const subjRank = (s: string) => (LIST_SUBJECT_ORDER.includes(s) ? LIST_SUBJECT_ORDER.indexOf(s) : LIST_SUBJECT_ORDER.length)
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ka = a.c.exam?.kind ?? ''
      const kb = b.c.exam?.kind ?? ''
      return (
        kindRank(ka) - kindRank(kb) ||
        (ka === '변시' ? byNumber(a.c.exam.exam, b.c.exam.exam) : mockValue(b.c.exam?.exam ?? '') - mockValue(a.c.exam?.exam ?? '')) ||
        subjRank(a.c.subject ?? '') - subjRank(b.c.subject ?? '') ||
        a.i - b.i
      )
    })
    .map((x) => x.c)
}
