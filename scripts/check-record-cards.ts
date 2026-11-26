/**
 * 기록형 문제 풀기 카드 검증 (check:record-cards).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 *
 * ① parseCaseFile 의 recordCards 분기 ② 저장 형태 왕복 ③ 자가채점 결과·고르기·통계·섞기
 *
 * 실데이터는 환경 변수가 있을 때만 (데이터는 저장소에 두지 않는다):
 *   LAWPASS_CARDS_DIR — 카드-{공법·민사·형사}-{변시·모의}.json 이 든 폴더 (없는 파일은 건너뛴다)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCaseFile } from '../lib/caseStudy/parse'
import { cardsWithSubject, decodeCardsFromStore, encodeCardsForStore, RECORD_CARD_DOC_IDS, type RecordCard, type RecordCardsDoc } from '../lib/record/cardStorage'
import {
  applyResult, drillStats, examChipsOfCards, filterCards, isWrong, orderCards, subjectsOfCards, type DrillResults,
} from '../lib/record/drillProgress'

const J = (o: unknown) => JSON.stringify(o)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const throws = (name: string, o: unknown, msg: string) => assert.throws(() => parseCaseFile(name, J(o)), { message: msg }, `${name}: ${msg}`)

// 배열 안에 배열이 있으면 그 경로
function nestedArrayAt(v: unknown, path = '$', inArray = false): string | null {
  if (Array.isArray(v)) {
    if (inArray) return path
    for (let i = 0; i < v.length; i++) {
      const hit = nestedArrayAt(v[i], `${path}[${i}]`, true)
      if (hit) return hit
    }
    return null
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const hit = nestedArrayAt(x, `${path}.${k}`, false)
      if (hit) return hit
    }
  }
  return null
}

const card = (id: string, kind: '변시' | '모의', exam: string, extra: object = {}): RecordCard => ({
  id, exam: { kind, exam }, label: kind === '변시' ? `${exam}회 변시` : `${exam}모`, note: null, no: 1,
  title: `청구 ${id}`, parties: '<p>원고 김갑동</p>',
  rows: [[{ h: '<p class="al-c"><b>청구</b></p>', rs: 2 }, { h: '<p>취지</p>' }], [{ h: '<p>원인</p>', cs: 1, bg: 'g2' }]],
  ...extra,
}) as RecordCard
const doc: RecordCardsDoc = {
  schema: 1, kind: 'recordCards', id: '카드-민사-변시', subject: '민사', title: '민사 변시 카드',
  cards: [card('b15-1', '변시', '15', { note: '법리 주의', tailH: '<p>소송비용은 피고가 부담한다.</p>' }), card('b2-1', '변시', '2'), card('m26.6-1', '모의', '26.6'), card('m24.10-1', '모의', '24.10')],
}

// ── ① parse ───────────────────────────────────────────────────────
assert.deepEqual(parseCaseFile('카드-민사-변시.json', J(doc)), { kind: 'recordCards', name: '카드-민사-변시.json', cards: doc, warnings: [] })
throws('c.json', { ...doc, id: undefined }, '기록형 카드 id 가 없습니다')
throws('c.json', { ...doc, id: 'a/b' }, "기록형 카드 id 에 '/' 가 들어 있습니다 (a/b)")
throws('c.json', { ...doc, id: '_index' }, "기록형 카드 id 로 '_index' 는 쓸 수 없습니다")
throws('c.json', { ...doc, subject: 1 }, 'subject 가 문자열이 아닙니다')
throws('c.json', { ...doc, cards: [1] }, '카드-민사-변시: cards[0] 가 객체가 아닙니다')
throws('c.json', { ...doc, cards: [{ ...doc.cards[0], label: '' }] }, '카드-민사-변시: cards[0].label 가 없습니다')
throws('c.json', { ...doc, cards: [{ ...doc.cards[0], title: undefined }] }, '카드-민사-변시: cards[0].title 가 없습니다')
throws('c.json', { ...doc, cards: [{ ...doc.cards[0], id: 3 }] }, '카드-민사-변시: cards[0].id 가 없습니다')
throws('c.json', { ...doc, cards: [{ ...doc.cards[0], rows: [{ h: 'x' }] }] }, '카드-민사-변시: cards[0].rows 가 배열의 배열이 아닙니다')
// cards 가 배열이 아니면 카드 분기가 아니다 → 기존 카드 분기(problems 없음)로 떨어져 실패
throws('c.json', { ...doc, cards: 'x' }, 'problems 배열이 없습니다')
// 정리본 문서(items)와 구분된다
const note = { schema: 1, id: '정리-민사-1부', subject: '민사', title: 't', part: '1부', items: [] }
assert.equal(parseCaseFile('정리-민사-1부.json', J(note)).kind, 'note')
assert.equal(parseCaseFile('x.json', J({ ...note, kind: 'recordCards', cards: [] })).kind, 'recordCards', 'kind 가 recordCards 면 카드가 먼저')
assert.equal(parseCaseFile('x.json', J({ ...doc, kind: undefined, items: [] })).kind, 'note', 'kind 가 없으면 카드로 보지 않는다')

// ── ② 저장 형태 ───────────────────────────────────────────────────
const before = clone(doc)
assert.ok(nestedArrayAt(doc), '원본 rows 는 배열의 배열')
const enc = encodeCardsForStore(doc)
assert.equal(nestedArrayAt(enc), null, 'encode 후 배열 안의 배열 없음')
assert.deepEqual(doc, before, 'encode 는 입력을 바꾸지 않는다')
assert.deepEqual(decodeCardsFromStore(clone(enc)), before, '왕복 동일 (cs·rs·bg·tailH·note 포함)')
assert.deepEqual(decodeCardsFromStore(clone(doc)), before, '옛 형태(행이 배열)도 그대로')

// ── ③ 결과·고르기·통계·섞기 ───────────────────────────────────────
let r: DrillResults = {}
r = applyResult(r, 'b15-1', 'x', 100)
assert.deepEqual(r['b15-1'], { last: 'x', tries: 1, wrong: 1, meh: 0, at: 100 })
const r0 = r
r = applyResult(r, 'b15-1', 'h', 200)
assert.deepEqual(r['b15-1'], { last: 'h', tries: 2, wrong: 1, meh: 1, at: 200 })
assert.deepEqual(r0['b15-1'].last, 'x', 'applyResult 는 입력을 바꾸지 않는다')
r = applyResult(r, 'b15-1', 'o', 300)
assert.deepEqual(r['b15-1'], { last: 'o', tries: 3, wrong: 1, meh: 1, at: 300 }, '누적은 남고 마지막만 바뀐다')
r = applyResult(r, 'm26.6-1', 'h', 400)
r = applyResult(r, 'b2-1', 'x', 500)

assert.deepEqual([isWrong(r['b15-1']), isWrong(r['m26.6-1']), isWrong(r['b2-1']), isWrong(undefined)], [false, true, true, false])

const ids = (list: RecordCard[]) => list.map((c) => c.id)
const all = doc.cards
assert.deepEqual(ids(filterCards(all, { kinds: [], exams: [], wrongOnly: false }, r)), ids(all), '조건 없음 → 전부')
assert.deepEqual(ids(filterCards(all, { kinds: ['모의'], exams: [], wrongOnly: false }, r)), ['m26.6-1', 'm24.10-1'])
assert.deepEqual(ids(filterCards(all, { kinds: [], exams: ['변시 2', '모의 26.6'], wrongOnly: false }, r)), ['b2-1', 'm26.6-1'])
assert.deepEqual(ids(filterCards(all, { kinds: [], exams: [], wrongOnly: true }, r)), ['b2-1', 'm26.6-1'], '오답만')
assert.deepEqual(ids(filterCards(all, { kinds: ['변시'], exams: [], wrongOnly: true }, r)), ['b2-1'], '조건은 AND')

assert.deepEqual(examChipsOfCards(all, []), ['변시 2', '변시 15', '모의 24.10', '모의 26.6'], '정리본과 같은 회차 정렬')
assert.deepEqual(examChipsOfCards(all, ['변시']), ['변시 2', '변시 15'])

assert.deepEqual(drillStats(all, r), { o: 1, h: 1, x: 1, none: 1 })
assert.deepEqual(drillStats(all, {}), { o: 0, h: 0, x: 0, none: 4 })

assert.deepEqual(ids(orderCards(all, false, 1)), ['b2-1', 'b15-1', 'm24.10-1', 'm26.6-1'], '섞지 않으면 회차순')
const many = Array.from({ length: 30 }, (_, i) => card(`c${i}`, '변시', String(i + 1)))
const s1 = ids(orderCards(many, true, 42))
assert.deepEqual(ids(orderCards(many, true, 42)), s1, '같은 seed → 같은 순서')
assert.notDeepEqual(ids(orderCards(many, true, 7)), s1, '다른 seed → 다른 순서')
assert.deepEqual([...s1].sort(), ids(many).sort(), '섞어도 카드는 그대로')
assert.notDeepEqual(s1, ids(many), '실제로 섞인다')

// ── 실데이터 (환경 변수가 있을 때만) ──────────────────────────────
const dir = process.env.LAWPASS_CARDS_DIR
if (!dir) {
  console.log('실데이터: 건너뜀 (LAWPASS_CARDS_DIR 미설정)')
} else {
  let n = 0
  let maxBytes = 0
  const found: string[] = []
  for (const id of RECORD_CARD_DOC_IDS) {
    const f = `${id}.json`
    if (!fs.existsSync(`${dir}/${f}`)) continue
    found.push(id)
    const raw: string = fs.readFileSync(`${dir}/${f}`, 'utf8')
    const p = parseCaseFile(f, raw)
    assert.equal(p.kind, 'recordCards', f)
    if (p.kind !== 'recordCards') continue
    const e = encodeCardsForStore(p.cards)
    assert.equal(nestedArrayAt(e), null, `${f}: encode 후 중첩 배열 ${nestedArrayAt(e)}`)
    assert.deepEqual(decodeCardsFromStore(clone(e)), JSON.parse(raw), `${f}: 왕복`)
    const bytes = Buffer.byteLength(JSON.stringify(e))
    assert.ok(bytes <= 900_000, `${f}: ${bytes}B > 900KB`)
    maxBytes = Math.max(maxBytes, bytes)
    n += p.cards.cards.length
  }
  console.log(`실데이터: 묶음 ${found.length}개 · 카드 ${n}장 — 중첩 배열 없음·왕복 동일 (가장 큰 저장 형태 ${Math.round(maxBytes / 1000)}KB)`)
}

console.log('통과: recordCards 가져오기(정상·id·필드 검증·정리본과 구분), 저장 왕복, 채점 반영·오답 판정·고르기·회차 칩·통계·섞기(seed 고정), 과목(붙이기·칩·필터·과목별 현황)')
