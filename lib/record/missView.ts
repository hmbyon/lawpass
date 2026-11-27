/**
 * 기록형 오답노트(components/record/record-misses)의 화면에 의존하지 않는 계산.
 * 새로 저장하지 않는다 — 문제 풀기의 풀이 결과(recordDrill)와 카드 묶음을 합쳐 만든다.
 * 규칙은 사례형 오답노트(lib/caseStudy/missView)와 같다: 많이 틀린 순·최근 빠진 순, 7일·30일·전체.
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */
// lib/caseStudy/misses.ts 의 MissSort·MissPeriod 와 같은 정의(그 파일은 .tsx 를 불러 check 스크립트에서 바로 못 읽는다)
export type MissSort = 'recent' | 'count'
export type MissPeriod = 7 | 30 | 'all'
import type { RecordCard } from './cardStorage'
import type { DrillMark, DrillResults } from './drillProgress'

export interface RecordMiss {
  card: RecordCard
  wrongCount: number // 틀린 횟수 = 틀림 + 아쉬움
  wrong: number
  meh: number
  tries: number // 채점 횟수
  last: DrillMark
  at: number // 마지막 채점 시각
  recentOk: boolean // 마지막 결과가 맞음
}

/** 오답노트에 드는 카드 = 한 번이라도 틀림·아쉬움이 있었던 카드. 카드 순서대로, 카드 데이터에 없는 결과 id 는 건너뛴다 */
export function recordMisses(cards: RecordCard[], results: DrillResults): RecordMiss[] {
  const out: RecordMiss[] = []
  for (const card of cards) {
    const r = results[card.id]
    if (!r) continue
    const wrongCount = (r.wrong ?? 0) + (r.meh ?? 0)
    if (wrongCount <= 0) continue
    out.push({ card, wrongCount, wrong: r.wrong ?? 0, meh: r.meh ?? 0, tries: r.tries ?? 0, last: r.last, at: r.at ?? 0, recentOk: r.last === 'o' })
  }
  return out
}

export interface RecordMissFilter {
  subjects: string[] // 비면 전체
  kinds: string[] // '변시'·'모의'. 비면 전체
  period: MissPeriod
}

/** 과목·시험 유형·기간(마지막 채점 시각 기준)으로 거른다 */
export function filterRecordMisses(list: RecordMiss[], f: RecordMissFilter, now = Date.now()): RecordMiss[] {
  const since = f.period !== 'all' ? now - f.period * 86_400_000 : -Infinity
  return list.filter(
    (m) =>
      (f.subjects.length === 0 || f.subjects.includes(m.card.subject ?? '')) &&
      (f.kinds.length === 0 || f.kinds.includes(m.card.exam?.kind)) &&
      m.at >= since
  )
}

/** 많이 틀린 순(같으면 최근 순) 또는 최근 빠진 순(같으면 많이 틀린 순). 새 배열 — 사례형 sortMissProblems 와 같은 규칙 */
export function sortRecordMisses(list: RecordMiss[], by: MissSort = 'count'): RecordMiss[] {
  return [...list].sort((a, b) =>
    by === 'count' ? b.wrongCount - a.wrongCount || b.at - a.at : b.at - a.at || b.wrongCount - a.wrongCount
  )
}
