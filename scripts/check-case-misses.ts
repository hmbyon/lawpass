/**
 * 사례형 오답노트 집계(lib/caseStudy/misses) 검증 (check:case-misses). 가짜 시도·가짜 카드, Firestore 없음.
 * CASE_JSON_DIR(카드 JSON 폴더)이나 아래 기본 폴더가 있으면 실제 카드 전체로도 집계를 돌려 본다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractAiItems } from '../lib/caseStudy/aiCheck'
import { aggregateMisses, cardIdsOf, filterMisses, missTree, sortMisses, type MissItem } from '../lib/caseStudy/misses'
import type { AiVerdict, CaseAttempt, StatuteMark } from '../lib/caseStudy/solve'
import type { Card } from '../lib/caseStudy/types'

const law = (s: string) => `<mark class="law">${s}</mark>`
const cs = (s: string) => `<mark class="case">${s}</mark>`
const res = (s: string) => `<mark class="res">${s}</mark>`

const body1 = `임차인은 ${law('민법 제626조')}에 따라 청구한다. 유익비 상환범위는 임대인이 선택한다(${cs('2001다40381')}). 따라서 ${res('乙은 상환할 필요가 없다')}.`
const body2 = `${law('형법 제250조')}의 살인죄는 ${res('성립한다')}.`
const card = (id: string, subject: string, title: string, order: number, body: string): Card =>
  ({
    schema: 1, id, subject, category: '', chapter: '', order: [order, 1], title, pages: '', meta: '', notes: [], source: '',
    cases: [], statutes: [],
    problems: [{
      id: `${id}#1`, kind: '변시', exam: 15, examLabel: '', qno: '제1문', sub: '문1', points: 30,
      question: { paragraphs: [], ask: '물음' },
      answer: { source: '', blocks: [{ t: 'h2', html: '1. 쟁점' }, { t: 'p', html: body }] },
    }],
  }) as Card
// 순서를 뒤집어 넘겨도 과목 순서(민법 → 형법)로 나와야 한다
const cards = [card('형사-1', '형법', '살인', 1, body2), card('민사-1', '민법', '유익비', 1, body1)]
const P1 = '민사-1#1'
const P2 = '형사-1#1'
const [caseKey, resKey] = extractAiItems(['1. 쟁점', body1]).map((x) => x.key)
const [res2Key] = extractAiItems(['1. 쟁점', body2]).map((x) => x.key)
const S626 = '민법|626|||'
const S250 = '형법|250|||'

const DAY = 86_400_000
const NOW = 100 * DAY
type Ai = Record<string, AiVerdict | [AiVerdict, AiVerdict]> // [자동, 직접 고친 값]
function att(
  id: string, at: number, pid: string, box: string,
  opt: { ai?: Ai; manual?: Record<string, StatuteMark>; draft?: boolean } = {}
): CaseAttempt {
  const items = Object.fromEntries(
    Object.entries(opt.ai ?? {}).map(([k, v]) => {
      const [verdict, user] = Array.isArray(v) ? v : [v, undefined]
      return [k, { verdict, evidence: verdict === '누락' ? '' : box, note: `${id} note`, ...(user ? { userVerdict: user } : {}) }]
    })
  )
  return {
    id, setKey: pid, problemIds: [pid], answers: [{ problemId: pid, boxes: [box] }],
    status: opt.draft ? 'draft' : 'submitted', elapsedSeconds: 0, targetMinutes: null,
    startedAt: at, updatedAt: at, submittedAt: opt.draft ? null : at,
    ...(opt.manual ? { statuteChecks: { [pid]: { auto: {}, manual: opt.manual } } } : {}),
    ...(opt.ai ? { aiChecks: { [pid]: { model: 'm', checkedAt: at, answerHash: '', items } } } : {}),
  }
}

const find = (r: { items: MissItem[] }, pid: string, key: string) => r.items.find((x) => x.problemId === pid && x.key === key)

// ── 1. 한 번 빠짐 · 형식 ───────────────────────────────────────
let r = aggregateMisses([att('a1', NOW - 40 * DAY, P1, '답안 글', { ai: { [caseKey]: '누락', [resKey]: '담김' } })], cards)
let s = find(r, P1, S626)!
assert.deepEqual(s, {
  problemId: P1, key: S626, kind: 'statute', subject: '민법', cardId: '민사-1', cardTitle: '유익비', problemLabel: '변시 15회 제1문 문1',
  label: '민법 제626조', text: body1.replace(/<[^>]+>/g, ''), missCount: 1, missAttemptIds: ['a1'], lastMissedAt: NOW - 40 * DAY, lastVerdict: 'missing', recentOk: false,
  evidence: '', note: '답안에 해당 조문이 없음',
}, '조문 없음 — 시도에 statuteChecks 가 없어도 화면처럼 자동 판정으로 센다')
const c = find(r, P1, caseKey)!
assert.equal(c.kind, 'case')
assert.equal(c.label, '판례 취지')
assert.match(c.text, /^유익비 상환범위는/)
assert.equal(c.note, 'a1 note')
assert.equal(find(r, P1, resKey), undefined, '한 번도 빠진 적 없는 항목은 목록에 없다')
assert.equal(r.recentOk, 0)
assert.equal(r.excluded, 0)

// ── 2. 여러 번 빠짐 · 해소 · ✓ 뒤 다시 ✕ · 확인불가 · 직접 고친 값 · 임시저장 ─────────
const attempts = [
  // 넣는 순서가 섞여도 제출 시각 순으로 본다
  att('a3', NOW - 2 * DAY, P1, '민법 제626조를 쓴 답안', { ai: { [caseKey]: '담김', [resKey]: '부분' } }),
  att('a1', NOW - 40 * DAY, P1, '답안 글', { ai: { [caseKey]: '누락', [resKey]: '담김' } }),
  att('a2', NOW - 20 * DAY, P1, '답안 글 2', { ai: { [caseKey]: '부분', [resKey]: '담김' } }),
  // 가장 최근이지만 확인불가 → 건너뛴다
  att('a4', NOW - 1 * DAY, P1, '민법 제626조를 쓴 답안', { ai: { [caseKey]: '확인불가', [resKey]: '확인불가' } }),
  // 임시저장은 빼고 본다
  att('d1', NOW, P1, '', { draft: true, ai: { [caseKey]: '누락', [resKey]: '누락' } }),
  // 형법: 자동 판정은 없음이지만 직접 고친 값 ok, AI 결론은 누락이지만 직접 고친 값 부분
  att('b1', NOW - 10 * DAY, P2, '살인죄 성립', { manual: { [S250]: 'ok' }, ai: { [res2Key]: ['누락', '부분'] } }),
]
r = aggregateMisses(attempts, cards)
// 조문 626: a1 ✕, a2 ✕, a3 ✓, a4 ✓ → 목록에 남고(누적 2회) 최근 ✓
const s626 = find(r, P1, S626)!
assert.equal(s626.missCount, 2)
assert.deepEqual(s626.missAttemptIds, ['a1', 'a2'])
assert.equal(s626.recentOk, true)
assert.equal(s626.lastMissedAt, NOW - 20 * DAY)
assert.equal(s626.lastVerdict, 'missing')
assert.equal(s626.lastOkAt, NOW - 1 * DAY)
assert.equal(s626.note, '최근 답안에는 해당 조문이 있음')
// 판례: a1 ✕, a2 △, a3 ✓ (a4 확인불가 건너뜀) → 남고 최근 ✓, 마지막으로 빠진 판정은 △
const ck = find(r, P1, caseKey)!
assert.equal(ck.recentOk, true)
assert.equal(ck.missCount, 2)
assert.equal(ck.lastVerdict, 'partial')
assert.equal(ck.evidence, '민법 제626조를 쓴 답안', '근거는 가장 최근 유효 판정(✓)의 것')
// 결론: a1 ✓, a2 ✓, a3 △ (a4 확인불가) → 다시 빠짐
const rr = find(r, P1, resKey)!
assert.equal(rr.recentOk, false)
assert.equal(rr.missCount, 1)
assert.equal(rr.lastVerdict, 'partial')
assert.equal(rr.lastMissedAt, NOW - 2 * DAY)
assert.equal(rr.lastOkAt, NOW - 20 * DAY)
assert.equal(rr.evidence, '민법 제626조를 쓴 답안', '근거는 가장 최근 유효 판정의 것')
assert.equal(rr.note, 'a3 note')
assert.equal(find(r, P2, S250), undefined, '직접 고친 값(ok)이 자동 판정(없음)보다 앞선다')
assert.equal(find(r, P2, res2Key)!.lastVerdict, 'partial', '직접 고친 값(부분)')
assert.deepEqual(r.items.map((x) => x.key), [S626, caseKey, resKey, res2Key], '과목 순서(민법 → 형법), 문항 안은 조문 → 판례·결론')
assert.equal(r.recentOk, 2)

// 여러 번 빠짐: a1·a2 모두 판례 ✕·△, a3 없이 보면 missCount 2, 최근 시각은 a2
r = aggregateMisses(attempts.filter((a) => a.id === 'a1' || a.id === 'a2'), cards)
assert.equal(find(r, P1, caseKey)!.missCount, 2)
assert.equal(find(r, P1, caseKey)!.lastVerdict, 'partial')
assert.equal(find(r, P1, caseKey)!.lastMissedAt, NOW - 20 * DAY)
assert.equal(find(r, P1, caseKey)!.lastOkAt, undefined)
assert.ok(!('lastOkAt' in find(r, P1, caseKey)!))
assert.equal(find(r, P1, S626)!.missCount, 2)

// ── 3. 카드가 바뀌어 사라진 키 · 사라진 문항 ─────────────────────
r = aggregateMisses([
  att('x1', NOW, P1, '답안', {
    manual: { '민법|999|||': 'missing', '민법|998|||': 'ok' },
    ai: { 'a1@old:res:0-5': '누락', 'a1@old:case:0-5': '담김', [caseKey]: '담김', [resKey]: '담김' },
  }),
  att('x2', NOW, '없는-카드#1', '답안', { ai: { 'a0@zz:res:0-3': '부분' } }),
  // 옛 판례: 예전에 빠졌다가 지금은 담김 — 한 번이라도 빠졌으니 센다
  att('x0', NOW - DAY, P1, '답안', { ai: { 'a1@old:case:0-5': '누락' } }),
], cards)
assert.deepEqual(r.items.map((x) => x.key), [S626], '현재 카드에 있는 것만')
assert.equal(r.excluded, 4, '한 번이라도 빠졌는데 키를 못 찾은 것: 조문 999, 옛 결론, 옛 판례, 없는 카드의 결론')
assert.equal(attempts[0].aiChecks![P1].items[caseKey].verdict, '담김', '입력은 건드리지 않는다')

// ── 4. 정렬 · 필터 · 트리 ──────────────────────────────────────
const items = aggregateMisses([
  att('a1', NOW - 40 * DAY, P1, '답안', { ai: { [caseKey]: '누락' } }),
  att('a2', NOW - 20 * DAY, P1, '답안', { ai: { [caseKey]: '누락' } }),
  att('b1', NOW - 3 * DAY, P2, '답안', { ai: { [res2Key]: '누락' } }),
], cards).items
assert.deepEqual(items.map((x) => x.key), [S626, caseKey, S250, res2Key])
assert.deepEqual(sortMisses(items).map((x) => x.key), [S250, res2Key, S626, caseKey])
assert.deepEqual(sortMisses(items, 'count').map((x) => [x.key, x.missCount]), [[S626, 2], [caseKey, 2], [S250, 1], [res2Key, 1]])
assert.deepEqual(items.map((x) => x.key), [S626, caseKey, S250, res2Key], '정렬은 새 배열')
assert.deepEqual(filterMisses(items, { subject: '형법' }).map((x) => x.key), [S250, res2Key])
assert.deepEqual(filterMisses(items, { kind: 'case' }).map((x) => x.key), [caseKey])
assert.deepEqual(filterMisses(items, { period: 7, now: NOW }).map((x) => x.key), [S250, res2Key])
assert.deepEqual(filterMisses(items, { period: 30, now: NOW }).map((x) => x.key), [S626, caseKey, S250, res2Key])
assert.equal(filterMisses(items, { period: 'all' }).length, 4)
assert.deepEqual(filterMisses(items, { subject: '민법', kind: 'statute', period: 7, now: NOW }), [])
const tree = missTree(items)
assert.deepEqual(tree.map((t) => [t.subject, t.cards.map((c) => [c.cardId, c.problems.map((p) => [p.problemLabel, p.items.length])])]), [
  ['민법', [['민사-1', [['변시 15회 제1문 문1', 2]]]]],
  ['형법', [['형사-1', [['변시 15회 제1문 문1', 2]]]]],
])
assert.deepEqual(cardIdsOf(attempts), ['민사-1', '형사-1'])
assert.deepEqual(aggregateMisses([], cards), { items: [], recentOk: 0, excluded: 0 })

// ── 5. 실제 카드 데이터 ─────────────────────────────────────────
const DEFAULT_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
)
const dir = process.env.CASE_JSON_DIR || DEFAULT_DIR
if (!fs.existsSync(dir)) {
  console.log(`카드 JSON 폴더가 없어 실제 데이터 점검은 건너뜀 (${dir})`)
} else {
  const real: Card[] = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json') && n !== '_index.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepEqual(aggregateMisses([], real), { items: [], recentOk: 0, excluded: 0 }, '시도가 없으면 빈 결과')
  // 답안이 있는 모든 문항을 빈 답안으로 한 번씩 제출했다고 치면: 조문은 전부 빠짐, AI 는 점검 안 해서 없음
  const pids = real.flatMap((cd) => cd.problems.filter((p) => p.answer?.blocks.length).map((p) => p.id))
  const all = aggregateMisses(pids.map((pid, i) => att(`r${i}`, i, pid, '')), real)
  assert.ok(all.items.every((x) => x.kind === 'statute' && x.text && x.label))
  assert.equal(all.excluded, 0)
  console.log(`실제 카드 ${real.length}장 · 문항 ${pids.length}개 · 빈 답안이면 빠진 조문 ${all.items.length}개 · 트리 과목 ${missTree(all.items).map((t) => t.subject).join('·')}`)
}

console.log('check:case-misses 통과')
