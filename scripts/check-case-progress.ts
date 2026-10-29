/**
 * 사례형 학습 현황 집계(lib/caseStudy/progress) 검증 (check:case-progress). 화면·Firestore 없음.
 * 풀어본 문항 = 제출한 시도의 answers 문항 id(임시저장 제외, 중복 한 번). 과목별·시험별·단원별·진도표 합이 전체와 같은지 본다.
 * CASE_JSON_DIR(카드 JSON 폴더)이나 아래 기본 폴더에 _index.json 이 있으면 실제 색인에 가짜 시도를 만들어 같은 것을 확인한다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { caseProgress, groupRows, groupRowsByYear, solvedProblemIds, type CaseProgress } from '../lib/caseStudy/progress'
import type { CaseAttempt } from '../lib/caseStudy/solve'
import type { CaseIndex, IndexCard, IndexProblem } from '../lib/caseStudy/types'

const prob = (id: string, kind: string, exam: number | string, extra: Partial<IndexProblem> = {}): IndexProblem =>
  ({ id, kind, exam, qno: '제1문', points: 30, cases: [], ...extra }) as IndexProblem
const card = (id: string, subject: string, category: string, order: number, problems: IndexProblem[]): IndexCard =>
  ({ id, subject, category, chapter: '', order: [order, 1], title: id, pages: '', problems })
const attempt = (id: string, status: CaseAttempt['status'], pids: string[]): CaseAttempt =>
  ({
    id, setKey: pids.join(','), problemIds: pids, answers: pids.map((problemId) => ({ problemId, boxes: ['답'] })),
    status, elapsedSeconds: 0, targetMinutes: null, startedAt: 0, updatedAt: 0, submittedAt: status === 'submitted' ? 1 : null,
  })

// 합이 서로 맞는지 — 과목별 합 = 시험별 합 = 진도표 칸 합 = 연도별·단원별 묶음 합 = 전체
function assertSums(r: CaseProgress, what: string) {
  const sum = (xs: { total: number; solved: number }[]) => [xs.reduce((n, x) => n + x.total, 0), xs.reduce((n, x) => n + x.solved, 0)]
  const whole = [r.total, r.solved]
  assert.deepEqual(sum(r.subjects), whole, `${what}: 과목별 합`)
  assert.deepEqual(sum(r.exams), whole, `${what}: 시험별 합`)
  assert.deepEqual(sum(r.rows), whole, `${what}: 진도표 칸 합`)
  for (const s of r.subjects) {
    const rows = r.rows.filter((x) => x.subject === s.subject)
    assert.deepEqual(sum(groupRowsByYear(rows)), [s.total, s.solved], `${what}: ${s.subject} 연도별 합`)
    assert.deepEqual(sum(groupRows(rows, (x) => x.unit)), [s.total, s.solved], `${what}: ${s.subject} 단원별 합`)
  }
  assert.ok(r.solved <= r.total, `${what}: 푼 문항 ≤ 전체`)
}

// ── 1. 가짜 색인 ──────────────────────────────────────────────
const index: CaseIndex = {
  schema: 1,
  cards: [
    // 일부러 교재 순서와 다르게 넣는다(형법 카드가 먼저)
    card('형-1', '형법', '형법 · 총론', 1, [prob('형-1#1', '변시', 15), prob('형-1#2', '모의', '25.10')]),
    card('민-2', '민법', '민법 · 채권', 2, [prob('민-2#1', '변시', 1), prob('민-2#2', '유사', '')]),
    card('민-1', '민법', '민법 · 총칙', 1, [
      prob('민-1#1', '변시', 1),
      prob('민-1#2', '모의', '24.6'),
      // stub(답안이 다른 카드에 있음)은 세지 않는다
      prob('민-1#3', '변시', 1, { stubFor: '민-2#1' }),
    ]),
    card('소-1', '민소', '민소 · 소송요건', 1, [prob('소-1#1', '변시', 15), prob('민-1#1', '변시', 1)]), // 같은 id 는 한 번
  ],
}
const attempts = [
  attempt('a1', 'submitted', ['민-1#1', '형-1#1']),
  attempt('a2', 'submitted', ['민-1#1']), // 같은 문항을 다시 제출 → 한 번
  attempt('a3', 'draft', ['민-2#1', '소-1#1']), // 임시저장만 → 세지 않는다
  attempt('a4', 'submitted', ['사라진-1#1', '민-2#2']), // 색인에 없는 id 는 세지 않는다
]

assert.deepEqual([...solvedProblemIds(attempts)].sort(), ['민-1#1', '민-2#2', '사라진-1#1', '형-1#1'])
const r = caseProgress(index, attempts)
assert.equal(r.total, 7, 'stub·중복 id 제외')
assert.equal(r.solved, 3, '임시저장·중복·사라진 id 제외')
assert.equal(r.examCount, 4, '변시 1·15회, 모의 24.6·25.10 (유사 제외)')
assert.deepEqual(r.subjects.map((s) => [s.label, s.solved, s.total, s.minYear, s.maxYear]), [
  ['민법', 2, 4, 2012, 2024],
  ['민사소송법', 0, 1, 2026, 2026],
  ['형법', 1, 2, 2025, 2026],
])
assert.deepEqual(r.exams.map((e) => [e.label, e.solved, e.total]), [
  ['변시 1회', 1, 2], ['변시 15회', 1, 2], ['모의 25.10', 0, 1], ['모의 24.6', 0, 1], ['유사', 1, 1],
])
// 진도표: 과목 교재 순서(민법 총칙 → 채권 → 민소 → 형법)
assert.deepEqual(r.rows.map((x) => `${x.subject}|${x.exam}|${x.unit}|${x.solved}/${x.total}`), [
  '민법|변시 1회|총칙|1/1', '민법|모의 24.6|총칙|0/1', '민법|변시 1회|채권|0/1', '민법|유사|채권|1/1',
  '민소|변시 15회|소송요건|0/1', '형법|변시 15회|총론|1/1', '형법|모의 25.10|총론|0/1',
])
assert.deepEqual(groupRowsByYear(r.rows.filter((x) => x.subject === '민법')).map((g) => [g.key, g.solved, g.total]), [
  [2024, 0, 1], [2012, 1, 2], [null, 1, 1],
], '연도별: 최신 → 연도 없음은 뒤')
assertSums(r, '가짜 색인')

// ── 2. 빈 경우: 오류 없이 0 ──────────────────────────────────
assert.deepEqual(caseProgress(index, []).solved, 0)
assert.deepEqual(caseProgress(null, attempts), { total: 0, solved: 0, examCount: 0, subjects: [], exams: [], rows: [] })

// ── 3. 실제 색인(있으면) ─────────────────────────────────────
const DEFAULT_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
)
const file = path.join(process.env.CASE_JSON_DIR || DEFAULT_DIR, '_index.json')
if (fs.existsSync(file)) {
  const real = JSON.parse(fs.readFileSync(file, 'utf8')) as CaseIndex
  const ids = real.cards.flatMap((c) => c.problems.filter((p) => !p.stubFor).map((p) => p.id))
  // 세 번째 문항마다 제출, 다섯 번째마다 한 번 더 제출, 일곱 번째마다 임시저장만
  const fake = [
    ...ids.filter((_, i) => i % 3 === 0).map((id, i) => attempt(`s${i}`, 'submitted', [id])),
    ...ids.filter((_, i) => i % 5 === 0 && i % 3 === 0).map((id, i) => attempt(`d${i}`, 'submitted', [id])),
    ...ids.filter((_, i) => i % 7 === 0 && i % 3 !== 0).map((id, i) => attempt(`t${i}`, 'draft', [id])),
  ]
  const rr = caseProgress(real, fake)
  assert.equal(rr.total, new Set(ids).size)
  assert.equal(rr.solved, new Set(ids.filter((_, i) => i % 3 === 0)).size)
  assertSums(rr, '실제 색인')
  console.log(`  실제 색인: 문항 ${rr.total}개 · 가짜로 푼 문항 ${rr.solved}개 · 시험 ${rr.examCount}개 · 과목 ${rr.subjects.length}개`)
} else {
  console.log('  실제 색인 없음 — 가짜 색인만 확인')
}

console.log('check:case-progress 통과')
