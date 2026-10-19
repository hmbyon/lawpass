/**
 * 판례번호 정규화·선고일 파싱·즐겨찾기 key 이전 검증 (check:case-normalize).
 * 테스트 러너가 없어서 replaceContentCheck 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 * caseFavorites 는 localStorage 를 쓰므로 메모리 스텁을 먼저 깐다.
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
g.window = { localStorage: g.localStorage }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeCaseNumber, decidedYear, findCaseMentions, buildCaseDigest } = require('../lib/caseDigest') as typeof import('../lib/caseDigest')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFavoriteCases } = require('../lib/caseFavorites') as typeof import('../lib/caseFavorites')
import type { Question } from '../lib/types'

const key = normalizeCaseNumber

// ── 1. 같은 판례의 표기 변형은 같은 key ─────────────────────────────
const same: [string, string[]][] = [
  ['1995다8713', [
    '95다8713', '95 다 8713', '대법원 95다8713', '대법원 1995. 4. 25. 선고 95다8713 판결',
    '95다8713 판결', '95다8713 전원합의체 판결', '1995다8713',
  ]],
  ['2016다12345', ['2016다12345', '16다12345', '2016 다 12345', '대판 2016.5.12. 2016다12345']],
]
for (const [want, variants] of same) {
  for (const v of variants) assert.equal(key(v), want, `"${v}" → ${want}`)
}

// ── 2. 다른 판례는 다른 key ───────────────────────────────────────
assert.notEqual(key('95다8713'), key('95다8714'))
assert.notEqual(key('95다8713'), key('95누8713'))
assert.notEqual(key('95다8713'), key('1895다8713'))

// ── 3. 실제 사례형 판례 표기 ──────────────────────────────────────
const real: [string, string][] = [
  ['95다8713', '1995다8713'],
  ['62다801', '1962다801'],
  ['2016다12345', '2016다12345'],
  ['2009다35842', '2009다35842'],
  ['1989다카3240', '1989다카3240'],
  ['89다카3240', '1989다카3240'],
  ['2022그779', '2022그779'],
]
for (const [input, want] of real) assert.equal(key(input), want, `${input} → ${want}`)

// ── 4. 2자리 연도 경계 (00~29 → 20xx, 30~99 → 19xx) ────────────────
assert.equal(key('00다1'), '2000다1')
assert.equal(key('29다1'), '2029다1')
assert.equal(key('30다1'), '1930다1')
assert.equal(key('99다1'), '1999다1')

// ── 5. 연도 앞이 숫자면 연도로 보지 않는다 / 형식 밖 표기는 공백만 지운다 ──
assert.equal(key('123다45'), '123다45') // 3자리 숫자는 사건번호가 아니다 → 원문(공백 제거)
assert.equal(key('2005.01.28.'), '2005.01.28.') // 선고일이 사건번호 자리에 잘못 들어간 실데이터
assert.equal(key('2017도16593-1'), '2017도16593') // 기존(4자리) 동작 그대로
assert.equal(key('2007다37394, 37400'), '2007다37394') // 병합 사건은 앞 번호 — 기존 동작 그대로
// 정규화는 멱등이어야 한다(즐겨찾기 이전이 이것에 기댄다)
for (const v of ['95다8713', '2016다12345', '2005.01.28.', '대법원 95다8713 판결']) assert.equal(key(key(v)), key(v))

// ── 6. 본문 발췌 위치(caseNumberAt)도 같은 규칙 ─────────────────────
const q = (explanation: string) => ({ id: 'q', no: 1, explanation, choices: [] }) as unknown as Question
const m1 = findCaseMentions(q('甲의 청구는 이유 없다(대법원 1995. 4. 25. 선고 95다8713 판결).'), '1995다8713')
assert.equal(m1.length, 1, '2자리 연도 판례를 본문에서 찾는다')
const m2 = findCaseMentions(q('앞 판례는 2016다12345, 뒤 판례는 95 다 8713 이다.'), '95다8713')
assert.equal(m2.length, 1, '두 번째로 인용된 2자리 연도 판례도 찾는다')
assert.ok(m2[0].text.includes('95 다 8713'))
const m3 = findCaseMentions(q('같은 해 2016다12345 판결'), '16다12345')
assert.equal(m3.length, 1, '줄여 쓴 key 로 4자리 본문을 찾는다')
// 형식 밖 표기는 기존 느슨한 검색으로 넘어간다
const m4 = findCaseMentions(q('선고일 2005. 01. 28. 판결 참조'), '2005.01.28.')
assert.equal(m4.length, 1, '형식 밖 표기는 글자 사이 공백을 허용해 찾는다')

// ── 7. 선고일 세 형식 (decidedYear 는 첫 4자리 숫자를 연도로 읽는다) ───
assert.equal(decidedYear('2009.05.28.'), 2009) // (a)
assert.equal(decidedYear('2010. 7. 22.'), 2010) // (b)
assert.equal(decidedYear('2003. 6. 13. 선고'), 2003) // (c)
assert.equal(decidedYear('1997.07.25'), 1997) // 실데이터의 끝 마침표 없는 표기
assert.equal(decidedYear(''), null)
assert.equal(decidedYear(undefined), null)

// ── 8. buildCaseDigest: 표기 변형이 한 판례로 모인다 ──────────────────
const ref = (caseNumber: string) => ({ caseNumber, summary: '요지', decidedDate: '1995. 4. 25.' })
const dq = (id: string, caseNumber: string) => ({ id, no: 1, subject: '민법', cases: [ref(caseNumber)] }) as unknown as Question
const digest = buildCaseDigest([dq('a', '95다8713'), dq('b', '대법원 95다8713 판결'), dq('c', '1995다8713')])
assert.equal(digest.totalGroups, 1)
assert.equal(digest.groups[0].count, 3)

// ── 9. 즐겨찾기 key 이전 (멱등) ───────────────────────────────────
const FAV = 'lawpass_fav_cases_law'
mem.set(FAV, JSON.stringify(['95다8713', '1995다8713', '대법원95다8713판결', '2016다12345', '2005.01.28.']))
const first = readFavoriteCases('law')
assert.deepEqual([...first].sort(), ['1995다8713', '2005.01.28.', '2016다12345'].sort())
const savedOnce = mem.get(FAV)
assert.deepEqual(JSON.parse(savedOnce as string).sort(), [...first].sort(), '이전한 key 를 저장한다')
const second = readFavoriteCases('law')
assert.deepEqual([...second].sort(), [...first].sort(), '다시 읽어도 같다')
assert.equal(mem.get(FAV), savedOnce, '두 번째 읽기는 저장소를 바꾸지 않는다')
// 이미 새 key 뿐이면 쓰지 않는다
mem.set(FAV, JSON.stringify(['2016다12345', '1995다8713']))
let writes = 0
const realSet = (g.localStorage as { setItem: (k: string, v: string) => void }).setItem
;(g.localStorage as { setItem: (k: string, v: string) => void }).setItem = (k, v) => { writes++; realSet(k, v) }
readFavoriteCases('law')
assert.equal(writes, 0, '새 key 만 있으면 저장하지 않는다')

console.log('통과: 판례번호 정규화·발췌 위치·선고일 세 형식·즐겨찾기 key 이전')
