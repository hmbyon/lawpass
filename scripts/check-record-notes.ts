/**
 * 기록형 정리본 검증 (check:record-notes).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 *
 * ① sanitizeNote — node 에는 DOMParser 가 없어, 브라우저가 만들었을 트리를 손으로 세워 넣는다.
 *    HTML 파싱 자체가 아니라 sanitizer 의 몫(어떤 태그·속성을 남기고 버리는가)을 본다
 * ② parseCaseFile — note / notesIndex 인식, 기존 카드·_index.json 결과는 그대로
 * ③ 회차 칩·필터 순수 함수
 */
import assert from 'node:assert/strict'
import { sanitizeNote } from '../lib/record/sanitizeNote'
import { parseCaseFile } from '../lib/caseStudy/parse'
import {
  clampIndent, clampSpan, notePartsOf, noteSubjects, partLabel,
  sortedExamKeys, isUntitledItem, alignClass, cellBgClass, isBoxTable, tableSizeClass, isExamItem, examChipsOfItem,
  subsForExam, paragraphClass, paragraphPadding, type NoteBlock, type NotesIndex,
} from '../lib/record/notes'
import { decodeNoteFromStore, encodeNoteForStore } from '../lib/record/noteStorage'
import type { NoteDoc } from '../lib/record/notes'
import fs from 'node:fs'

// ── ① sanitizeNote ────────────────────────────────────────────────
type FakeNode = { nodeType: number; textContent?: string; tagName?: string; childNodes: FakeNode[]; getAttribute?: (n: string) => string | null }
const tx = (s: string): FakeNode => ({ nodeType: 3, textContent: s, childNodes: [] })
const el = (tag: string, attrs: Record<string, string>, ...kids: FakeNode[]): FakeNode => ({
  nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids, getAttribute: (n) => (n in attrs ? attrs[n] : null),
})
const comment = (): FakeNode => ({ nodeType: 8, childNodes: [] })
// 입력 문자열 → 브라우저 DOMParser 가 만들었을 body 자식들
const TREES = new Map<string, FakeNode[]>()
;(globalThis as { DOMParser?: unknown }).DOMParser = class {
  parseFromString(s: string) {
    const html = s.replace('<!doctype html><body>', '')
    const kids = TREES.get(html)
    if (!kids) throw new Error(`트리가 없는 입력: ${html}`)
    return { body: { childNodes: kids } }
  }
}
function check(html: string, tree: FakeNode[], want: string) {
  TREES.set(html, tree)
  assert.equal(sanitizeNote(html), want, html)
}

// 막아야 하는 것
check('<script>alert(1)</script>본문', [el('script', {}, tx('alert(1)')), tx('본문')], '본문')
check('<img src=x onerror=alert(1)>끝', [el('img', { src: 'x', onerror: 'alert(1)' }), tx('끝')], '끝')
check('<a href="javascript:alert(1)">링크</a>', [el('a', { href: 'javascript:alert(1)' }, tx('링크'))], '링크')
check('<b onclick="x()" style="color:red">굵게</b>', [el('b', { onclick: 'x()', style: 'color:red' }, tx('굵게'))], '<b>굵게</b>')
check('<span class="c1" onmouseover="x()">금</span>', [el('span', { class: 'c1', onmouseover: 'x()' }, tx('금'))], '<span class="c1">금</span>')
check('<span class="c1 evil">벗김</span>', [el('span', { class: 'c1 evil' }, tx('벗김'))], '벗김')
check('<span class="c6">벗김</span>', [el('span', { class: 'c6' }, tx('벗김'))], '벗김')
check('<span>벗김</span>', [el('span', {}, tx('벗김'))], '벗김')
check('<mark class="x">벗김</mark>', [el('mark', { class: 'x' }, tx('벗김'))], '벗김')
check('<div><iframe src="//e"></iframe><style>b{}</style>글</div>', [el('div', {}, el('iframe', { src: '//e' }), el('style', {}, tx('b{}')), tx('글'))], '글')
check('<svg><script>x</script></svg>남음', [el('svg', {}, el('script', {}, tx('x'))), tx('남음')], '남음')
check('&lt;script&gt;', [tx('<script>"&')], '&lt;script&gt;&quot;&amp;')
check('<!-- c -->a', [comment(), tx('a')], 'a')
// 남겨야 하는 것
check(
  '<b>b</b><u>u</u><i>i</i><s>s</s><br>',
  [el('b', {}, tx('b')), el('u', {}, tx('u')), el('i', {}, tx('i')), el('s', {}, tx('s')), el('br', {})],
  '<b>b</b><u>u</u><i>i</i><s>s</s><br>'
)
check('<mark>형광</mark><mark class="g">g</mark>', [el('mark', {}, tx('형광')), el('mark', { class: 'g' }, tx('g'))], '<mark>형광</mark><mark class="g">g</mark>')
check(
  'law/case/res',
  [el('mark', { class: 'law' }, tx('l')), el('mark', { class: 'case' }, tx('c')), el('mark', { class: 'res' }, tx('r'))],
  '<mark class="law">l</mark><mark class="case">c</mark><mark class="res">r</mark>'
)
for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) check(`span.${c}`, [el('span', { class: c }, tx(c))], `<span class="${c}">${c}</span>`)
check('<b><span class="c2"><mark class="g">겹침</mark></span></b>', [el('b', {}, el('span', { class: 'c2' }, el('mark', { class: 'g' }, tx('겹침'))))], '<b><span class="c2"><mark class="g">겹침</mark></span></b>')
// 문단 <p>: 정렬 class(al-c·al-r)만 남기고, 그 밖의 class·속성은 지운 <p>
check('<p class="al-c">x</p>', [el('p', { class: 'al-c' }, tx('x'))], '<p class="al-c">x</p>')
check('<p class="evil" onclick="x()">x</p>', [el('p', { class: 'evil', onclick: 'x()' }, tx('x'))], '<p>x</p>')
check('<p class="al-r"><b>x</b></p>', [el('p', { class: 'al-r' }, el('b', {}, tx('x')))], '<p class="al-r"><b>x</b></p>')
check('<p class="al-c al-r">x</p>', [el('p', { class: 'al-c al-r' }, tx('x'))], '<p class="al-c al-r">x</p>')
check('<p><br></p><p>원고   김갑동</p>', [el('p', {}, el('br', {})), el('p', {}, tx('원고   김갑동'))], '<p><br></p><p>원고   김갑동</p>')
check('<p style="x"><script>a</script><span class="c2">b</span></p>', [el('p', { style: 'x' }, el('script', {}, tx('a')), el('span', { class: 'c2' }, tx('b')))], '<p><span class="c2">b</span></p>')
// 윗첨자·글자 테두리·문단 class 토큰
check('<sup>x</sup>', [el('sup', { onclick: 'x()' }, tx('x'))], '<sup>x</sup>')
check('<span class="bx">x</span>', [el('span', { class: 'bx' }, tx('x'))], '<span class="bx">x</span>')
check('<span class="evil">x</span>', [el('span', { class: 'evil' }, tx('x'))], 'x')
check('<span class="bx c1">x</span>', [el('span', { class: 'bx c1' }, tx('x'))], 'x')
check('<p class="al-c in2 hg evil">x</p>', [el('p', { class: 'al-c in2 hg evil', onclick: 'x()' }, tx('x'))], '<p class="al-c in2 hg">x</p>')
check('<p class="evil">x</p>', [el('p', { class: 'evil' }, tx('x'))], '<p>x</p>')
check('<p class="in8 fl in9 in1">x</p>', [el('p', { class: 'in8 fl in9 in1' }, tx('x'))], '<p class="in8 fl in1">x</p>')
check('<p class="  al-r   al-r ">x</p>', [el('p', { class: '  al-r   al-r ' }, tx('x'))], '<p class="al-r">x</p>')
check('<p class="al-c&quot;onclick">x</p>', [el('p', { class: 'al-c"onclick=x()' }, tx('x'))], '<p>x</p>')
// DOMParser 가 없으면 빈 문자열
const saved = (globalThis as { DOMParser?: unknown }).DOMParser
delete (globalThis as { DOMParser?: unknown }).DOMParser
assert.equal(sanitizeNote('<b>x</b>'), '')
;(globalThis as { DOMParser?: unknown }).DOMParser = saved

// ── ② parseCaseFile ───────────────────────────────────────────────
const J = (o: unknown) => JSON.stringify(o)
const throws = (name: string, o: unknown, msg: string) => assert.throws(() => parseCaseFile(name, J(o)), { message: msg }, `${name}: ${msg}`)

// 기존 분기 — 결과·오류 문구가 예전과 같다
const idx = { schema: 1, cards: [{ id: '1a-1', subject: '민법', problems: [{ id: '1a-1#1', cases: ['2001다1'] }] }] }
assert.deepEqual(parseCaseFile('_index.json', J(idx)), { kind: 'index', name: '_index.json', index: idx, warnings: [] })
throws('_index.json', { schema: 1 }, 'cards 배열이 없습니다')
throws('_index.json', { schema: 1, cards: [{}] }, 'id 없는 색인 항목이 있습니다')
const card = { schema: 1, id: '1a-1', subject: '민법', problems: [{ id: '1a-1#1', cases: [' 2001다1 ', '<b>x</b>'] }] }
const parsedCard = parseCaseFile('1a-1.json', J(card))
assert.equal(parsedCard.kind, 'card')
assert.deepEqual(parsedCard.kind === 'card' && parsedCard.card.problems[0].cases, ['2001다1'], '카드 cases 정리는 그대로')
assert.equal(parsedCard.warnings.length, 1)
throws('x.json', { schema: 1, subject: '민법', problems: [] }, 'id 가 없습니다')
throws('x.json', { schema: 1, id: 'a/b', problems: [] }, "id 에 '/' 가 들어 있습니다 (a/b)")
throws('x.json', { schema: 1, id: 'a' }, 'problems 배열이 없습니다')
throws('x.json', { schema: 2, id: 'a', problems: [] }, 'schema 가 1 이 아닙니다 (2)')
assert.throws(() => parseCaseFile('x.json', '{'), { message: 'JSON 형식이 아닙니다' })
// items 가 있어도 problems 가 있으면 카드다
assert.equal(parseCaseFile('c.json', J({ schema: 1, id: 'c', items: [], problems: [] })).kind, 'card')

// 정리본 문서
const exam = (kind: '변시' | '모의', e: string) => ({ kind, exam: e })
const note = {
  schema: 1, id: '정리-공법-1부', subject: '공법', title: '공법 1부', part: '1부',
  items: [{ id: 'i1', title: '처분성', blocks: [{ t: 'p', h: '<b>x</b>', ind: 1 }], subs: [], exams: [exam('변시', '14')] }],
}
assert.deepEqual(parseCaseFile('정리-공법-1부.json', J(note)), { kind: 'note', name: '정리-공법-1부.json', note, warnings: [] })
throws('n.json', { ...note, id: undefined }, '정리본 id 가 없습니다')
throws('n.json', { ...note, id: 'a/b' }, "정리본 id 에 '/' 가 들어 있습니다 (a/b)")
throws('n.json', { ...note, id: '_index' }, "정리본 id 로 '_index' 는 쓸 수 없습니다")
throws('n.json', { ...note, subject: 1 }, 'subject 가 문자열이 아닙니다')
throws('n.json', { ...note, title: null }, 'title 이 문자열이 아닙니다')
throws('n.json', { ...note, items: [{ id: 'i', blocks: [] }] }, '정리-공법-1부: items[0].subs 가 배열이 아닙니다')
throws('n.json', { ...note, items: [{ id: 'i', subs: [] }] }, '정리-공법-1부: items[0].blocks 가 배열이 아닙니다')
throws('n.json', { ...note, items: [1] }, '정리-공법-1부: items[0] 가 객체가 아닙니다')

// 정리본 색인
const nidx = { schema: 1, docs: [{ id: '정리-공법-1부', subject: '공법', part: '1부', order: 1, items: [] }] }
assert.deepEqual(parseCaseFile('_notes_index.json', J(nidx)), { kind: 'notesIndex', name: '_notes_index.json', index: nidx, warnings: [] })
throws('_notes_index.json', { schema: 1 }, 'docs 배열이 없습니다')
throws('_notes_index.json', { schema: 1, docs: [{ subject: '공법', items: [] }] }, '정리본 색인 항목 id 가 없습니다')
throws('_notes_index.json', { schema: 1, docs: [{ id: 'd', subject: 1, items: [] }] }, 'd: subject 가 문자열이 아닙니다')
throws('_notes_index.json', { schema: 1, docs: [{ id: 'd', subject: '공법' }] }, 'd: items 배열이 없습니다')
throws('_notes_index.json', { schema: 2, docs: [] }, 'schema 가 1 이 아닙니다 (2)')

// ── ③ 회차 칩·필터 ────────────────────────────────────────────────
const index: NotesIndex = {
  schema: 1,
  docs: [
    { id: '형-1', subject: '형사', part: 1, order: 1, items: [{ id: 'k1', title: '형사 항목' }] },
    { id: '공-2', subject: '공법', part: '2', order: 2, items: [{ id: 'p3', title: '셋', exams: [exam('모의', '24.10')] }] },
    {
      id: '공-1', subject: '공법', part: '1부', order: 1,
      items: [
        { id: 'p1', title: '하나', exams: [exam('변시', '14'), exam('모의', '24.6')] },
        { id: 'p2', title: '둘', subs: [{ title: '소', exams: [exam('변시', '2')] }] },
        { id: 'p0', title: '태그 없음' },
      ],
    },
    { id: '민-1', subject: '민사', part: '1부', order: 1, items: [{ id: 'm1', title: 'm', exams: [exam('변시', '14')] }] },
  ],
}
assert.deepEqual(noteSubjects(index), ['공법', '민사', '형사'])
assert.deepEqual(notePartsOf(index, '공법').map((d) => d.id), ['공-1', '공-2'], 'order 순')
assert.deepEqual([partLabel(1), partLabel('2'), partLabel('1부')], ['1부', '2부', '1부'])
// 변시 → 모의, 번호순(변시 2 < 14, 모의 24.6 < 24.10), 중복 없음
assert.deepEqual(sortedExamKeys([exam('모의', '24.6'), exam('변시', '14'), exam('변시', '14')]), ['변시 14', '모의 24.6'])
// 변시 → 모의, 번호순(변시 2 < 14, 모의 24.6 < 24.10)
assert.deepEqual(sortedExamKeys([exam('모의', '24.10'), exam('변시', '14'), exam('모의', '24.6'), exam('변시', '2')]), ['변시 2', '변시 14', '모의 24.6', '모의 24.10'])
assert.deepEqual([clampSpan(undefined), clampSpan(0), clampSpan(3), clampSpan(99), clampSpan('2'), clampSpan('x'), clampSpan(2.7)], [1, 1, 3, 20, 2, 1, 2])
assert.deepEqual([clampIndent(undefined), clampIndent(-1), clampIndent(3), clampIndent(9)], [0, 0, 3, 6])

// ── ④ Firestore 저장 형태 (배열 안의 배열 없음) ─────────────────────
// 배열 안에 배열이 있으면 그 경로를 돌려준다
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
assert.equal(nestedArrayAt({ a: [[1]] }), '$.a[0]', '검사 함수 자체')
assert.equal(nestedArrayAt({ a: [{ b: [1] }] }), null, '객체를 사이에 두면 중첩 배열이 아니다')

const cell = (h: string, extra: object = {}) => ({ h, ...extra })
const tableDoc = {
  schema: 1, id: '정리-민사-4부', subject: '민사', title: '민사 4부', part: '4부',
  items: [
    {
      id: 'i1', title: '표 항목', exams: [exam('변시', '14')],
      blocks: [
        { t: 'p', h: '<b>앞</b>', ind: 1 },
        { t: 'table', sz: 's', rows: [[cell('가', { cs: 2 }), cell('나')], [cell('다', { rs: 3 })], []] },
      ],
      subs: [{ title: '소', exams: [exam('모의', '24.6')], blocks: [{ t: 'table', rows: [[cell('s1'), cell('s2', { cs: 1, rs: 2 })]] }] }],
    },
    { id: 'i2', title: '빈 항목', blocks: [], subs: [] },
  ],
} as unknown as NoteDoc
const before = JSON.parse(JSON.stringify(tableDoc))
assert.ok(nestedArrayAt(tableDoc), '원본에는 표 rows 의 중첩 배열이 있다')
const enc = encodeNoteForStore(tableDoc)
// ① encode 결과에 배열 안의 배열이 없다
assert.equal(nestedArrayAt(enc), null)
assert.deepEqual(tableDoc, before, 'encode 는 입력을 바꾸지 않는다')
// ② 왕복 동일
const dec = decodeNoteFromStore(JSON.parse(JSON.stringify(enc)))
assert.deepEqual(dec, before)
assert.deepEqual(enc, JSON.parse(JSON.stringify(enc)), 'encode 결과에 undefined 등 직렬화로 사라지는 값이 없다')
// ③ cs/rs 유지
const t0 = dec.items[0].blocks[1] as Extract<NoteDoc['items'][0]['blocks'][0], { t: 'table' }>
assert.deepEqual(t0.rows[0][0], { h: '가', cs: 2 })
assert.deepEqual(t0.rows[1][0], { h: '다', rs: 3 })
assert.deepEqual((dec.items[0].subs[0].blocks[0] as typeof t0).rows[0][1], { h: 's2', cs: 1, rs: 2 })
// sz('s', 작은 표)가 저장 형태·왕복에서 유지된다
assert.equal((enc.items[0].blocks[1] as { sz?: string }).sz, 's')
assert.equal((dec.items[0].blocks[1] as { sz?: string }).sz, 's')
// ④ 옛 형태(행이 배열)는 decode 해도 그대로
assert.deepEqual(decodeNoteFromStore(JSON.parse(JSON.stringify(tableDoc))), before)
// ⑤ 표가 없는 문서는 값이 그대로
assert.deepEqual(encodeNoteForStore(note as unknown as NoteDoc), note)
assert.deepEqual(decodeNoteFromStore(note as unknown as NoteDoc), note)
// 색인에는 중첩 배열이 없다
assert.equal(nestedArrayAt(index), null)
assert.equal(nestedArrayAt(nidx), null)

// 실데이터 (환경 변수가 있을 때만. 데이터는 저장소에 두지 않는다)
//   LAWPASS_NOTES_DIR — 정리본 JSON 폴더(정리-*.json, _notes_index.json)
const notesDir = process.env.LAWPASS_NOTES_DIR
if (!notesDir) {
  console.log('실데이터: 건너뜀 (LAWPASS_NOTES_DIR 미설정)')
} else {
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith('.json')).sort()
  let maxBytes = 0
  for (const f of files) {
    const raw: string = fs.readFileSync(`${notesDir}/${f}`, 'utf8')
    const parsed = parseCaseFile(f, raw)
    if (parsed.kind === 'notesIndex') {
      assert.equal(nestedArrayAt(parsed.index), null, `${f}: 색인에 중첩 배열`)
      continue
    }
    assert.equal(parsed.kind, 'note', f)
    if (parsed.kind !== 'note') continue
    const e = encodeNoteForStore(parsed.note)
    assert.equal(nestedArrayAt(e), null, `${f}: encode 후 중첩 배열 ${nestedArrayAt(e)}`)
    assert.deepEqual(decodeNoteFromStore(JSON.parse(JSON.stringify(e))), JSON.parse(raw), `${f}: 왕복`)
    const bytes = Buffer.byteLength(JSON.stringify(e))
    assert.ok(bytes <= 900_000, `${f}: ${bytes}B > 900KB`)
    maxBytes = Math.max(maxBytes, bytes)
  }
  console.log(`실데이터: ${files.length}개 파일 — encode 후 중첩 배열 없음·왕복 동일 (가장 큰 저장 형태 ${Math.round(maxBytes / 1000)}KB)`)
}

// 기재례 박스·표 글자 크기
const tbl = (rows: unknown[][], extra: object = {}) => ({ t: 'table', rows, ...extra }) as unknown as NoteBlock
assert.equal(isBoxTable(tbl([[{ h: 'x' }]])), true, '1×1 표')
assert.equal(isBoxTable(tbl([[{ h: 'x' }, { h: 'y' }]])), false, '1×2')
assert.equal(isBoxTable(tbl([[{ h: 'x' }], [{ h: 'y' }]])), true, '2행 1열')
assert.equal(isBoxTable(tbl([[{ h: 'x' }], [{ h: 'y' }], [{ h: 'z' }]])), true, '3행 1열')
assert.equal(isBoxTable(tbl([[{ h: 'a' }, { h: 'b' }], [{ h: 'c' }, { h: 'd' }]])), false, '2열 표')
assert.equal(isBoxTable(tbl([[{ h: '머리', cs: 2 }], [{ h: 'a' }, { h: 'b' }]])), false, '첫 행 cs 헤더 + 여러 열')
assert.equal(isBoxTable(tbl([[{ h: '머리', cs: 2 }], [{ h: 'a' }]])), false, '셀이 하나여도 여러 열을 차지하면 박스가 아니다')
assert.equal(isBoxTable(tbl([[{ h: 'x' }], []])), false, '빈 행이 섞인 표')
assert.equal(isBoxTable(tbl([])), false, '빈 표')
assert.equal(isBoxTable(tbl([[]])), false, '빈 행')
assert.equal(isBoxTable({ t: 'p', h: 'x' }), false, '문단')
assert.deepEqual([tableSizeClass({ sz: 's' }), tableSizeClass({}), tableSizeClass({ sz: 'l' })], ['text-xs', 'text-sm', 'text-sm'])

// 기출 항목의 회차 칩·소항목 고르기 (색인 subs[i] ↔ 본문 subs[i])
const examItem = {
  id: 'x', title: '[변시 기출]',
  subs: [{ title: '14회', exams: [exam('변시', '14')] }, { title: '2회', exams: [exam('변시', '2')] }, { title: '24.6', exams: [exam('모의', '24.6')] }],
}
const examBody = { subs: [{ title: '14회', blocks: [] }, { title: '2회', blocks: [] }, { title: '24.6', blocks: [] }] }
assert.equal(isExamItem(examItem), true)
assert.equal(isExamItem({ id: 'y', title: 't', subs: [{ title: 'a', exams: [exam('변시', '1')] }, { title: 'b' }] }), false, '태그 없는 소항목이 섞이면 기출 항목이 아니다')
assert.equal(isExamItem({ id: 'z', title: 't', exams: [exam('변시', '1')] }), false, '소항목이 없으면 기출 항목이 아니다')
assert.deepEqual(examChipsOfItem(examItem), ['변시 2', '변시 14', '모의 24.6'])
assert.deepEqual(examChipsOfItem({ id: 'z', title: 't', subs: [] }), [], '기출 항목이 아니면 칩 없음')
assert.deepEqual(subsForExam(examBody, examItem, '변시 2').map((s) => s.title), ['2회'], '고른 회차 소항목만')
assert.deepEqual(subsForExam(examBody, examItem, null).map((s) => s.title), ['14회', '2회', '24.6'], '선택 없음 → 전부')
assert.deepEqual(subsForExam(examBody, examItem, '변시 99').map((s) => s.title), ['14회', '2회', '24.6'], '맞는 소항목이 없는 키 → 빈 화면 대신 전부')
assert.deepEqual(subsForExam({}, examItem, '변시 2'), [], '본문에 소항목이 없으면 빈 배열')

// 본문 문단의 내어쓰기·첫 줄 들여쓰기
assert.deepEqual([paragraphClass({ hg: 1 }), paragraphClass({ fl: 1 }), paragraphClass({ hg: 1, fl: 1 }), paragraphClass({ hg: 2, fl: 'x' }), paragraphClass({})], ['note-hg', 'note-fl', 'note-hg note-fl', '', ''])
assert.deepEqual([paragraphPadding({}), paragraphPadding({ ind: 2 }), paragraphPadding({ ind: 2, hg: 1 }), paragraphPadding({ ind: 9, hg: 1 }), paragraphPadding({ hg: true })], [0, 2.5, 3.75, 8.75, 0])

// 제목 없는 항목·정렬·셀 배경
assert.deepEqual([isUntitledItem({ title: '' }), isUntitledItem({ title: '  ' }), isUntitledItem({}), isUntitledItem({ title: '처분성' })], [true, true, true, false])
assert.deepEqual([alignClass('c'), alignClass('r'), alignClass('l'), alignClass(undefined)], ['text-center', 'text-right', '', ''])
assert.deepEqual([cellBgClass('g1'), cellBgClass('g2'), cellBgClass('g3'), cellBgClass('x" onclick="'), cellBgClass(undefined)], ['note-bg-g1', 'note-bg-g2', '', '', ''])

console.log('통과: sanitizeNote(차단·허용·DOMParser 없음), parseCaseFile(note·notesIndex, 기존 카드·_index 그대로), 회차 정렬·span/들여쓰기 범위, 기재례 박스·표 크기·기출 회차 칩·소항목 고르기, 문단 p·정렬·셀 배경·제목 없는 항목, sup·bx·문단 토큰·내어쓰기, 저장 형태(중첩 배열 없음·왕복·sz 유지·옛 형태·표 없음)')
