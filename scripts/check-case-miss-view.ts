/**
 * 사례형 오답노트 화면 계산(lib/caseStudy/missView) 검증 (check:case-miss-view). 화면·Firestore·API 호출 없음
 */
import assert from 'node:assert/strict'
import type { MissItem, MissKind } from '../lib/caseStudy/misses'
import {
  DEFAULT_MISS_FILTER, applyMissFilter, missDate, missGroups, missReadingOrder, readingProgress, stepReading,
} from '../lib/caseStudy/missView'

const GROUP_OF: Record<string, string> = {
  헌법: '공법', 행정법: '공법', 민법: '민사법', 민소: '민사법', 상법: '민사법', 형법: '형사법', 형소: '형사법',
}
const ORDER = ['공법', '형사법', '민사법']
const DAY = 86_400_000
const NOW = 100 * DAY

let n = 0
const it = (subject: string, cardId: string, kind: MissKind, missCount: number, daysAgo: number): MissItem => ({
  problemId: `${cardId}#1`, key: `k${n++}`, kind, subject, cardId, cardTitle: cardId, problemLabel: '변시 15회 제1문',
  label: '', text: '', missCount, lastMissedAt: NOW - daysAgo * DAY, lastVerdict: 'missing', evidence: '', note: '',
})
// 집계 결과처럼 카드 순서(민법 → 형법 → 헌법)
const items = [
  it('민법', 'm1', 'statute', 1, 40), // k0
  it('민법', 'm1', 'case', 3, 2), // k1
  it('민법', 'm2', 'res', 2, 10), // k2
  it('형법', 'h1', 'statute', 1, 1), // k3
  it('헌법', 'g1', 'res', 5, 20), // k4
  it('기타', 'x1', 'res', 1, 3), // k5 — 묶음에 없는 과목
]
const keys = (xs: MissItem[]) => xs.map((x) => x.key)

// ── 1. 2단 과목 칩: 공법 → 형사법 → 민사법, 없는 과목은 뒤 ───────────────
assert.deepEqual(missGroups(items, GROUP_OF, ORDER), [
  { label: '공법', subjects: ['헌법'] },
  { label: '형사법', subjects: ['형법'] },
  { label: '민사법', subjects: ['민법'] },
  { label: '기타', subjects: ['기타'] },
])
assert.deepEqual(missGroups([], GROUP_OF, ORDER), [])

// ── 2. 필터 · 정렬 ───────────────────────────────────────────
const f = DEFAULT_MISS_FILTER
assert.deepEqual(keys(applyMissFilter(items, f, GROUP_OF, NOW)), ['k3', 'k1', 'k5', 'k2', 'k4', 'k0'], '기본: 최근 빠진 순')
assert.deepEqual(keys(applyMissFilter(items, { ...f, sort: 'count' }, GROUP_OF, NOW)), ['k4', 'k1', 'k2', 'k3', 'k5', 'k0'])
assert.deepEqual(keys(applyMissFilter(items, { ...f, group: '민사법' }, GROUP_OF, NOW)), ['k1', 'k2', 'k0'], '시험 과목만 고르면 묶음 전체')
assert.deepEqual(keys(applyMissFilter(items, { ...f, group: '민사법', subject: '민법' }, GROUP_OF, NOW)), ['k1', 'k2', 'k0'])
assert.deepEqual(keys(applyMissFilter(items, { ...f, group: '형사법', subject: '형법' }, GROUP_OF, NOW)), ['k3'])
assert.deepEqual(keys(applyMissFilter(items, { ...f, kinds: ['statute', 'res'] }, GROUP_OF, NOW)), ['k3', 'k5', 'k2', 'k4', 'k0'], '종류 복수 선택')
assert.deepEqual(keys(applyMissFilter(items, { ...f, period: 7 }, GROUP_OF, NOW)), ['k3', 'k1', 'k5'])
assert.deepEqual(keys(applyMissFilter(items, { ...f, period: 30 }, GROUP_OF, NOW)), ['k3', 'k1', 'k5', 'k2', 'k4'])
assert.deepEqual(applyMissFilter(items, { ...f, group: '공법', kinds: ['case'] }, GROUP_OF, NOW), [])
assert.deepEqual(keys(items), ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'], '입력은 그대로')

// ── 3. 목록·읽기 화면 순서: 정렬 결과를 카드별로 모은다 ─────────────────
// 최근 순: k3(h1) k1(m1) k5(x1) k2(m2) k4(g1) k0(m1) → 과목 형법 → 민법(m1: k1,k0 / m2: k2) → 기타 → 헌법
const sorted = applyMissFilter(items, f, GROUP_OF, NOW)
assert.deepEqual(keys(missReadingOrder(sorted)), ['k3', 'k1', 'k0', 'k2', 'k5', 'k4'])
assert.deepEqual(keys(missReadingOrder(applyMissFilter(items, { ...f, sort: 'count' }, GROUP_OF, NOW))), ['k4', 'k1', 'k0', 'k2', 'k3', 'k5'])
assert.deepEqual(missReadingOrder([]), [])

// ── 4. 진행 · 이동 ───────────────────────────────────────────
assert.equal(readingProgress(2, 27), '3/27')
assert.equal(readingProgress(0, 0), '0/0')
assert.equal(stepReading(0, -1, 5), 0, '처음에서 이전은 그대로')
assert.equal(stepReading(4, 1, 5), 4, '끝에서 다음은 그대로')
assert.equal(stepReading(2, 1, 5), 3)
assert.equal(stepReading(9, -1, 3), 1, '목록이 줄어도 범위 안으로')

// ── 5. 날짜 ──────────────────────────────────────────────────
assert.equal(missDate(new Date(2026, 9, 29, 13).getTime()), '2026.10.29')

console.log('check:case-miss-view 통과')
