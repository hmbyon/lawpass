/**
 * 사례형 색인·카드의 판례번호(cases, v1.1) 검증 (check:case-fields).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 * HTML sanitizer(sanitizeCaseHtml)는 DOMParser 가 필요해 여기서 부르지 않는다
 */
import assert from 'node:assert/strict'
import {
  CASES_MAX_PER_CARD, CASES_MAX_PER_PROBLEM, indexCaseStats, sanitizeCardCases, sanitizeIndexCases,
} from '../lib/caseStudy/sanitize'
import type { Card, CaseIndex } from '../lib/caseStudy/types'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
// Firestore 는 undefined 값을 쓰지 못한다 — 정리 결과 어디에도 undefined 가 남으면 안 된다
function noUndefined(v: unknown, path = '$'): void {
  if (v === undefined) assert.fail(`${path} 가 undefined`)
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) noUndefined(x, `${path}.${k}`)
}

const problem = (id: string, extra: object = {}) => ({ id, kind: '변시', exam: 11, qno: '제2문의 1', sub: '문1', points: 20, ...extra })
const indexOf = (cards: object[]) => ({ schema: 1, cards }) as unknown as CaseIndex

// ── 1. v1 색인(필드 없음): 그대로 통과, 필드를 만들지 않는다 ──────────────
const v1 = indexOf([{ id: '1a-1', subject: '민법', category: '민법총칙', chapter: '법인', order: [0, 0], title: 't', pages: '', problems: [problem('1a-1#1')] }])
const v1Before = clone(v1)
assert.deepEqual(sanitizeIndexCases(v1), [])
assert.deepEqual(v1, v1Before, 'v1 은 한 글자도 바뀌지 않는다')
assert.ok(!('cases' in (v1.cards[0] as object)))
assert.deepEqual(indexCaseStats(v1), { cards: 0, cases: 0 }, 'v1 은 판례 색인 없음')

// ── 2. v1.1 실제 샘플: 그대로 보존 ──────────────────────────────────
const sample = indexOf([{
  id: '1a-1', subject: '민법', category: '민법총칙', chapter: '법인', order: [0, 0], title: 't', pages: '',
  cases: ['2001다46730', '98다34126'],
  problems: [problem('1a-1#1', { cases: ['2002다64780'] })],
}])
const sampleBefore = clone(sample)
assert.deepEqual(sanitizeIndexCases(sample), [])
assert.deepEqual(sample, sampleBefore, '정상 v1.1 은 그대로')
assert.deepEqual(indexCaseStats(sample), { cards: 1, cases: 3 })
// 같은 판례의 2자리/4자리 표기는 한 종으로 센다 (normalizeCaseNumber)
const dup = indexOf([{ id: 'x', problems: [problem('x#1', { cases: ['98다34126'] })], cases: ['1998다34126', '98 다 34126'] }])
assert.deepEqual(indexCaseStats(dup), { cards: 1, cases: 1 })

// ── 3. 이상 항목은 그 항목만 버리고 경고 ──────────────────────────────
const bad = indexOf([{
  id: 'b-1', problems: [problem('b-1#1', { cases: ['<b>2001다1</b>', 'x'.repeat(100), 12345, '  2001다2  ', '', '2001다3; DROP', '2017도16593-1', '2007다37394, 37400'] })],
  cases: [1, 2, 3],
}])
const w = sanitizeIndexCases(bad)
const p0 = bad.cards[0].problems[0]
assert.deepEqual(p0.cases, ['2001다2', '2017도16593-1', '2007다37394, 37400'], 'trim·빈값 제거 후 정상 항목만 남는다')
assert.deepEqual(bad.cards[0].cases, [], '숫자 배열은 항목이 전부 버려진다')
assert.equal(w.length, 7, `경고 7개 (HTML·100자·숫자·특수문자 + 카드 숫자 3개): ${w.join(' / ')}`)
assert.ok(w.some((m) => m.includes('40자를 넘는')))
assert.ok(w.some((m) => m.includes('허용하지 않는 문자') && m.includes('<b>')))
assert.ok(w.some((m) => m.includes('문자열이 아닌')))
noUndefined(bad)

// 배열이 아닌 cases 는 키째 버린다 (undefined 로 남기지 않는다)
const notArray = indexOf([{ id: 'n', problems: [problem('n#1', { cases: '2001다1' })], cases: { a: 1 } }])
assert.equal(sanitizeIndexCases(notArray).length, 2)
assert.ok(!('cases' in (notArray.cards[0] as object)))
assert.ok(!('cases' in (notArray.cards[0].problems[0] as object)))
noUndefined(notArray)

// ── 4. 개수 제한: 문항 50, 카드 200 ──────────────────────────────────
const many = (n: number) => Array.from({ length: n }, (_, i) => `2001다${i + 1}`)
const big = indexOf([{ id: 'm', cases: many(250), problems: [problem('m#1', { cases: many(60) })] }])
const wb = sanitizeIndexCases(big)
assert.equal(big.cards[0].cases?.length, CASES_MAX_PER_CARD)
assert.equal(big.cards[0].problems[0].cases?.length, CASES_MAX_PER_PROBLEM)
assert.equal(wb.length, 2)

// ── 5. 카드 문서도 같은 규칙 (카드 cases + 문항 cases) ─────────────────
const card = {
  schema: 1, id: '1a-1', problems: [problem('1a-1#1', { cases: ['2002다64780', '<i>x</i>'] }), problem('1a-1#2')],
  cases: ['2001다46730', '98다34126'], notes: [], statutes: [],
} as unknown as Card
const wc = sanitizeCardCases(card)
assert.equal(wc.length, 1)
assert.deepEqual(card.problems[0].cases, ['2002다64780'])
assert.ok(!('cases' in card.problems[1]), 'v1 문항(필드 없음)은 그대로')
assert.deepEqual(card.cases, ['2001다46730', '98다34126'])
noUndefined(card)

console.log('통과: 판례번호(cases) v1/v1.1 색인·카드 정리, 이상 항목 제거·경고, 개수 제한, 판례 종 수')
