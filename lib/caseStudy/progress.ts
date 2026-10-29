// 상대 경로: check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import type { CaseAttempt } from './solve'
import type { CaseIndex } from './types'
import { mockValue, sortCards } from './group'

/**
 * 사례형 학습 현황 집계. 화면·Firestore 없음 — 색인과 제출한 시도만 받아 센다.
 *  - 전체 문항: 색인에서 답안이 있는 문항(stub 제외, id 중복 제외). CBT 가 풀게 하는 범위와 같다
 *  - 풀어본 문항: 제출한(submitted) 시도의 answers 에 든 문항 id. 임시저장은 세지 않고, 여러 번 풀어도 한 번
 *  - 색인에 없는 문항 id(카드가 바뀌어 사라진 것)는 세지 않는다
 */

// 카드의 과목 값 → 화면 이름. 선택형 학습 현황과 같은 7과목·같은 순서
export const CASE_SUBJECT_LABEL: Record<string, string> = {
  민법: '민법', 민소: '민사소송법', 상법: '상법', 형법: '형법', 형소: '형사소송법', 헌법: '헌법', 행정법: '행정법',
}
const SUBJECTS = Object.keys(CASE_SUBJECT_LABEL)
const subjectRank = (s: string) => (SUBJECTS.includes(s) ? SUBJECTS.indexOf(s) : SUBJECTS.length)

// components/case-study/case-index-view 의 examYear·categoryLabel 과 같은 규칙(그 파일은 경로 별칭을 써서 여기서 못 읽는다)
export function examYear(kind: string, exam: number | string): number | null {
  if (kind === '변시') return Number.isFinite(Number(exam)) ? 2011 + Number(exam) : null
  const y = Number(String(exam).split('.')[0])
  return kind === '모의' && Number.isFinite(y) && y > 0 ? 2000 + y : null
}
const categoryLabel = (category: string, subject: string) => {
  const prefix = `${subject} · `
  return category.startsWith(prefix) ? category.slice(prefix.length) : category
}

export const examLabel = (kind: string, exam: number | string) =>
  kind === '변시' ? `변시 ${exam}회` : kind === '모의' ? `모의 ${exam}` : String(kind)

export interface Count {
  total: number
  solved: number
}

/** 진도표 한 칸: 과목 × 시험(회차) × 단원 */
export interface CaseProgressRow extends Count {
  subject: string
  examKey: string
  exam: string // examLabel
  year: number | null // 유사 등 회차가 없으면 null
  unit: string
}

export interface CaseProgress extends Count {
  /** 변시·모의고사 회차 수(유사 등 회차 없는 묶음은 뺀다) */
  examCount: number
  subjects: (Count & { subject: string; label: string; minYear: number | null; maxYear: number | null })[]
  exams: (Count & { key: string; label: string })[]
  /** 과목 → 교재 순서(단원)대로 */
  rows: CaseProgressRow[]
}

export function solvedProblemIds(attempts: CaseAttempt[]): Set<string> {
  const ids = new Set<string>()
  for (const a of attempts) {
    if (a.status !== 'submitted') continue
    for (const x of a.answers ?? []) ids.add(x.problemId)
  }
  return ids
}

export function caseProgress(index: CaseIndex | null, attempts: CaseAttempt[]): CaseProgress {
  const solvedIds = solvedProblemIds(attempts)
  const seen = new Set<string>()
  const rowMap = new Map<string, CaseProgressRow>()
  const subjects = new Map<string, CaseProgress['subjects'][number]>()
  const exams = new Map<string, CaseProgress['exams'][number] & { kind: string; exam: number | string }>()
  let total = 0
  let solved = 0
  for (const c of sortCards(index?.cards ?? [])) {
    const unit = categoryLabel(c.category, c.subject) || '(단원 미지정)'
    for (const p of c.problems) {
      if (p.stubFor || seen.has(p.id)) continue
      seen.add(p.id)
      const hit = solvedIds.has(p.id) ? 1 : 0
      const kind = p.kind as string
      const year = examYear(kind, p.exam)
      const examKey = `${kind}|${p.exam}`
      total++
      solved += hit

      const s = subjects.get(c.subject) ??
        { subject: c.subject, label: CASE_SUBJECT_LABEL[c.subject] ?? c.subject, total: 0, solved: 0, minYear: null, maxYear: null }
      s.total++
      s.solved += hit
      if (year !== null) {
        s.minYear = Math.min(s.minYear ?? year, year)
        s.maxYear = Math.max(s.maxYear ?? year, year)
      }
      subjects.set(c.subject, s)

      const e = exams.get(examKey) ?? { key: examKey, label: examLabel(kind, p.exam), kind, exam: p.exam, total: 0, solved: 0 }
      e.total++
      e.solved += hit
      exams.set(examKey, e)

      const rk = `${c.subject}|${examKey}|${unit}`
      const r = rowMap.get(rk) ?? { subject: c.subject, examKey, exam: examLabel(kind, p.exam), year, unit, total: 0, solved: 0 }
      r.total++
      r.solved += hit
      rowMap.set(rk, r)
    }
  }
  // 시험 순서는 답안·목차의 회차별과 같다: 변시 회차 순 → 모의 최신순 → 그 밖(유사)
  const kindRank = (k: string) => (k === '변시' ? 0 : k === '모의' ? 1 : 2)
  const examList = [...exams.values()].sort((a, b) =>
    a.kind !== b.kind
      ? kindRank(a.kind) - kindRank(b.kind)
      : a.kind === '변시' ? Number(a.exam) - Number(b.exam) : mockValue(b.exam) - mockValue(a.exam)
  )
  return {
    total,
    solved,
    examCount: examList.filter((e) => e.kind === '변시' || e.kind === '모의').length,
    subjects: [...subjects.values()].sort((a, b) => subjectRank(a.subject) - subjectRank(b.subject) || a.subject.localeCompare(b.subject)),
    exams: examList.map(({ key, label, total, solved }) => ({ key, label, total, solved })),
    // Map 은 넣은 순서를 지킨다 — 카드를 교재 순서로 돌았으니 rows 도 과목 → 단원 교재 순서다
    rows: [...rowMap.values()],
  }
}

/** 진도표 묶기. 처음 나온 순서를 지킨다 */
export function groupRows<K>(rows: CaseProgressRow[], keyOf: (r: CaseProgressRow) => K): { key: K; rows: CaseProgressRow[]; total: number; solved: number }[] {
  const map = new Map<K, CaseProgressRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    map.set(k, [...(map.get(k) ?? []), r])
  }
  return [...map].map(([key, rs]) => ({
    key,
    rows: rs,
    total: rs.reduce((n, r) => n + r.total, 0),
    solved: rs.reduce((n, r) => n + r.solved, 0),
  }))
}

/** 연도별 묶음: 최신 연도부터, 연도 없는 것(유사)은 맨 뒤 */
export function groupRowsByYear(rows: CaseProgressRow[]) {
  return groupRows(rows, (r) => r.year).sort((a, b) => (b.key ?? -Infinity) - (a.key ?? -Infinity))
}
