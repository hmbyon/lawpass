/**
 * 통합 판례 집계(buildUnifiedCaseDigest) 검증 (check:case-unified).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 *
 * 실데이터 통계는 환경 변수가 있을 때만 낸다 (데이터는 저장소에 두지 않는다):
 *   LAWPASS_OBJECTIVE_DIR — 선택형 추출 JSON(Question[]) 폴더. 그 안의 *.json 을 전부 읽는다
 *   LAWPASS_CASE_DIR      — 사례형 카드 JSON 폴더(_index.json + 카드). 색인에 문항 cases 가 없으면(v1)
 *                           카드 답안의 <mark class="case"> 로 문항 cases 를 메모리에서 재현한다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildCaseDigest, buildUnifiedCaseDigest, type CaseDigest } from '../lib/caseDigest'
import type { CaseIndex } from '../lib/caseStudy/types'
import type { Question } from '../lib/types'

// 기존 필드만 직렬화 (그룹 순서 포함). 선택형 결과는 이것이 한 글자도 달라지면 안 된다
const OLD = ['key', 'caseNumber', 'decidedDate', 'court', 'summary', 'otherSummaries', 'year', 'questions', 'count', 'subjects', 'units'] as const
const legacy = (d: CaseDigest) =>
  JSON.stringify({
    totalGroups: d.totalGroups,
    questionsWithCases: d.questionsWithCases,
    groups: d.groups.map((g) => Object.fromEntries(OLD.map((k) => [k, k === 'questions' ? g.questions.map((q) => q.id) : g[k]]))),
  })
const full = (d: CaseDigest) =>
  JSON.stringify(d.groups.map((g) => ({ ...g, questions: g.questions.map((q) => q.id), sources: g.sources.map((s) => (s.kind === 'objective' ? s.questionId : s.problemId)) })))
const EMPTY: CaseIndex = { schema: 1, cards: [] }

function goldenSame(qs: Question[], what: string) {
  const base = buildCaseDigest(qs)
  assert.equal(legacy(buildUnifiedCaseDigest(qs)), legacy(base), `${what}: unified(q) = buildCaseDigest(q)`)
  assert.equal(legacy(buildUnifiedCaseDigest(qs, EMPTY)), legacy(base), `${what}: unified(q, 빈 색인) = buildCaseDigest(q)`)
  assert.equal(full(buildUnifiedCaseDigest(qs, EMPTY)), full(base), `${what}: 새 필드까지 동일`)
  for (const g of base.groups) {
    assert.deepEqual(g.counts, { objective: g.count, caseStudy: 0, total: g.count })
    assert.equal(g.sources.length, g.count)
    assert.equal(g.hasSummary, g.summary !== '')
  }
}

// ── fixture ──────────────────────────────────────────────────────
const q = (id: string, no: number, cases: { caseNumber: string; decidedDate?: string; court?: string; summary: string }[]) =>
  ({ id, no, subject: '민법', examType: '변호사시험', year: 2024, unit: '채권총론', cases }) as unknown as Question
const objective: Question[] = [
  q('o1', 3, [{ caseNumber: '2001다46730', decidedDate: '2003. 6. 13. 선고', court: '대법원', summary: '선택형 요지' }]),
  q('o2', 7, [{ caseNumber: '95다8713', decidedDate: '1995.04.25.', summary: '2자리 연도 판례 요지' }]),
  q('o3', 9, [{ caseNumber: '2010다1', summary: '선택형에만 있는 판례' }]),
]
const problem = (id: string, cases: string[], extra: object = {}) => ({ id, kind: '변시', exam: 11, qno: '제2문의 1', sub: '문1', points: 20, cases, ...extra })
const index = {
  schema: 1,
  cards: [{
    id: '1a-1', subject: '민법', category: '민법총칙', chapter: '법인', order: [0, 0], title: '법인·비법인사단', pages: '',
    cases: ['2001다46730', '2002다64780', '1995다8713'], // 카드 단위 cases 는 쓰지 않는다
    problems: [
      problem('1a-1#1', ['2001다46730', '2002다64780', '2002다64780']), // 같은 문항이 같은 판례를 두 번 → 1건
      problem('1a-1#2', ['1995다8713'], { kind: '모의', exam: '24.6', qno: '제2문의 2' }), // 4자리 표기 (선택형은 2자리)
      problem('1a-1#3', ['2001다46730'], { stubFor: '4-2#3' }), // stub 은 건너뛴다
    ],
  }],
} as unknown as CaseIndex

goldenSame(objective, 'fixture')
const u = buildUnifiedCaseDigest(objective, index)
const byKey = new Map(u.groups.map((g) => [g.key, g]))
// 선택형 그룹은 순서·기존 필드 그대로, 사례형 전용은 뒤에 붙는다
assert.deepEqual(u.groups.map((g) => g.key), ['2001다46730', '1995다8713', '2010다1', '2002다64780'])
assert.equal(u.totalGroups, 4)
assert.equal(u.questionsWithCases, 3, '선택형 문제 수는 그대로')

// 합치기: 선택형+사례형 → 그룹 1개, 선고일·법원·요지는 선택형 값
const merged = byKey.get('2001다46730')!
assert.deepEqual(merged.counts, { objective: 1, caseStudy: 1, total: 2 }, 'stub 문항은 세지 않는다')
assert.equal(merged.count, 1, '기존 count 는 선택형 값')
assert.equal(merged.decidedDate, '2003. 6. 13. 선고')
assert.equal(merged.year, 2003)
assert.equal(merged.court, '대법원')
assert.equal(merged.summary, '선택형 요지')
assert.equal(merged.hasSummary, true)
assert.deepEqual(merged.sources.map((s) => s.kind), ['objective', 'caseStudy'])
const cs = merged.sources[1]
assert.ok(cs.kind === 'caseStudy')
if (cs.kind === 'caseStudy') {
  assert.deepEqual(
    { cardId: cs.cardId, problemId: cs.problemId, cardTitle: cs.cardTitle, problemLabel: cs.problemLabel, subject: cs.subject, examType: cs.examType, year: cs.year },
    { cardId: '1a-1', problemId: '1a-1#1', cardTitle: '법인·비법인사단', problemLabel: '변시 11회 제2문의 1 문1', subject: '민법', examType: '변시', year: 2022 }
  )
}

// 2자리(선택형 95다8713) / 4자리(사례형 1995다8713) → 한 그룹, 표기는 선택형 것
const twoDigit = byKey.get('1995다8713')!
assert.deepEqual(twoDigit.counts, { objective: 1, caseStudy: 1, total: 2 })
assert.equal(twoDigit.caseNumber, '95다8713')
const mock = twoDigit.sources.find((s) => s.kind === 'caseStudy')
assert.ok(mock && mock.kind === 'caseStudy' && mock.problemLabel === '모의 24.6 제2문의 2 문1' && mock.year === 2024)

// 사례형 전용 → 선고일 미상(year null), 요지 없음, 선택형 필드 비어 있음, 같은 문항 2번 인용은 1건
const only = byKey.get('2002다64780')!
assert.equal(only.year, null)
assert.equal(only.decidedDate, undefined)
assert.equal(only.court, undefined)
assert.equal(only.summary, '')
assert.equal(only.hasSummary, false)
assert.equal(only.count, 0)
assert.deepEqual(only.questions, [])
assert.deepEqual(only.subjects, [])
assert.deepEqual(only.counts, { objective: 0, caseStudy: 1, total: 1 })
assert.equal(only.caseNumber, '2002다64780')
assert.deepEqual(only.sources.map((s) => s.kind), ['caseStudy'])

// 선택형에만 있는 판례는 그대로
assert.deepEqual(byKey.get('2010다1')!.counts, { objective: 1, caseStudy: 0, total: 1 })

// v1 색인(문항 cases 없음)은 빈 색인과 같다
const v1 = { schema: 1, cards: [{ ...index.cards[0], problems: index.cards[0].problems.map(({ cases: _c, ...p }) => p) }] } as unknown as CaseIndex
assert.equal(full(buildUnifiedCaseDigest(objective, v1)), full(buildCaseDigest(objective)), 'v1 색인은 아무것도 더하지 않는다')

console.log('통과: 골든(색인 없음·빈 색인·v1 색인 = buildCaseDigest), 합치기, 2자리/4자리, 사례형 전용, 중복 인용, stub 제외')

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
  goldenSame(qs, '실데이터')
  const idx = read(path.join(caseDir, '_index.json')) as CaseIndex
  let rebuilt = 0
  for (const c of idx.cards) {
    for (const p of c.problems) {
      if (p.cases?.length || p.stubFor) continue
      const cp = read(path.join(caseDir, `${c.id}.json`)).problems.find((x: { id: string }) => x.id === p.id)
      const html = (cp?.answer?.blocks ?? []).map((b: { html: string }) => b.html).join(' ')
      const marks = [...html.matchAll(/<mark class="case">(.*?)<\/mark>/g)].map((m) => m[1])
      if (marks.length) { p.cases = marks; rebuilt++ }
    }
  }
  const base = buildCaseDigest(qs)
  const uni = buildUnifiedCaseDigest(qs, idx)
  const csGroups = uni.groups.filter((g) => g.counts.caseStudy > 0)
  const overlap = csGroups.filter((g) => g.counts.objective > 0).length
  const onlyCs = csGroups.length - overlap
  const csRefs = uni.groups.reduce((n, g) => n + g.counts.caseStudy, 0)
  console.log(`실데이터 통계${rebuilt ? ` (색인 v1 → 문항 ${rebuilt}개의 cases 를 카드 답안 mark.case 로 재현)` : ''}`)
  console.log(`  선택형: 문제 ${qs.length}개 · 판례 그룹 ${base.totalGroups}개`)
  console.log(`  사례형: 문항 단위 인용 ${csRefs}건 · 판례 ${csGroups.length}종 (선택형과 겹침 ${overlap}종 / 사례형 전용 ${onlyCs}종)`)
  console.log(`  통합: 판례 그룹 ${base.totalGroups} → ${uni.totalGroups}개 (+${uni.totalGroups - base.totalGroups}) · 선택형 그룹 기존 필드 동일`)
  assert.equal(uni.totalGroups, base.totalGroups + onlyCs)
  assert.equal(legacy({ ...uni, groups: uni.groups.slice(0, base.totalGroups), totalGroups: base.totalGroups }), legacy(base), '통합 후에도 선택형 그룹 기존 필드 동일')
}
