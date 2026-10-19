/**
 * 판례 화면 이동·요약 줄 로직 검증 (check:case-nav).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 *
 * '마지막 탭 값 보정'은 검사하지 않는다 — app-shell 은 탭 선택값을 어디에도 저장하지 않아
 * (useState 기본값 'pdf') 'cases' 가 되살아날 길이 없다
 */
import assert from 'node:assert/strict'
import { buildUnifiedCaseDigest, caseStudyProblemCount, casesSummaryTail } from '../lib/caseDigest'
import { caseJumpStatus } from '../lib/caseStudy/group'
import type { CaseIndex } from '../lib/caseStudy/types'
import type { Question } from '../lib/types'

// ── 1. 요약 줄 ───────────────────────────────────────────────────
assert.equal(casesSummaryTail('objective', 1493, 185), '판례가 달린 문제 1493개', '선택형 칩은 예전 문구 그대로')
assert.equal(casesSummaryTail('all', 1493, 185), '선택형 문제 1493 · 사례형 문항 185')
assert.equal(casesSummaryTail('caseStudy', 1493, 185), '사례형 문항 185')

// ── 2. 사례형 문항 수: problemId 기준 고유 개수 ─────────────────────
const q = { id: 'o1', no: 1, subject: '민법', examType: '변호사시험', year: 2024, cases: [{ caseNumber: '2001다1', summary: 's' }] } as unknown as Question
const P = (id: string, cases: string[], extra: object = {}) => ({ id, kind: '변시', exam: 11, qno: '제1문', sub: '', points: 10, cases, ...extra })
const index = {
  schema: 1,
  cards: [
    { id: 'c1', subject: '민법', title: 't', problems: [P('c1#1', ['2001다1', '2002다2', '2003다3']), P('c1#2', ['2002다2']), P('c1#3', [], {})] },
    { id: 'c2', subject: '민소', title: 't', problems: [P('c2#1', ['2002다2']), P('c2#2', ['2004다4'], { stubFor: 'c1#1' })] },
  ],
} as unknown as CaseIndex
const groups = buildUnifiedCaseDigest([q], index).groups
// c1#1(판례 3개)·c1#2·c2#1 → 3문항. 판례가 없는 c1#3, stub 인 c2#2 는 세지 않는다
assert.equal(caseStudyProblemCount(groups), 3)
assert.equal(caseStudyProblemCount(buildUnifiedCaseDigest([q]).groups), 0, '색인 없으면 0')

// ── 3. '카드 보기' 이동 대상 판정 ────────────────────────────────────
const card = { problems: [{ id: 'c1#1' }, { id: 'c1#2' }] }
assert.equal(caseJumpStatus(card, 'c1#2'), 'ok')
assert.equal(caseJumpStatus(card, 'c1#9'), 'missing-problem', '카드를 다시 올리며 문항이 빠졌다')
assert.equal(caseJumpStatus(null, 'c1#1'), 'missing-card', '카드 문서가 지워졌다(fetchCaseCard → null)')
assert.equal(caseJumpStatus(undefined, 'c1#1'), 'missing-card')
assert.equal(caseJumpStatus({}, 'c1#1'), 'missing-problem', 'problems 가 없는 깨진 문서도 오류 없이')

console.log('통과: 요약 줄(칩별), 사례형 문항 고유 개수, 카드 보기 이동 대상 판정')
