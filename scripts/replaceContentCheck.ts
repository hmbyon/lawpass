/**
 * addQuestions 의 replaceContent(가져온 JSON 으로 내용 교체) 회귀 검증.
 * 테스트 러너가 없어서 parseReviewCheck 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다 (check:replace-content).
 * store.ts 는 localStorage 를 쓰므로 메모리 스텁을 먼저 깐다.
 */
import assert from 'node:assert/strict'

const mem = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
g.window = { localStorage: g.localStorage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} }
g.CustomEvent = class {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('../lib/store') as typeof import('../lib/store')
import type { Question } from '../lib/types'

const STEM =
  '다음 사례에 관한 설명 중 옳은 것(○)과 옳지 않은 것(×)을 올바르게 조합한 것은? 甲은 목욕탕을 건축하기 위하여 관할 행정청인 乙에게 토지형질변경신청 및 건축허가신청을 하였는데, 乙은 거부처분을 하였다. 甲은 위 거부처분에 대한 취소소송을 제기하여 승소판결을 받았다.'
const CH = ['ㄱ(○), ㄴ(×), ㄷ(○)', 'ㄱ(○), ㄴ(×), ㄷ(×)', 'ㄱ(×), ㄴ(○), ㄷ(○)', 'ㄱ(×), ㄴ(×), ㄷ(○)', 'ㄱ(×), ㄴ(○), ㄷ(×)']
const mk = (over: Partial<Question> & { id: string }): Question =>
  ({
    no: 38, subject: '행정법', examType: '모의고사', year: 2026, unit: '행정구제법',
    passage: STEM + '\n\nㄱ. 옛 보기 하나', answer: '①', explanation: '옛 해설',
    choices: ['①', '②', '③', '④', '⑤'].map((label, i) => ({ label, text: CH[i] })),
    addedAt: 1, ...over,
  }) as Question

function reset(list: Question[]) {
  mem.clear()
  store.saveQuestions(list)
}
const get = () => store.getQuestions()

// 1) 지문 같고 해설만 바뀜 — 옵션 없이는 옛 해설이 그대로(기존 동작), 켜면 교체
reset([mk({ id: 'old' })])
let r = store.addQuestions([mk({ id: 'new', explanation: '새 해설' })], 'src')
assert.equal(get().length, 1); assert.equal(get()[0].explanation, '옛 해설'); assert.equal(r.replaced, 0)
r = store.addQuestions([mk({ id: 'new', explanation: '새 해설' })], 'src', undefined, { replaceContent: true })
assert.equal(get().length, 1); assert.equal(get()[0].explanation, '새 해설'); assert.equal(r.replaced, 1)
assert.equal(get()[0].id, 'old', 'id 유지')
assert.deepEqual(get()[0].explanations, ['새 해설'])

// 2) 보기가 통째로 바뀐 문제(38번 유형) — 같은 문제로 알아보고 교체, 새 문제가 늘지 않는다
reset([mk({ id: 'old', images: ['img1'] })])
r = store.addQuestions(
  [mk({ id: 'new', passage: STEM + '\n\nㄱ. 전혀 다른 새 보기', explanation: '새 해설', subItems: [{ label: 'ㄱ', text: '새 보기', isCorrect: true }] as never })],
  'src', undefined, { replaceContent: true }
)
assert.equal(get().length, 1, '새 문제가 더 쌓이면 안 됨'); assert.equal(r.added, 0); assert.equal(r.replaced, 1)
assert.ok(get()[0].passage.includes('전혀 다른 새 보기')); assert.equal(get()[0].subItems?.[0].text, '새 보기')
assert.deepEqual(get()[0].images, ['img1'], '첨부 이미지 유지')
// 옵션이 꺼져 있으면 38번 유형은 새 문제로 쌓인다(기존 동작)
reset([mk({ id: 'old' })])
r = store.addQuestions([mk({ id: 'new', passage: STEM + '\n\nㄱ. 전혀 다른 새 보기' })], 'src')
assert.equal(get().length, 2)

// 3) 발문은 같지만 선지가 다른 문제는 다른 문제 — 교체하면 안 된다
reset([mk({ id: 'old' })])
r = store.addQuestions(
  [mk({ id: 'other', passage: STEM + '\n\nㄱ. 다른 문제', choices: ['①', '②', '③', '④', '⑤'].map((label, i) => ({ label, text: `전혀 다른 선지 ${i}번 내용` })) })],
  'src', undefined, { replaceContent: true }
)
assert.equal(get().length, 2); assert.equal(r.replaced, 0); assert.equal(get()[0].explanation, '옛 해설')

// 4) 가져온 쪽에 해설이 없으면 기존 해설을 지우지 않는다
reset([mk({ id: 'old' })])
store.addQuestions([mk({ id: 'new', explanation: null })], 'src', undefined, { replaceContent: true })
assert.equal(get()[0].explanation, '옛 해설')

// 5) 후보가 둘이면(애매) 새 문제로 둔다 — 엉뚱한 문제를 덮어쓰지 않는다
reset([mk({ id: 'a', passage: STEM + '\n\nㄱ. A' }), mk({ id: 'b', passage: STEM + '\n\nㄱ. B' })])
r = store.addQuestions([mk({ id: 'c', passage: STEM + '\n\nㄱ. C' })], 'src', undefined, { replaceContent: true })
assert.equal(get().length, 3); assert.equal(r.added, 1); assert.equal(r.replaced, 0)

console.log('replaceContent 검증 통과')
