/**
 * 기출판례 화면(CasesTab)의 출처 칩·정렬·발췌 로직 검증 (check:case-ui-logic).
 * 화면은 lib/caseDigest.ts 의 filterCases·sortCases(origin)·caseStudyParagraphs 등을 그대로 부르므로
 * 그 함수들을 화면과 같은 순서(필터 → 검색 → 기간 → 정렬)로 엮어 검사한다.
 *
 * 실데이터 통계는 check:case-unified 와 같이 환경 변수가 있을 때만 낸다:
 *   LAWPASS_OBJECTIVE_DIR, LAWPASS_CASE_DIR
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildCaseDigest, buildUnifiedCaseDigest, caseNumberSpans, caseStudyExamLabel, caseStudyParagraphs, caseStudyQuestionLabel,
  filterCases, groupCaseStudySources, htmlToText, originCount, searchCases, sortCases, stripBucketLabels, stripSourceSuffix,
  type CaseGroup, type CaseOrigin, type CaseSort, type CaseSource,
} from '../lib/caseDigest'
import type { CaseIndex } from '../lib/caseStudy/types'
import type { ExamType, Question, Subject } from '../lib/types'

type Opts = { subjects?: Subject[]; units?: string[]; examTypes?: ExamType[]; years?: number | null; query?: string; sort?: CaseSort }
const NOW = new Date('2026-10-19')

// 화면(CasesTab)의 목록 계산을 그대로: scoped → 검색 → 기간 → 선고일 있음/없음 각각 정렬
function screen(groups: CaseGroup[], o: Opts, origin?: CaseOrigin) {
  const base = { subjects: o.subjects ?? [], units: o.units ?? [], examTypes: o.examTypes ?? [], now: NOW, origin }
  const scoped = filterCases(groups, base)
  const searched = searchCases(scoped, o.query ?? '')
  const inRange = filterCases(searched, { ...base, years: o.years === undefined ? 5 : o.years })
  const sort = o.sort ?? 'count'
  return {
    dated: sortCases(inRange.filter((g) => g.year !== null), sort, origin),
    undated: sortCases(inRange.filter((g) => g.year === null), sort, origin),
  }
}
const sig = (r: ReturnType<typeof screen>, origin?: CaseOrigin) =>
  JSON.stringify([...r.dated, ...r.undated].map((g) => [g.key, origin ? originCount(g, origin) : g.count, g.year]))

// ── fixture ──────────────────────────────────────────────────────
const q = (id: string, subject: Subject, examType: ExamType, year: number, unit: string, cases: { caseNumber: string; decidedDate?: string; summary: string }[]) =>
  ({ id, no: Number(id.replace(/\D/g, '')) || 1, subject, examType, year, unit, cases }) as unknown as Question
const objective: Question[] = [
  q('o1', '민법', '변호사시험', 2024, '채권총론', [{ caseNumber: '2001다46730', decidedDate: '2023. 6. 13.', summary: 'A' }]),
  q('o2', '민법', '모의고사', 2025, '물권법', [{ caseNumber: '95다8713', decidedDate: '1995.04.25.', summary: 'B' }, { caseNumber: '2001다46730', decidedDate: '2023.06.13.', summary: 'A' }]),
  q('o3', '민사소송법', '변호사시험', 2023, '소송의 주체', [{ caseNumber: '2010다1', decidedDate: '2024. 1. 2.', summary: 'C' }]),
]
const P = (id: string, cases: string[], extra: object = {}) => ({ id, kind: '변시', exam: 13, qno: '제1문의 1', sub: '', points: 20, cases, ...extra })
const index = {
  schema: 1,
  cards: [
    { id: 'c1', subject: '민법', category: '채권총론', chapter: '변제', order: [0, 0], title: '카드 하나', pages: '', problems: [
      P('c1#1', ['2001다46730', '2002다1']),
      P('c1#2', ['2002다1', '1995다8713'], { kind: '모의', exam: '24.6', qno: '제2문의 2', sub: '문1' }),
    ] },
    { id: 'c2', subject: '민소', category: '소송의 주체', chapter: '당사자', order: [1, 0], title: '카드 둘', pages: '', problems: [P('c2#1', ['2003다2'])] },
  ],
} as unknown as CaseIndex
const uni = buildUnifiedCaseDigest(objective, index).groups
const old = buildCaseDigest(objective).groups

// 1. 출처 칩별 판례 수
const n = (origin: CaseOrigin, o: Opts = { years: null }) => { const r = screen(uni, o, origin); return r.dated.length + r.undated.length }
assert.equal(n('objective'), 3, '선택형 칩 = counts.objective > 0')
assert.equal(n('caseStudy'), 4, '사례형 칩 = counts.caseStudy > 0 (2001다46730·1995다8713·2002다1·2003다2)')
assert.equal(n('all'), 5, '전체 = 합집합')

// 2. 정렬 기준: 전체 = total, 선택형 = objective, 사례형 = caseStudy
const keys = (origin: CaseOrigin) => { const r = screen(uni, { years: null }, origin); return [...r.dated, ...r.undated].map((g) => `${g.key}:${originCount(g, origin)}`) }
assert.deepEqual(keys('all'), ['2001다46730:3', '1995다8713:2', '2010다1:1', '2002다1:2', '2003다2:1'])
assert.deepEqual(keys('objective'), ['2001다46730:2', '2010다1:1', '1995다8713:1'])
assert.deepEqual(keys('caseStudy'), ['2001다46730:1', '1995다8713:1', '2002다1:2', '2003다2:1'])

// 3. 선택형 칩 결과 = 기존 buildCaseDigest 경로 (여러 필터 조합)
const combos: Opts[] = [
  {}, { years: null }, { years: 1 }, { subjects: ['민법'] }, { subjects: ['민법'], units: ['물권법'] },
  { examTypes: ['모의고사'] }, { query: '2001' }, { query: '95다8713' }, { sort: 'date', years: null },
]
for (const o of combos) assert.equal(sig(screen(uni, o, 'objective'), 'objective'), sig(screen(old, o)), `선택형 칩 = 기존 화면 ${JSON.stringify(o)}`)

// 4. 사례형 전용 판례는 선고일 미상, 기간 필터(최근 1년)에서도 남는다
const r1 = screen(uni, { years: 1 }, 'caseStudy')
assert.deepEqual(r1.undated.map((g) => g.key), ['2002다1', '2003다2'])
assert.ok(r1.undated.every((g) => !g.hasSummary && g.year === null))
assert.ok(!r1.dated.some((g) => g.key === '1995다8713'), '선고일이 있는 오래된 판례는 기간 필터에 걸린다')

// 5. 과목 필터와 AND: 사례형 '민소' → 선택형 칩의 '민사소송법'
assert.deepEqual(screen(uni, { years: null, subjects: ['민사소송법'] }, 'caseStudy').undated.map((g) => g.key), ['2003다2'])
assert.equal(n('caseStudy', { years: null, subjects: ['민법'] }), 3)
// 사례형에는 단원이 없다 — 그 과목 단원을 고르면 사례형 출처는 빠진다
assert.equal(n('caseStudy', { years: null, subjects: ['민법'], units: ['채권총론'] }), 0)
// 시험 유형: 사례형 '모의' → '모의고사'
assert.deepEqual(screen(uni, { years: null, examTypes: ['모의고사'] }, 'caseStudy').dated.map((g) => g.key), ['1995다8713'])

// 6. 검색: 사례형 전용 판례도 판례번호로 찾는다 (2자리로 쳐도)
assert.deepEqual(screen(uni, { years: null, query: '2003다2' }, 'all').undated.map((g) => g.key), ['2003다2'])
assert.deepEqual(screen(uni, { years: null, query: '03다2' }, 'all').undated.map((g) => g.key), ['2003다2'])

// 7. 답안 문단: 블록 하나를 통째로("…" 없음), 2자리/4자리 표기, 같은 문단은 한 번, 한 문단에 두 번
assert.equal(htmlToText('가<mark class="case">95다8713</mark>나<br>다 &amp; &lt;b&gt;'), '가95다8713나 다 & <b>')
const long = 'ㄱ'.repeat(300)
const para = `판례(대판 1995. 4. 25. <mark class="case">95다8713</mark>)는 <b>그렇다</b>. ${long} 다시 1995다8713 참조.`
const problem = { answer: { blocks: [
  { t: 'h1', html: 'Ⅰ. 95다8713 쟁점' }, // 목차 줄은 문단이 아니다
  { t: 'p', html: `<p>${long}</p>` },
  { t: 'p', html: para },
  { t: 'p', html: para }, // 같은 문단이 두 번 → 한 번
  { t: 'p', html: '다른 문단 <mark class="case">2016다12345</mark>' },
] } }
const ps = caseStudyParagraphs(problem, '1995다8713')
assert.equal(ps.length, 1, '목차 줄·같은 문단 제외')
assert.equal(ps[0], htmlToText(para), '블록 전체 그대로')
assert.ok(!ps[0].startsWith('…') && !ps[0].endsWith('…') && ps[0].length > 300 && !ps[0].includes('<'))
assert.equal(caseNumberSpans(ps[0], '1995다8713').length, 2, '한 문단에 두 번(2자리·4자리 표기) 모두 강조')
assert.deepEqual(caseStudyParagraphs(problem, '16다12345'), ['다른 문단 2016다12345'], '줄여 쓴 key 로 4자리 본문')
assert.deepEqual(caseStudyParagraphs(problem, '2020다9'), [])
assert.deepEqual(caseStudyParagraphs(undefined, '95다8713'), [])
const spans = caseNumberSpans('앞 95 다 8713 뒤', '1995다8713')
assert.deepEqual(spans, [{ at: 2, len: 9 }], '띄어 쓴 표기도 자리 그대로')

// 8. 시험 라벨·문항 버튼 라벨
assert.equal(caseStudyExamLabel('변시', 11), '11회 변시')
assert.equal(caseStudyExamLabel('변시', 15), '15회 변시')
assert.equal(caseStudyExamLabel('모의', '26.1'), '2026년 1모')
assert.equal(caseStudyExamLabel('모의', '24.10'), '2024년 10모', '10월은 25.1 이 아니다')
assert.equal(caseStudyExamLabel('모의', '09.6'), '2009년 6모', '두 자리 연도 경계: 09 → 2009')
assert.equal(caseStudyExamLabel('모의', '2026.8'), '2026년 8모', '네 자리 연도는 그대로')
assert.equal(caseStudyExamLabel('모의', '이상'), '모의 이상', '못 읽으면 원값')
assert.equal(caseStudyQuestionLabel('제2문의 3', ''), '제2문의 3')
assert.equal(caseStudyQuestionLabel('제2문의 1', '문2'), '제2문의 1 문2')

// 9. 사례형 출처 묶기: 시험별, 최근이 위, 묶음 안은 문항 순
const src = (problemId: string, examType: '변시' | '모의', exam: number | string, year: number, qno: string, sub = '') =>
  ({ kind: 'caseStudy', cardId: problemId.split('#')[0], problemId, cardTitle: 't', problemLabel: '', subject: '민법', examType, exam, qno, sub, year }) as Extract<CaseSource, { kind: 'caseStudy' }>
const buckets = groupCaseStudySources([
  src('a#1', '변시', 11, 2022, '제2문의 1', '문2'),
  src('b#1', '모의', '24.6', 2024, '제1문의 3'),
  src('c#1', '모의', '24.10', 2024, '제1문의 2'),
  src('d#1', '변시', 11, 2022, '제2문의 1', '문1'),
  src('e#1', '모의', '26.1', 2026, '제2문의 1'),
])
assert.deepEqual(buckets.map((b) => b.label), ['2026년 1모', '2024년 10모', '2024년 6모', '11회 변시'])
assert.deepEqual(buckets[3].sources.map((s) => caseStudyQuestionLabel(s.qno, s.sub)), ['제2문의 1 문1', '제2문의 1 문2'])

// 10. 괄호 접미사: 표시에서만 떼고, 같은 라벨이 되면 한 줄로 (문제번호순)
assert.equal(stripSourceSuffix('2026년 8모(민법_변시)'), '2026년 8모')
assert.equal(stripSourceSuffix('11회 변시(민법_변시)'), '11회 변시')
assert.equal(stripSourceSuffix('11회 변시'), '11회 변시')
assert.equal(stripSourceSuffix('2024년 모의고사(2024 (1차))'), '2024년 모의고사(2024 (1차))', '괄호가 겹친 것은 건드리지 않는다')
const qn = (id: string, no: number) => ({ id, no }) as unknown as Question
assert.deepEqual(
  stripBucketLabels([
    { label: '11회 변시(민법_변시)', questions: [qn('x', 22)] },
    { label: '2026년 8모', questions: [qn('y', 3)] },
    { label: '11회 변시(questions.json)', questions: [qn('z', 5)] },
  ]).map((b) => [b.label, b.questions.map((q) => q.no)]),
  [['11회 변시', [5, 22]], ['2026년 8모', [3]]]
)

console.log('통과: 출처 칩 수·정렬 기준·선택형 칩 = 기존 화면(9조합)·선고일 미상·과목/유형 AND·검색·답안 문단·시험/문항 라벨·출처 묶기·괄호 제거')

// ── 실데이터 통계 (환경 변수가 있을 때만) ───────────────────────────
const objDir = process.env.LAWPASS_OBJECTIVE_DIR
const caseDir = process.env.LAWPASS_CASE_DIR
if (!objDir || !caseDir) {
  console.log('실데이터 통계: 건너뜀 (LAWPASS_OBJECTIVE_DIR·LAWPASS_CASE_DIR 미설정)')
} else {
  const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))
  const qs: Question[] = []
  for (const f of fs.readdirSync(objDir).filter((f) => f.endsWith('.json')).sort()) {
    const list = read(path.join(objDir, f))
    if (Array.isArray(list)) for (const x of list) if (x && typeof x === 'object' && 'cases' in x) qs.push({ ...x, id: `${f}:${x.id}` })
  }
  const idx = read(path.join(caseDir, '_index.json')) as CaseIndex
  const cards = new Map<string, { problems: { id: string; answer?: { blocks: { html: string }[] } }[] }>()
  for (const c of idx.cards) {
    const card = read(path.join(caseDir, `${c.id}.json`))
    cards.set(c.id, card)
    for (const p of c.problems) {
      if (p.cases?.length || p.stubFor) continue
      const html = (card.problems.find((x: { id: string }) => x.id === p.id)?.answer?.blocks ?? []).map((b: { html: string }) => b.html).join(' ')
      const marks = [...html.matchAll(/<mark class="case">(.*?)<\/mark>/g)].map((m) => m[1])
      if (marks.length) p.cases = marks
    }
  }
  const realUni = buildUnifiedCaseDigest(qs, idx).groups
  const realOld = buildCaseDigest(qs).groups
  for (const o of combos) assert.equal(sig(screen(realUni, o, 'objective'), 'objective'), sig(screen(realOld, o)), `실데이터 선택형 칩 = 기존 화면 ${JSON.stringify(o)}`)
  const def: Opts = {}
  const cnt = (origin: CaseOrigin) => { const r = screen(realUni, def, origin); return { dated: r.dated.length, undated: r.undated.length } }
  // 사례형 출처마다 판례가 나온 답안 문단을 통째로 찾는 비율
  let found = 0, total = 0, maxLen = 0
  for (const g of realUni) for (const s of g.sources) {
    if (s.kind !== 'caseStudy') continue
    total++
    const ps = caseStudyParagraphs(cards.get(s.cardId)?.problems.find((p) => p.id === s.problemId), g.key)
    if (ps.length) found++
    for (const t of ps) maxLen = Math.max(maxLen, t.length)
  }
  console.log('실데이터 통계 (기본 필터: 최근 5개년·출제횟수순)')
  for (const o of ['all', 'objective', 'caseStudy'] as CaseOrigin[]) {
    const c = cnt(o)
    console.log(`  ${o.padEnd(9)} 판례 ${c.dated + c.undated}건 (선고일 있음 ${c.dated} · 선고일 미상 ${c.undated})`)
  }
  console.log(`  선택형 칩 = 기존 화면: ${combos.length}조합 모두 동일`)
  console.log(`  사례형 출처 답안 문단: ${total}건 중 ${found}건 찾음 (가장 긴 문단 ${maxLen}자, 자르지 않음)`)
}
