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
  cardMonth, cardYear, filterByCbt, recentYears, selectableOf, sortCardsForList, subjectGroupsOfCards, unsolvedCards, yearOptionsOf,
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

// 과목: 묶음의 subject 를 카드에 붙이고, 과목 조건으로 고른다
const crim: RecordCardsDoc = {
  schema: 1, kind: 'recordCards', id: '카드-형사-변시', subject: '형사', title: '형사 변시 카드',
  cards: [card('형사-변시-15-1', '변시', '15'), card('형사-모의-24.6-1', '모의', '24.6')],
}
const pub: RecordCardsDoc = { ...crim, id: '카드-공법-변시', subject: '공법', cards: [card('공법-변시-15-소장-취소', '변시', '15')] }
const merged = cardsWithSubject([doc, crim, pub])
assert.equal(merged.length, 7)
assert.deepEqual([...new Set(merged.map((c) => c.subject))], ['민사', '형사', '공법'])
assert.ok(!('subject' in doc.cards[0]), 'cardsWithSubject 는 입력을 바꾸지 않는다')
assert.deepEqual(subjectsOfCards(merged), ['공법', '민사', '형사'], '과목 칩 순서')
assert.deepEqual(subjectsOfCards(cardsWithSubject([crim])), ['형사'], '카드가 있는 과목만')
assert.deepEqual(ids(filterCards(merged, { subjects: ['형사'], kinds: [], exams: [], wrongOnly: false }, r)), ['형사-변시-15-1', '형사-모의-24.6-1'])
assert.deepEqual(ids(filterCards(merged, { subjects: ['형사', '공법'], kinds: ['변시'], exams: [], wrongOnly: false }, r)), ['형사-변시-15-1', '공법-변시-15-소장-취소'], '과목은 합집합, 다른 조건과 AND')
assert.deepEqual(ids(filterCards(merged, { subjects: [], kinds: [], exams: ['변시 15'], wrongOnly: false }, r)), ['b15-1', '형사-변시-15-1', '공법-변시-15-소장-취소'], '과목 없음 → 전부')
assert.equal(filterCards(merged, { kinds: [], exams: [], wrongOnly: false }, r).length, 7, 'subjects 필드가 없어도 전부')
assert.deepEqual(ids(filterCards(merged, { subjects: ['민사'], kinds: [], exams: [], wrongOnly: true }, r)), ['b2-1', 'm26.6-1'], '민사 결과는 그대로 남는다')
assert.deepEqual(drillStats(filterCards(merged, { subjects: ['형사'], kinds: [], exams: [], wrongOnly: false }, r), r), { o: 0, h: 0, x: 0, none: 2 }, '과목별 현황')
assert.deepEqual(examChipsOfCards(filterCards(merged, { subjects: ['형사'], kinds: [], exams: [], wrongOnly: false }, r), []), ['변시 15', '모의 24.6'], '과목별 회차 칩')
assert.equal(RECORD_CARD_DOC_IDS.length, 6)

// ── 시작 화면 필터 (사례형 CBT 와 같은 규칙) ─────────────────────
const cbt = cardsWithSubject([
  { ...doc, cards: [card('민사-변시-15-1', '변시', '15'), card('민사-변시-2-1', '변시', '2'), card('민사-모의-26.6-1', '모의', '26.6'), card('민사-모의-24.10-1', '모의', '24.10'), card('민사-모의-24.3-1', '모의', '24.3')] },
  { ...crim, cards: [card('형사-변시-14-1', '변시', '14'), card('형사-모의-25.8-1', '모의', '25.8')] },
  { ...pub, cards: [card('공법-변시-15-소장', '변시', '15'), card('공법-x', '변시', '가')] },
])
// 연도·월: CBT 의 examYear·mockMonth 와 같다
assert.deepEqual(cbt.map(cardYear), ['2026', '2013', '2026', '2024', '2024', '2025', '2025', '2026', null])
assert.deepEqual(cbt.map(cardMonth), [null, null, '6모', '10모', null, null, '8모', null, null], '6·8·10 이 아닌 모의(24.3)는 회차가 없다')
// 과목 묶음: 민사법 → 형사법 → 공법, 카드가 있는 과목만
assert.deepEqual(subjectGroupsOfCards(cbt), [{ label: '민사법', subjects: ['민사'] }, { label: '형사법', subjects: ['형사'] }, { label: '공법', subjects: ['공법'] }])
assert.deepEqual(subjectGroupsOfCards(cardsWithSubject([crim])), [{ label: '형사법', subjects: ['형사'] }])
// 과목을 안 골랐으면 시험 유형·회차·연도 칩이 모두 회색
assert.deepEqual(selectableOf(cbt, []), { kinds: [], months: [], years: [] }, '과목 미선택 → 고를 수 있는 것 없음')
assert.deepEqual(selectableOf(cbt, ['형사']), { kinds: ['변시', '모의'], months: ['8모'], years: ['2025'] })
assert.deepEqual(selectableOf(cbt, ['공법']), { kinds: ['변시'], months: [], years: ['2026'] }, '연도를 못 읽은 카드는 연도 후보가 아니다')
// 연도 후보·최근 N개년
assert.deepEqual(yearOptionsOf(cbt), ['2026', '2025', '2024', '2013'])
assert.deepEqual(recentYears(yearOptionsOf(cbt), ['2026', '2024', '2013'], 3), ['2026', '2024'], '최근 3개년 중 고를 수 있는 것만')
assert.deepEqual(recentYears(yearOptionsOf(cbt), ['2026'], 1), ['2026'])
const keys = (f: Parameters<typeof filterByCbt>[1]) => ids(filterByCbt(cbt, f))
const none = { subjects: [], kinds: [], months: [], years: [] }
assert.equal(keys(none).length, cbt.length, '필터 없음 → 전체')
assert.deepEqual(keys({ ...none, subjects: ['형사', '공법'] }), ['형사-변시-14-1', '형사-모의-25.8-1', '공법-변시-15-소장', '공법-x'])
// 모의 월: 모의를 골랐을 때 모의 카드에만, 월을 못 읽은 모의 카드는 거르지 않는다
assert.deepEqual(keys({ ...none, subjects: ['민사'], kinds: ['모의'], months: ['6모'] }), ['민사-모의-26.6-1', '민사-모의-24.3-1'])
assert.deepEqual(keys({ ...none, subjects: ['민사'], kinds: ['변시'], months: ['6모'] }), ['민사-변시-15-1', '민사-변시-2-1'], '모의를 안 고르면 월은 무시')
assert.deepEqual(keys({ ...none, subjects: ['민사'], kinds: ['변시', '모의'], months: ['10모'] }), ['민사-변시-15-1', '민사-변시-2-1', '민사-모의-24.10-1', '민사-모의-24.3-1'], '변시 카드는 월에 걸리지 않는다')
// 연도: 연도를 못 읽은 카드는 연도를 고르면 빠진다
assert.deepEqual(keys({ ...none, years: ['2026'] }), ['민사-변시-15-1', '민사-모의-26.6-1', '공법-변시-15-소장'])
assert.deepEqual(keys({ ...none, subjects: ['공법'], years: ['2026'] }), ['공법-변시-15-소장'], "연도 없는 '공법-x' 는 빠진다")
// 안 푼 카드 = 결과 문서에 결과가 없는 카드
const solvedR = applyResult(applyResult({}, '민사-변시-15-1', 'o', 1), '형사-모의-25.8-1', 'x', 2)
assert.deepEqual(ids(unsolvedCards(filterByCbt(cbt, { ...none, subjects: ['민사', '형사'] }), solvedR)), ['민사-변시-2-1', '민사-모의-26.6-1', '민사-모의-24.10-1', '민사-모의-24.3-1', '형사-변시-14-1'], '틀린 카드도 푼 카드다')
assert.equal(unsolvedCards(cbt, {}).length, cbt.length)
// 목록 순서(CBT 와 같다): 변시 회차 오름차순 → 모의 최신순, 같은 회차는 공법 → 형사 → 민사
assert.deepEqual(ids(sortCardsForList(cbt)), [
  '민사-변시-2-1', '형사-변시-14-1', '공법-변시-15-소장', '민사-변시-15-1', '공법-x',
  '민사-모의-26.6-1', '형사-모의-25.8-1', '민사-모의-24.10-1', '민사-모의-24.3-1',
])

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

console.log('통과: recordCards 가져오기(정상·id·필드 검증·정리본과 구분), 저장 왕복, 채점 반영·오답 판정·고르기·회차 칩·통계·섞기(seed 고정), 과목(붙이기·칩·필터·과목별 현황), CBT 필터(과목 묶음·미선택 회색·모의 월·연도·최근 N개년·안 푼 카드·목록 순서)')
