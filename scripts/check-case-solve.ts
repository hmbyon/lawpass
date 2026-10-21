/**
 * 사례형 풀이의 소문항 나누기(splitAsk) 검증 (check:case-solve).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다
 */
import assert from 'node:assert/strict'
import { formatElapsed, splitAsk } from '../lib/caseStudy/solve'

// ── 1. 배점이 하나면 칸 하나 (앞머리 번호가 있어도 나누지 않는다) ─────────
assert.deepEqual(splitAsk('1. 甲의 헌법소원심판청구의 적법성을 검토하시오. (30점)', 30), [
  { label: '', points: 30, text: '1. 甲의 헌법소원심판청구의 적법성을 검토하시오. (30점)' },
])
assert.equal(splitAsk('甲, 乙, 丙의 죄책은? (29점)', 29).length, 1)
// 물음 안의 '(1)' 은 배점이 하나뿐이면 나누지 않는다
assert.equal(splitAsk('사례 (2)에서 다음 물음에 답하시오. (1)乙은 … 설명하시오. (8점)', 8).length, 1)
// 배점 표기가 없으면 문항 배점을 쓴다
assert.deepEqual(splitAsk('항소심법원의 판결은 타당한가?', 15), [{ label: '', points: 15, text: '항소심법원의 판결은 타당한가?' }])

// ── 2. (1)(2)(3) ──────────────────────────────────────────────
const a = splitAsk('(1) 무죄판결을 선고할 수 있는가? (15점) (2) 유죄로 인정할 수 있는가? (15점) (3) 어떠한 조치를 취해야 하는가? (15점)', 45)
assert.deepEqual(a.map((b) => [b.label, b.points]), [['(1)', 15], ['(2)', 15], ['(3)', 15]])
assert.equal(a[1].text, '(2) 유죄로 인정할 수 있는가? (15점)')

// ── 3. 가. 나. / ① ② (앞의 공통 머리말은 첫 칸에 붙는다) ─────────────
assert.deepEqual(
  splitAsk('가. 요건을 갖춘 것인가? (15점) 나. 인용될 수 있는가? (20점)', 35).map((b) => [b.label, b.points]),
  [['가.', 15], ['나.', 20]]
)
const c = splitAsk('2) ① 과실 여부를 검토하시오. (5점) ② 인과관계를 검토하시오. (10점)', 15)
assert.deepEqual(c.map((b) => [b.label, b.points]), [['①', 5], ['②', 10]])

// ── 4. 마지막 배점 뒤 단서는 마지막 칸에 남는다 ──────────────────────
const d = splitAsk('(1) 첫째 (10점) (2) 둘째 (20점) (평등권은 논외로 함)', 30)
assert.equal(d[1].text, '(2) 둘째 (20점) (평등권은 논외로 함)')

// ── 5. 머리 물음에도 배점이 붙은 경우: 문항 배점에 맞게 머리 칸을 첫 소문항에 붙인다 ──
const e = splitAsk('1. 적법성을 검토하시오. (20점) (1) 대상성 (10점) (2) 관련성 (10점)', 20)
assert.deepEqual(e.map((b) => [b.label, b.points]), [['(1)', 10], ['(2)', 10]])
assert.equal(e[0].text, '1. 적법성을 검토하시오. (20점) (1) 대상성 (10점)')
// 머리 칸을 붙이고 나니 한 칸만 남으면 나누지 않은 것과 같다
const f = splitAsk('4. 공통 물음 (30점) (2) 이 사건 규정은 위헌인가? (10점)', 10)
assert.equal(f.length, 1)
assert.deepEqual([f[0].label, f[0].points], ['', 10])

// ── 6. 시간 표기 ───────────────────────────────────────────────
assert.equal(formatElapsed(0), '00:00')
assert.equal(formatElapsed(65), '01:05')
assert.equal(formatElapsed(3725), '1:02:05')

console.log('check:case-solve 통과')
