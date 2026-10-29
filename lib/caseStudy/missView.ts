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

// ── 문항 단위 ────────────────────────────────────────────────

export interface MissProblem {
  problemId: string
  subject: string
  cardId: string
  cardTitle: string
  problemLabel: string
  items: MissItem[] // 이 문항에서 (필터에 걸린) 한 번이라도 빠진 항목 — '안 쓴 항목'
  wrongCount: number // 틀린 횟수: 이 항목들 중 하나라도 ✕·△ 였던 제출 시도 수
  lastMissedAt: number // 이 항목들이 마지막으로 빠진 시각
  open: number // 그중 최근 판정이 아직 ✕·△ 인 항목 수
  recentOk: number // 그중 최근 판정이 ✓ 인 항목 수
  kinds: MissKind[] // 들어 있는 종류(조문 → 판례 취지 → 결론 순)
}

/** 항목 → 문항. 넘긴 순서대로 문항이 처음 나온 순서를 지킨다 */
export function missProblems(items: MissItem[]): MissProblem[] {
  const by = new Map<string, MissItem[]>()
  for (const x of items) (by.get(x.problemId) ?? by.set(x.problemId, []).get(x.problemId)!).push(x)
  return [...by.values()].map((xs) => {
    const x = xs[0]
    const recentOk = xs.filter((i) => i.recentOk).length
    return {
      problemId: x.problemId,
      subject: x.subject,
      cardId: x.cardId,
      cardTitle: x.cardTitle,
      problemLabel: x.problemLabel,
      items: xs,
      wrongCount: new Set(xs.flatMap((i) => i.missAttemptIds)).size,
      lastMissedAt: Math.max(...xs.map((i) => i.lastMissedAt)),
      open: xs.length - recentOk,
      recentOk,
      kinds: (['statute', 'case', 'res'] as const).filter((k) => xs.some((i) => i.kind === k)),
    }
  })
}

/** 많이 틀린 순(기본, 같으면 최근 순) 또는 최근 빠진 순(같으면 많이 틀린 순). 새 배열 */
export function sortMissProblems(ps: MissProblem[], by: MissSort = 'count'): MissProblem[] {
  return [...ps].sort((a, b) =>
    by === 'count'
      ? b.wrongCount - a.wrongCount || b.lastMissedAt - a.lastMissedAt
      : b.lastMissedAt - a.lastMissedAt || b.wrongCount - a.wrongCount
  )
}
