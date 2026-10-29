/**
 * 사례형 오답노트 문항 단위 집계(lib/caseStudy/missView 의 missProblems·sortMissProblems) 검증 (check:case-miss-problems).
 * 문항별 안 쓴 항목 수의 합 = 항목 집계(aggregateMisses)의 항목 수, 틀린 횟수 = 하나라도 빠진 시도 수.
 * CASE_JSON_DIR(카드 JSON 폴더)이나 아래 기본 폴더가 있으면 실제 카드에 가짜 시도를 만들어 같은 것을 확인한다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractAiItems } from '../lib/caseStudy/aiCheck'
import { aggregateMisses, type MissItem } from '../lib/caseStudy/misses'
import { applyMissFilter, DEFAULT_MISS_FILTER, missProblems, sortMissProblems } from '../lib/caseStudy/missView'
import type { AiVerdict, CaseAttempt } from '../lib/caseStudy/solve'
import type { Card } from '../lib/caseStudy/types'

const law = (s: string) => `<mark class="law">${s}</mark>`
const cs = (s: string) => `<mark class="case">${s}</mark>`
const res = (s: string) => `<mark class="res">${s}</mark>`
const body1 = `임차인은 ${law('민법 제626조')}에 따라 청구한다. 유익비 상환범위는 임대인이 선택한다(${cs('2001다40381')}). 따라서 ${res('乙은 상환할 필요가 없다')}.`
const body2 = `${law('형법 제250조')}의 살인죄는 ${res('성립한다')}.`
const card = (id: string, subject: string, body: string): Card =>
  ({
    schema: 1, id, subject, category: '', chapter: '', order: [1, 1], title: id, pages: '', meta: '', notes: [], source: '', cases: [], statutes: [],
    problems: [{ id: `${id}#1`, kind: '변시', exam: 15, examLabel: '', qno: '제1문', sub: '', points: 30, question: { paragraphs: [], ask: '' }, answer: { source: '', blocks: [{ t: 'p', html: body }] } }],
  }) as Card
const cards = [card('민사-1', '민법', body1), card('형사-1', '형법', body2)]
const P1 = '민사-1#1'
const P2 = '형사-1#1'
const [caseKey, resKey] = extractAiItems([body1]).map((x) => x.key)
const DAY = 86_400_000
function att(id: string, at: number, pid: string, box: string, ai: Record<string, AiVerdict> = {}): CaseAttempt {
  return {
    id, setKey: pid, problemIds: [pid], answers: [{ problemId: pid, boxes: [box] }], status: 'submitted',
    elapsedSeconds: 0, targetMinutes: null, startedAt: at, updatedAt: at, submittedAt: at,
    aiChecks: { [pid]: { model: 'm', checkedAt: at, answerHash: '', items: Object.fromEntries(Object.entries(ai).map(([k, v]) => [k, { verdict: v, evidence: v === '누락' ? '' : box, note: '' }])) } },
  }
}
const sumCheck = (items: MissItem[]) => {
  const ps = missProblems(items)
  assert.equal(ps.reduce((n, p) => n + p.items.length, 0), items.length, '문항별 안 쓴 항목 수의 합 = 항목 수')
  assert.equal(new Set(items.map((x) => x.problemId)).size, ps.length, '문항 수')
  for (const p of ps) {
    assert.ok(p.items.every((x) => x.problemId === p.problemId))
    assert.equal(p.open + p.recentOk, p.items.length)
  }
  return ps
}

// ── 1. 가짜 시도 ───────────────────────────────────────────────
const attempts = [
  // P1: 1회차 조문·판례 빠짐, 2회차 결론만 △, 3회차 전부 ✓ — 틀린 횟수 2(누적), 목록에 남고 전부 최근 ✓
  att('a1', 1 * DAY, P1, '답안', { [caseKey]: '누락', [resKey]: '담김' }),
  att('a2', 2 * DAY, P1, '민법 제626조', { [caseKey]: '담김', [resKey]: '부분' }),
  att('a3', 3 * DAY, P1, '민법 제626조', { [caseKey]: '담김', [resKey]: '담김' }),
  // P2: 한 번 조문 빠짐
  att('b1', 5 * DAY, P2, '답안'),
]
const r = aggregateMisses(attempts, cards)
const ps = sumCheck(r.items)
const p1 = ps.find((p) => p.problemId === P1)!
assert.equal(p1.items.length, 3, '조문·판례·결론 모두 한 번씩은 빠졌다')
assert.equal(p1.wrongCount, 2, '틀린 횟수 = 하나라도 빠진 시도(a1, a2)')
assert.equal(p1.open, 0)
assert.equal(p1.recentOk, 3)
assert.equal(p1.lastMissedAt, 2 * DAY)
assert.deepEqual(p1.kinds, ['statute', 'case', 'res'])
const p2 = ps.find((p) => p.problemId === P2)!
assert.equal(p2.wrongCount, 1)
assert.equal(p2.open, 1)
assert.equal(r.recentOk, 3)

// 정렬: 많이 틀린 순(기본) → P1(2) P2(1), 최근 빠진 순 → P2(5일) P1(2일)
assert.deepEqual(sortMissProblems(ps).map((p) => p.problemId), [P1, P2])
assert.deepEqual(sortMissProblems(ps, 'recent').map((p) => p.problemId), [P2, P1])

// 필터는 항목에 걸고 문항으로 묶는다: 결론만 → P1(결론 1개, 틀린 횟수는 결론이 빠진 a2 하나), P2 는 결론이 빠진 적 없어 빠진다
const onlyRes = missProblems(applyMissFilter(r.items, { ...DEFAULT_MISS_FILTER, kinds: ['res'] }, {}))
assert.deepEqual(onlyRes.map((p) => [p.problemId, p.items.length, p.wrongCount]), [[P1, 1, 1]])
assert.deepEqual(missProblems([]), [])

// ── 2. 실제 카드 데이터 ─────────────────────────────────────────
const DEFAULT_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
)
const dir = process.env.CASE_JSON_DIR || DEFAULT_DIR
if (!fs.existsSync(dir)) {
  console.log(`카드 JSON 폴더가 없어 실제 데이터 점검은 건너뜀 (${dir})`)
} else {
  const real: Card[] = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== '_index.json').map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  // 문항마다 빈 답안 두 번 + 모든 AI 항목을 번갈아 누락/담김으로
  const fake: CaseAttempt[] = []
  let i = 0
  for (const c of real) for (const p of c.problems) {
    if (!p.answer?.blocks.length) continue
    const its = extractAiItems(p.answer.blocks.map((b) => b.html))
    for (const round of [0, 1]) {
      fake.push(att(`r${i++}`, i, p.id, '', Object.fromEntries(its.map((it, k) => [it.key, (k + round) % 2 ? '누락' : '담김'] as [string, AiVerdict]))))
    }
  }
  const all = aggregateMisses(fake, real)
  const rps = sumCheck(all.items)
  // 조문은 빈 답안이라 두 번 다 빠진다 → 틀린 횟수 2. 조문 없는 문항은 AI 항목이 한 번씩만 빠질 수도 있다(1 또는 2)
  assert.ok(rps.every((p) => (p.kinds.includes('statute') ? p.wrongCount === 2 : p.wrongCount >= 1 && p.wrongCount <= 2)))
  console.log(`실제 카드: 문항 ${rps.length}개 · 안 쓴 항목 ${all.items.length}개(문항별 합과 같음) · 최근 ✓ ${all.recentOk}개`)
}

console.log('check:case-miss-problems 통과')
