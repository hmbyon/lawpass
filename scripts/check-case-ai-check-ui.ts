/**
 * 사례형 AI 점검 화면용 순수 함수(lib/caseStudy/aiCheckView) 검증 (check:case-ai-check-ui). 화면·API 호출 없음
 */
import assert from 'node:assert/strict'
import { answerHashOf, extractAiItems, isAiCheckStale, type AiCheckRecord } from '../lib/caseStudy/aiCheck'
import { aiDotTargets, aiSummary, finalVerdict, hasUserVerdicts, insertAfterMarks, setUserVerdict } from '../lib/caseStudy/aiCheckView'

const cs = (s: string) => `<mark class="case">${s}</mark>`
const res = (s: string) => `<mark class="res">${s}</mark>`
const law = (s: string) => `<mark class="law">${s}</mark>`

const blocks = [
  // 한 문장에 판례 표시 둘 → 점은 첫 번째 표시에. 결론은 다음 문장
  `취지 문장이 충분히 길게 이어진다(대판 ${cs('2001다1')}, 대판 ${cs('2002다2')}). 따라서 ${res('청구는 기각된다')}.`,
  // 같은 문장 결론 둘 → 한 항목, 점은 첫 번째 결론 표시에
  `이 경우 ${res('甲은 책임이 있고')} ${law('제750조')}에 따라 ${res('乙은 책임이 없다')}.`,
  // 결론이 판례 표시보다 앞인 문장 — 종류별로 따로, 각자 자기 종류의 첫 표시에
  `판례는 ${res('위법하다')}고 하여 처분을 취소하였다(${cs('99두1')}).`,
]
const items = extractAiItems(blocks)
assert.deepEqual(items.map((x) => [x.block, x.kind]), [[0, 'case'], [0, 'res'], [1, 'res'], [2, 'res'], [2, 'case']])

// ── 1. 항목 → 점 자리 ─────────────────────────────────────────
const t = aiDotTargets(blocks, items)
assert.deepEqual(t, {
  0: { 'case:0': [items[0].key], 'res:0': [items[1].key] },
  1: { 'res:0': [items[2].key] },
  2: { 'res:0': [items[3].key], 'case:0': [items[4].key] },
})
// 카드 글이 바뀌어 구간에 표시가 없으면 점을 달지 않는다
assert.deepEqual(aiDotTargets(['표시 없음'], [{ ...items[0], block: 0 }]), {})
assert.deepEqual(aiDotTargets(blocks, [{ ...items[0], block: 9 }]), {})

// 점 넣기: 종류마다 순서를 따로 센다. 조문 표시·안긴 표시도 깨지지 않는다
assert.equal(
  insertAfterMarks(`${res(`a ${cs('1')} b`)} ${law('c')} ${cs('2')}`, (k, n) => `[${k}${n}]`),
  `${res(`a ${cs('1')}[case0] b`)}[res0] ${law('c')} ${cs('2')}[case1]`
)
// 조문 점(버튼)이 이미 들어간 html 에도 그대로 들어간다
assert.equal(insertAfterMarks(`${law('x')}<button data-statute="k">✓</button> ${res('y')}`, (k, n) => `[${k}${n}]`),
  `${law('x')}<button data-statute="k">✓</button> ${res('y')}[res0]`)

// ── 2. 최종 판정·요약 ─────────────────────────────────────────
const texts = ['내 답안']
const rec: AiCheckRecord = {
  model: 'm', checkedAt: 1, answerHash: answerHashOf(texts),
  items: {
    [items[0].key]: { verdict: '담김', evidence: '내 답안', note: '' },
    [items[1].key]: { verdict: '누락', evidence: '', note: '' },
    [items[2].key]: { verdict: '확인불가', evidence: '', note: '' },
    [items[3].key]: { verdict: '부분', evidence: '내 답안', note: '' },
    // items[4] 결과 없음 — 세지 않는다
    '옛 항목': { verdict: '담김', evidence: '', note: '' },
  },
}
assert.deepEqual(aiSummary(items, rec), { case: { ok: 1, total: 1 }, res: { ok: 0, total: 3 }, unknown: 1, missing: 1 })

// ── 3. 직접 고친 값 ──────────────────────────────────────────
let r2 = setUserVerdict(rec, items[1].key, '담김')
assert.equal(finalVerdict(r2.items[items[1].key]), '담김')
assert.equal(rec.items[items[1].key].userVerdict, undefined, '원본은 그대로')
assert.ok(hasUserVerdicts(r2))
assert.deepEqual(aiSummary(items, r2).res, { ok: 1, total: 3 })
// 자동 판정과 같은 값이나 되돌리기면 직접 고친 표시가 빠진다(필드째 없어서 Firestore 에 undefined 가 가지 않는다)
r2 = setUserVerdict(r2, items[1].key, '누락')
assert.ok(!('userVerdict' in r2.items[items[1].key]))
r2 = setUserVerdict(setUserVerdict(r2, items[1].key, '부분'), items[1].key)
assert.ok(!('userVerdict' in r2.items[items[1].key]))
assert.ok(!hasUserVerdicts(r2))
assert.equal(setUserVerdict(rec, '없는 키', '담김'), rec)

// ── 4. 오래된 결과 ───────────────────────────────────────────
assert.equal(isAiCheckStale(rec, texts), false)
assert.equal(isAiCheckStale(rec, ['내 답안 고침']), true)

console.log('check:case-ai-check-ui 통과')
