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
  clampIndent, clampSpan, examChipsFor, filterNoteItems, notePartsOf, noteSubjects, partLabel,
  sortedExamKeys, type NotesIndex,
} from '../lib/record/notes'

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
assert.deepEqual(examChipsFor(index, '공법'), ['변시 2', '변시 14', '모의 24.6', '모의 24.10'])
assert.deepEqual(examChipsFor(index, '형사'), [], '태그 없는 과목 → 칩 줄 숨김')
assert.deepEqual(sortedExamKeys([exam('모의', '24.6'), exam('변시', '14'), exam('변시', '14')]), ['변시 14', '모의 24.6'])
const items = notePartsOf(index, '공법')[0].items
assert.deepEqual(filterNoteItems(items, []).map((i) => i.id), ['p1', 'p2', 'p0'], '칩 없음 → 전부')
assert.deepEqual(filterNoteItems(items, ['변시 14']).map((i) => i.id), ['p1'])
assert.deepEqual(filterNoteItems(items, ['변시 2']).map((i) => i.id), ['p2'], '소항목 태그로도 걸린다')
assert.deepEqual(filterNoteItems(items, ['변시 2', '모의 24.6']).map((i) => i.id), ['p1', 'p2'], '여러 칩은 하나라도')
assert.deepEqual(filterNoteItems(items, ['모의 24.10']), [])
assert.deepEqual([clampSpan(undefined), clampSpan(0), clampSpan(3), clampSpan(99), clampSpan('2'), clampSpan('x'), clampSpan(2.7)], [1, 1, 3, 20, 2, 1, 2])
assert.deepEqual([clampIndent(undefined), clampIndent(-1), clampIndent(3), clampIndent(9)], [0, 0, 3, 6])

console.log('통과: sanitizeNote(차단·허용·DOMParser 없음), parseCaseFile(note·notesIndex, 기존 카드·_index 그대로), 회차 칩·필터·span/들여쓰기 범위')
