/**
 * 기록형 문제 풀기 — 자가채점 결과와 카드 고르기. 화면·Firestore 없음(순수 함수).
 * 저장은 lib/firebaseServices/recordDrill.ts 가 사용자 본인 트리에 문서 하나(map)로 한다.
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */
import { examKey, sortedExamKeys } from './notes'
import type { RecordCard } from './cardStorage'

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
  kinds: string[] // '변시'·'모의'. 비면 전부
  exams: string[] // examKey("변시 15"). 비면 전부
  wrongOnly: boolean
}

/** 종류·회차·오답만 조건으로 카드를 고른다 */
export function filterCards(cards: RecordCard[], f: DrillFilter, results: DrillResults): RecordCard[] {
  return cards.filter(
    (c) =>
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
