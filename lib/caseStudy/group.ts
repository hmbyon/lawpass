// 상대 경로: lib/caseDigest.ts 를 거쳐 check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import type { CaseIndex, IndexCard, IndexProblem } from './types'

export type SubjectFilter = '전체' | '민법' | '민소'

const SUBJECT_ORDER = ['민법', '민소']

export function problemLabel(p: Pick<IndexProblem, 'kind' | 'exam' | 'qno' | 'sub'>): string {
  const exam = p.kind === '변시' ? `변시 ${p.exam}회` : `모의 ${p.exam}`
  return [exam, p.qno, p.sub].filter(Boolean).join(' ')
}

// 답안이 실제로 있는 곳. stub 문항이면 그 카드·문항으로 보낸다
export function answerTarget(card: IndexCard, p: IndexProblem): { card: string; problem: string } {
  if (!p.stubFor) return { card: card.id, problem: p.id }
  // 문항 id 는 '{카드id}#{번호}' 이다
  if (typeof p.stubFor === 'string') return { card: p.stubFor.split('#')[0], problem: p.stubFor }
  return p.stubFor
}

// 과목 → 교재 순서(order). 이전/다음 카드도 이 순서를 따른다
export function sortCards(cards: IndexCard[]): IndexCard[] {
  return [...cards].sort(
    (a, b) =>
      SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject) ||
      a.order[0] - b.order[0] ||
      a.order[1] - b.order[1]
  )
}

export function filterCards(index: CaseIndex, subject: SubjectFilter, query: string): IndexCard[] {
  const q = query.trim().toLowerCase()
  return sortCards(index.cards).filter((c) => {
    if (subject !== '전체' && c.subject !== subject) return false
    if (!q) return true
    const hay = [c.id, c.title, c.chapter, c.category, ...c.problems.map(problemLabel)].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export interface ChapterGroup {
  category: string
  chapters: { chapter: string; cards: IndexCard[] }[]
}

// 진도별: 정렬된 순서를 지킨 채 category → chapter 로 묶는다 (처음 나온 순서가 곧 교재 순서다)
export function groupByChapter(cards: IndexCard[]): ChapterGroup[] {
  const out: ChapterGroup[] = []
  for (const c of cards) {
    let cat = out[out.length - 1]
    if (!cat || cat.category !== c.category) out.push((cat = { category: c.category, chapters: [] }))
    let ch = cat.chapters[cat.chapters.length - 1]
    if (!ch || ch.chapter !== c.chapter) cat.chapters.push((ch = { chapter: c.chapter, cards: [] }))
    ch.cards.push(c)
  }
  return out
}

export interface ExamGroup {
  key: string
  label: string
  items: { problem: IndexProblem; target: { card: string; problem: string } }[]
}

function mockValue(exam: number | string): number {
  // '25.10' 은 숫자로 읽으면 25.1 이 되어 25.8 보다 앞선다. 연·월을 나눠 센다
  const [y, m] = String(exam).split('.').map(Number)
  return (y || 0) * 100 + (m || 0)
}

// 회차별: 변시 11→15회, 그다음 모의 최신순. 같은 문항이 stub 과 본 답안으로 두 번 나오면 한 번만 둔다
export function groupByExam(cards: IndexCard[]): ExamGroup[] {
  const groups = new Map<string, ExamGroup & { kind: string; exam: number | string }>()
  const seen = new Set<string>()
  for (const c of cards) {
    for (const p of c.problems) {
      const target = answerTarget(c, p)
      const dedupe = `${target.card}|${target.problem}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      const key = `${p.kind}|${p.exam}`
      let g = groups.get(key)
      if (!g) {
        g = { key, kind: p.kind, exam: p.exam, label: p.kind === '변시' ? `변시 제${p.exam}회` : `모의 ${p.exam}`, items: [] }
        groups.set(key, g)
      }
      g.items.push({ problem: p, target })
    }
  }
  const coll = new Intl.Collator('ko', { numeric: true })
  const list = [...groups.values()]
  for (const g of list) {
    g.items.sort((a, b) => coll.compare(a.problem.qno, b.problem.qno) || coll.compare(a.problem.sub ?? '', b.problem.sub ?? ''))
  }
  return list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === '변시' ? -1 : 1
    return a.kind === '변시' ? Number(a.exam) - Number(b.exam) : mockValue(b.exam) - mockValue(a.exam)
  })
}
