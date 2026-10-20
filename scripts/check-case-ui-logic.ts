/**
 * 기출판례 화면(CasesTab)의 출처 칩·정렬·발췌 로직 검증 (check:case-ui-logic).
 * 화면은 lib/caseDigest.ts 의 filterCases·sortCases(origin)와 lib/caseStudy/answerOutline.ts 를 그대로 부르므로
 * 그 함수들을 화면과 같은 순서(필터 → 검색 → 기간 → 정렬)로 엮어 검사한다.
 *
 * 실데이터 통계는 check:case-unified 와 같이 환경 변수가 있을 때만 낸다:
 *   LAWPASS_OBJECTIVE_DIR, LAWPASS_CASE_DIR
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildCaseDigest, buildUnifiedCaseDigest, caseNumberSpans, caseStudyExamLabel, caseStudyQuestionLabel,
  filterCases, groupCaseStudySources, htmlToText, originCount, searchCases, sortCases, stripBucketLabels, stripSourceSuffix,
  EXPAND_ALL_CONFIRM, allVisibleExpanded, expandAllNeedsConfirm, setVisibleExpanded, toggleExpanded,
  type CaseGroup, type CaseOrigin, type CaseSort, type CaseSource,
} from '../lib/caseDigest'
import type { Block, CaseIndex } from '../lib/caseStudy/types'
import { ANSWER_FOLD, answerOutline, answerRows, caseCitations, outlineItemOf, problemSummary, splitCitation } from '../lib/caseStudy/answerOutline'
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

// 7. 법리/사안포섭 가르기 · 목차 · 판례가 나온 목차 항목 · 요약 대용
assert.equal(htmlToText('가<mark class="case">95다8713</mark>나<br>다 &amp; &lt;b&gt;'), '가95다8713나 다 & <b>')
const B = (t: Block['t'], html: string, lv?: Block['lv'], pts?: string): Block => ({ t, html, lv, pts })
const CITE = '(대법원 2022. 6. 30. 선고 <mark class="case">2022다200089</mark> 판결)'
// (b) 같은 문단 안에서 인용 뒤에 포섭 — 인용 문장(괄호·마침표 포함)까지만 법리, 날짜 점에서 끊지 않는다
const blocksB = [B('h2', '1. 상계의 요건', 'l2', '5점'), B('p', `양수인은 대항요건을 갖추기 전에도 상계할 수 있다${CITE}. 甲은행의 수동채권은 4억 원이다. 따라서 상계는 적법하다.`, 'l3')]
const sb = splitCitation(blocksB, 1, '2022다200089')
assert.equal(sb.kind, 'b')
assert.equal(sb.law, '양수인은 대항요건을 갖추기 전에도 상계할 수 있다(대법원 2022. 6. 30. 선고 2022다200089 판결).')
assert.deepEqual(sb.application, { paragraphs: ['甲은행의 수동채권은 4억 원이다. 따라서 상계는 적법하다.'] })
// 인용이 문장 가운데 있으면 그 문장 끝까지가 법리 (날짜 점 "2014.3.27." 에서 끊지 않는다)
const mid = splitCitation([B('p', '화해와 같은 효력이 있어(대판 2014.3.27. <mark class="case">2009다104960</mark>), 종전의 법률관계는 소멸한다(창설적 효력). 甲은 丙에게 청구할 수 없다.')], 0, '2009다104960')
assert.equal(mid.kind, 'b')
assert.equal(mid.law, '화해와 같은 효력이 있어(대판 2014.3.27. 2009다104960), 종전의 법률관계는 소멸한다(창설적 효력).')
// 뒤 문장이 법리로 이어지면 자르지 않는다 (보수적)
const keep = splitCitation([B('p', `법리다${CITE}. 이는 비법인사단에도 적용된다.`)], 0, '2022다200089')
assert.equal(keep.kind, 'none')
assert.ok(keep.law.endsWith('이는 비법인사단에도 적용된다.') && !keep.application)
// (c) 인용 문장 자체가 포섭 — 문단 그대로
const sc = splitCitation([B('p', `따라서 乙의 항소취하는 효력이 있다${CITE}. 甲은 다툴 수 없다.`)], 0, '2022다200089')
assert.equal(sc.kind, 'c')
assert.equal(sc.law, '따라서 乙의 항소취하는 효력이 있다(대법원 2022. 6. 30. 선고 2022다200089 판결). 甲은 다툴 수 없다.')
// (a) 같은 목차의 다음 문단이 "사안에의 적용 :" 으로 시작
const sa1 = splitCitation([B('p', `법리다${CITE}.`), B('p', '사안에의 적용 : 甲은 4억 원을 상계할 수 있다.')], 0, '2022다200089')
assert.equal(sa1.kind, 'a')
assert.deepEqual(sa1.application, { paragraphs: ['사안에의 적용 : 甲은 4억 원을 상계할 수 있다.'] })
// (a) 같은 레벨 뒤 형제 목차 "3. 사안의 적용" (사이에 "2. 이유"), 더 큰 목차에서 멈춘다
const blocksA = [
  B('h1', 'Ⅱ. 시효중단'), B('h2', '1. 판례의 태도', 'l2', '3점'), B('p', `법리다${CITE}.`, 'l3'),
  B('h2', '2. 이유', 'l2'), B('p', '이유 문단', 'l3'),
  B('h2', '3. 사안의 적용', 'l2', '4점'), B('p', '甲의 응소는 시효를 중단한다.', 'l3'), B('h2', '(1) 세부', 'l3'), B('p', '세부 포섭', 'l3'),
  B('h1', 'Ⅲ. 결론'), B('p', '결론 문단'),
]
const sa2 = splitCitation(blocksA, 2, '2022다200089')
assert.equal(sa2.kind, 'a')
assert.deepEqual(sa2.application, { title: '3. 사안의 적용', paragraphs: ['甲의 응소는 시효를 중단한다.', '세부 포섭'] })
// 다음 큰 목차가 "결론"이면 사안포섭이 아니다
assert.equal(splitCitation([B('h1', 'Ⅰ. 법리'), B('p', `법리다${CITE}.`), B('h1', 'Ⅱ. 결론'), B('p', '甲은 이긴다.')], 1, '2022다200089').kind, 'none')
// 법리는 늘 비어 있지 않다
for (const c of [sb, mid, keep, sc, sa1, sa2]) assert.ok(c.law.trim().length > 0)

// 목차: 레벨(h1=1, l2=2, l3=3)·배점, 판례가 나온 항목(여러 곳, 2자리/4자리 표기)
const prob = { answer: { blocks: [
  B('h1', 'Ⅰ. 쟁점', undefined, '2점'), B('p', '쟁점 문단'),
  B('h1', 'Ⅱ. 상계'), B('h2', '1. 요건', 'l2', '5점'), B('p', '상계 법리(대판 1995. 4. 25. <mark class="case">95다8713</mark>).', 'l3'),
  B('h2', '(1) 세부', 'l3'), B('p', '다시 1995다8713 판결이 있다.', 'l3'),
] } }
assert.deepEqual(answerOutline(prob).map((o) => [o.level, o.title, o.pts ?? '']), [[1, 'Ⅰ. 쟁점', '2점'], [1, 'Ⅱ. 상계', ''], [2, '1. 요건', '5점'], [3, '(1) 세부', '']])
const cits = caseCitations(prob, '1995다8713')
assert.deepEqual(cits.map((c) => outlineItemOf(answerOutline(prob), c.blockIndex)), [2, 3], '두 목차 항목 모두')
assert.deepEqual(caseCitations(prob, '95다8713').map((c) => c.blockIndex), [4, 6], '2자리 표기 key 로도')
assert.equal(outlineItemOf(answerOutline(prob), 0), -1, '목차 앞 문단')
assert.deepEqual(caseCitations(prob, '2020다9'), [])
assert.deepEqual(caseCitations(undefined, '95다8713'), [])
// 같은 법리 문단은 한 번
assert.equal(caseCitations({ answer: { blocks: [B('p', `법리다${CITE}.`), B('p', `법리다${CITE}.`)] } }, '2022다200089').length, 1)

// 모범답안 줄 펴기: 목차와 본문을 문서 순서대로, 판례 문단은 법리(문단 시작~인용 문장 끝)만 하이라이트
const rowsB = answerRows({ answer: { blocks: blocksB } }, '2022다200089')
assert.deepEqual(rowsB.rows.map((r) => r.kind), ['heading', 'paragraph'])
const pb = rowsB.rows[1]
assert.ok(pb.kind === 'paragraph' && pb.highlightEnd > 0)
if (pb.kind === 'paragraph') {
  assert.equal(pb.text.slice(0, pb.highlightEnd), '양수인은 대항요건을 갖추기 전에도 상계할 수 있다(대법원 2022. 6. 30. 선고 2022다200089 판결).', '법리까지만')
  assert.ok(pb.text.slice(pb.highlightEnd).trim().startsWith('甲은행의 수동채권은'), '같은 문단의 사안포섭은 칠하지 않는다')
}
const h0 = rowsB.rows[0]
assert.ok(h0.kind === 'heading' && h0.hit && !h0.muted && h0.pts === '5점' && h0.lv === 'l2')
// 한 문단에 두 번(2자리·4자리 표기) — 마지막 인용 문장까지 칠한다. 판례 없는 문단은 0
const twice = answerRows({ answer: { blocks: [
  B('h1', 'Ⅰ. 법리'), B('p', '앞 법리(대판 <mark class="case">95다8713</mark>). 이어 1995다8713 판결도 같다. 甲은 이긴다.'), B('p', '판례 없는 문단'),
] } }, '1995다8713')
const tp = twice.rows[1]
assert.ok(tp.kind === 'paragraph')
if (tp.kind === 'paragraph') assert.equal(tp.text.slice(0, tp.highlightEnd), '앞 법리(대판 95다8713). 이어 1995다8713 판결도 같다.')
const plain = twice.rows[2]
assert.ok(plain.kind === 'paragraph' && plain.highlightEnd === 0)
// (a) 사안포섭 목차·문단도 원래 자리에 일반 본문으로 (따로 빼지 않는다)
assert.deepEqual(answerRows({ answer: { blocks: blocksA } }, '2022다200089').rows.map((r) => (r.kind === 'heading' ? `H:${r.title}` : `P:${r.highlightEnd > 0 ? '★' : ''}${r.text.slice(0, 6)}`)), [
  'H:Ⅱ. 시효중단', 'H:1. 판례의 태도', 'P:★법리다(대법', 'H:2. 이유', 'P:이유 문단', 'H:3. 사안의 적용', 'P:甲의 응소는', 'H:(1) 세부', 'P:세부 포섭', 'H:Ⅲ. 결론', 'P:결론 문단',
])
// 긴 답안 접기: 목차 ANSWER_FOLD 개 이하는 전부, 넘으면 큰 목차와 판례 항목 ±1 목차만 제목, 본문은 판례 항목만
assert.equal(ANSWER_FOLD, 10)
const many = (n: number, hitAt: number): Block[] => {
  const out: Block[] = [B('p', '목차 앞 문단')]
  for (let k = 0; k < n; k++) {
    out.push(k % 4 === 0 ? B('h1', `Ⅰ${k}. 큰 목차`) : B('h2', `${k}. 소목차`, 'l2'))
    out.push(B('p', k === hitAt ? `법리(대판 <mark class="case">2001다1</mark>).` : `본문 ${k}`, 'l3'))
  }
  return out
}
const ten = answerRows({ answer: { blocks: many(10, 6) } }, '2001다1')
assert.equal(ten.foldable, false)
assert.equal(ten.rows.length, 21, '10개 이하는 전부(목차 앞 문단 + 목차 10 + 본문 10)')
const sixteen = answerRows({ answer: { blocks: many(16, 6) } }, '2001다1')
assert.equal(sixteen.foldable, true)
const heads = sixteen.rows.filter((r) => r.kind === 'heading').map((r) => r.kind === 'heading' && `${r.title}${r.hit ? '*' : ''}${r.muted ? '~' : ''}`)
assert.deepEqual(heads, ['Ⅰ0. 큰 목차~', 'Ⅰ4. 큰 목차~', '5. 소목차~', '6. 소목차*', '7. 소목차~', 'Ⅰ8. 큰 목차~', 'Ⅰ12. 큰 목차~'])
assert.equal(sixteen.hiddenCount, 16 - heads.length)
assert.deepEqual(sixteen.rows.filter((r) => r.kind === 'paragraph').map((r) => r.kind === 'paragraph' && r.text.slice(0, 6)), ['목차 앞 문', '법리(대판 '], '본문은 판례 항목(과 목차 앞)만')
const opened = answerRows({ answer: { blocks: many(16, 6) } }, '2001다1', true)
assert.equal(opened.rows.length, 33)
assert.equal(opened.hiddenCount, 0)
assert.ok(opened.rows.every((r) => r.kind !== 'heading' || !r.muted), '펼치면 회색 없음')

// 요약 대용: brief → 원문 앞 1~2문단(설문과 같은 문단 제외) → 없음
assert.deepEqual(problemSummary({ brief: [' 甲이 乙에게 대여 ', ''], question: { paragraphs: ['원문'], ask: '설문' } }), { lines: ['甲이 乙에게 대여'], fromBrief: true })
assert.deepEqual(problemSummary({ question: { paragraphs: ['첫 문단', '설문', '둘째', '셋째'], ask: '설문' } }), { lines: ['첫 문단', '둘째'], fromBrief: false })
assert.deepEqual(problemSummary({}), { lines: [], fromBrief: false })

// 11. 판례 카드 펼침: 토글, 보이는 카드만 모두 펼치기/접기, 50장 초과 확인
const e0 = new Set<string>()
const e1 = toggleExpanded(e0, 'A')
assert.deepEqual([...e1], ['A'])
assert.equal(e0.size, 0, '원본은 그대로(새 Set)')
assert.deepEqual([...toggleExpanded(e1, 'A')], [], '다시 누르면 접힘')
const vis = ['A', 'B', 'C']
assert.equal(allVisibleExpanded(new Set(['A', 'B']), vis), false)
assert.equal(allVisibleExpanded(new Set(['A', 'B', 'C', 'Z']), vis), true)
assert.equal(allVisibleExpanded(new Set(), []), false, '보이는 카드가 없으면 "모두 펼치기"')
// 필터에 가려진 Z 의 상태는 건드리지 않는다
assert.deepEqual([...setVisibleExpanded(new Set(['Z', 'A']), vis, true)].sort(), ['A', 'B', 'C', 'Z'])
assert.deepEqual([...setVisibleExpanded(new Set(['Z', 'A', 'B']), vis, false)], ['Z'])
assert.equal(EXPAND_ALL_CONFIRM, 50)
assert.equal(expandAllNeedsConfirm(Array.from({ length: 50 }, (_, i) => `k${i}`)), null, '50장은 바로')
assert.equal(expandAllNeedsConfirm(Array.from({ length: 51 }, (_, i) => `k${i}`)), 51, '51장부터 확인')

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

console.log('통과: 출처 칩 수·정렬 기준·선택형 칩 = 기존 화면(9조합)·선고일 미상·과목/유형 AND·검색·법리/사안포섭(a·b·c)·목차·판례 항목·답안 줄 펴기·하이라이트·긴 답안 접기·요약 대용·카드 펼침·시험/문항 라벨·출처 묶기·괄호 제거')

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
  const cards = new Map<string, { problems: { id: string; answer?: { blocks: Block[] } }[] }>()
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
  // 사례형 출처마다 법리/사안포섭 가르기 — 유형 분포, 박스(법리)가 빈 건수, 사안포섭을 따로 보여주는 건수
  let found = 0, total = 0, maxLen = 0, emptyLaw = 0, withApp = 0, highlighted = 0
  const kinds: Record<string, number> = { a: 0, b: 0, c: 0, none: 0 }
  for (const g of realUni) for (const s of g.sources) {
    if (s.kind !== 'caseStudy') continue
    total++
    const cs = caseCitations(cards.get(s.cardId)?.problems.find((p) => p.id === s.problemId), g.key)
    if (cs.length) found++
    kinds[cs[0]?.kind ?? 'none']++
    if (cs.some((c) => !c.law.trim())) emptyLaw++
    if (cs.some((c) => c.application)) withApp++
    for (const c of cs) maxLen = Math.max(maxLen, c.law.length)
    const prob = cards.get(s.cardId)?.problems.find((p) => p.id === s.problemId)
    if (answerRows(prob, g.key, true).rows.some((r) => r.kind === 'paragraph' && r.highlightEnd > 0)) highlighted++
  }
  console.log('실데이터 통계 (기본 필터: 최근 5개년·출제횟수순)')
  for (const o of ['all', 'objective', 'caseStudy'] as CaseOrigin[]) {
    const c = cnt(o)
    console.log(`  ${o.padEnd(9)} 판례 ${c.dated + c.undated}건 (선고일 있음 ${c.dated} · 선고일 미상 ${c.undated})`)
  }
  console.log(`  선택형 칩 = 기존 화면: ${combos.length}조합 모두 동일`)
  console.log(`  사례형 출처 답안 문단: ${total}건 중 ${found}건 찾음 (가장 긴 법리 ${maxLen}자)`)
  console.log(`  사안포섭 유형: (a) 따로 분리 ${kinds.a} · (b) 같은 문단에 이어짐 ${kinds.b} · (c) 인용 문장이 포섭 ${kinds.c} · 자르지 않음 ${kinds.none}`)
  console.log(`  박스(법리)가 빈 건수 ${emptyLaw} · 사안포섭을 따로 보여주는 건수 ${withApp}`)
  console.log(`  문항 토글 모범답안에서 법리 하이라이트가 잡힌 출처 ${highlighted}/${total}`)
  assert.equal(emptyLaw, 0)
  assert.equal(highlighted, total)
  assert.equal(found, total)
}
