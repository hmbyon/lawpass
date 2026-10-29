// 상대 경로: check:case-miss-view 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { filterMisses, missTree, sortMisses, type MissItem, type MissKind, type MissPeriod, type MissSort } from './misses'

/**
 * 오답노트 화면(components/case-study/case-misses)의 화면에 의존하지 않는 계산.
 * 집계 규칙은 misses.ts 그대로 쓰고, 여기서는 칩·필터 조합과 읽기 화면 순서만 정한다
 */

export interface MissFilter {
  group: string | null // 시험 과목(공법·형사법·민사법). null = 전체
  subject: string | null // 세부 과목(민법…). null = 그 시험 과목 전체
  kinds: MissKind[] // 비어 있으면 전체
  period: MissPeriod
  sort: MissSort
}

export const DEFAULT_MISS_FILTER: MissFilter = { group: null, subject: null, kinds: [], period: 'all', sort: 'recent' }

/** 시험 과목 → 세부 과목 칩. 세부 과목은 넘긴 항목에 나온 순서(카드 순서 = 과목 순서), 시험 과목은 order 순서(없는 것은 뒤) */
export function missGroups(items: MissItem[], groupOf: Record<string, string>, order: string[]) {
  const subjects = [...new Set(items.map((x) => x.subject))]
  const of = (s: string) => groupOf[s] ?? s
  const rank = (g: string) => (order.includes(g) ? order.indexOf(g) : order.length)
  return [...new Set(subjects.map(of))]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((label) => ({ label, subjects: subjects.filter((s) => of(s) === label) }))
}

/** 필터 후 정렬된 평탄 목록. 과목·기간은 filterMisses, 정렬은 sortMisses */
export function applyMissFilter(
  items: MissItem[], f: MissFilter, groupOf: Record<string, string>, now = Date.now()
): MissItem[] {
  let out = filterMisses(items, { subject: f.subject ?? undefined, period: f.period, now })
  if (f.group && !f.subject) out = out.filter((x) => (groupOf[x.subject] ?? x.subject) === f.group)
  if (f.kinds.length) out = out.filter((x) => f.kinds.includes(x.kind))
  return sortMisses(out, f.sort)
}

/** 화면 목록(트리)과 읽기 화면이 쓰는 순서 — 정렬 결과를 카드별로 모은 것(먼저 나온 카드가 앞) */
export const missReadingOrder = (sorted: MissItem[]): MissItem[] =>
  missTree(sorted).flatMap((s) => s.cards.flatMap((c) => c.problems.flatMap((p) => p.items)))

/** 읽기 화면 위치 이동(끝에서 멈춘다)과 진행 표시 '3/27' */
const clampAt = (at: number, total: number) => Math.max(0, Math.min(total - 1, at))
// 목록이 줄어 at 이 끝을 넘었으면 끝에서부터 센다(화면도 끝 항목을 보여 준다)
export const stepReading = (at: number, delta: number, total: number) => clampAt(clampAt(at, total) + delta, total)
export const readingProgress = (at: number, total: number) => (total ? `${at + 1}/${total}` : '0/0')

/** 최근 빠진 날짜 '2026.10.29' */
export function missDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

export const MISS_KIND_LABEL: Record<MissKind, string> = { statute: '조문', case: '판례 취지', res: '결론' }
