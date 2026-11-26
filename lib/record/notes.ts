/**
 * 기록형 정리본 — 데이터 형식과 화면이 쓰는 순수 함수.
 *
 *   users/{ADMIN_UID}/{mode}/caseStudy/notes/{id}      정리본 문서 (부 하나 = 문서 하나)
 *   users/{ADMIN_UID}/{mode}/caseStudy/notes/_index    색인 (본문 blocks 없음)
 *
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */

export interface NoteExam {
  kind: '변시' | '모의'
  exam: string | number // '14', '24.6'
}
export interface NoteCell {
  h: string
  cs?: number
  rs?: number
}
export type NoteBlock = { t: 'p'; h: string; ind?: number } | { t: 'table'; rows: NoteCell[][] }
export interface NoteSub {
  title: string
  blocks: NoteBlock[]
  exams?: NoteExam[]
}
export interface NoteItem {
  id: string
  title: string
  blocks: NoteBlock[]
  subs: NoteSub[]
  exams?: NoteExam[]
}
export interface NoteDoc {
  schema: 1
  id: string
  subject: string
  title: string
  part: string | number
  items: NoteItem[]
}

export interface NotesIndexItem {
  id: string
  title: string
  exams?: NoteExam[]
  subs?: { title: string; exams?: NoteExam[] }[]
}
export interface NotesIndexDoc {
  id: string
  subject: string
  part: string | number
  order: number
  items: NotesIndexItem[]
}
export interface NotesIndex {
  schema: 1
  docs: NotesIndexDoc[]
}

// 색인 문서 id. 정리본 문서가 이 id 를 쓰면 색인을 덮으므로 가져오기에서 막는다
export const NOTES_INDEX_ID = '_index'

const SUBJECT_ORDER = ['공법', '민사', '형사']
const subjectRank = (s: string) => (SUBJECT_ORDER.includes(s) ? SUBJECT_ORDER.indexOf(s) : SUBJECT_ORDER.length)

/** 과목 칩 순서: 공법 → 민사 → 형사, 그 밖은 뒤 */
export function noteSubjects(index: NotesIndex): string[] {
  return Array.from(new Set(index.docs.map((d) => d.subject))).sort((a, b) => subjectRank(a) - subjectRank(b))
}

/** 그 과목의 부 목록 (order 순) */
export function notePartsOf(index: NotesIndex, subject: string): NotesIndexDoc[] {
  return index.docs.filter((d) => d.subject === subject).sort((a, b) => a.order - b.order)
}

/** 부 라벨. 숫자만 있으면 '1부', 아니면 그대로 */
export function partLabel(part: string | number): string {
  const s = String(part).trim()
  return /^\d+$/.test(s) ? `${s}부` : s
}

/** 회차 칩 라벨이자 비교 key — "변시 14", "모의 24.6" */
export function examKey(e: NoteExam): string {
  return `${e.kind} ${String(e.exam).trim()}`
}

// 변시 → 모의, 그다음 번호순. 모의 '24.10' 이 '24.6' 뒤에 오도록 점 앞뒤를 따로 숫자로 견준다
function examCompare(a: NoteExam, b: NoteExam): number {
  const kr = (k: string) => (k === '변시' ? 0 : k === '모의' ? 1 : 2)
  if (kr(a.kind) !== kr(b.kind)) return kr(a.kind) - kr(b.kind)
  const pa = String(a.exam).split('.').map(Number)
  const pb = String(b.exam).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

/** 회차 목록을 중복 없이 정렬해 라벨로 */
export function sortedExamKeys(exams: NoteExam[]): string[] {
  const seen = new Map<string, NoteExam>()
  for (const e of exams) if (e && (e.kind === '변시' || e.kind === '모의')) seen.set(examKey(e), e)
  return [...seen.values()].sort(examCompare).map(examKey)
}

/** 항목 하나에 달린 회차 전부 (항목 + 소항목) */
export function itemExams(item: NotesIndexItem): NoteExam[] {
  return [...(item.exams ?? []), ...(item.subs ?? []).flatMap((s) => s.exams ?? [])]
}

/** 회차 칩 후보: 그 과목 색인의 회차 전부. 비면 칩 줄을 숨긴다 */
export function examChipsFor(index: NotesIndex, subject: string): string[] {
  return sortedExamKeys(notePartsOf(index, subject).flatMap((d) => d.items.flatMap(itemExams)))
}

/** 회차 칩 필터. 고른 칩이 없으면 그대로, 있으면 그중 하나라도 항목·소항목에 달린 것만 */
export function filterNoteItems<T extends NotesIndexItem>(items: T[], selected: string[]): T[] {
  if (selected.length === 0) return items
  return items.filter((it) => itemExams(it).some((e) => selected.includes(examKey(e))))
}

/** 본문도 소항목도 없는 항목 — 목록에 '작성 중'으로 흐리게 */
export function isEmptyNoteItem(item: Pick<NoteItem, 'blocks' | 'subs'>): boolean {
  return (item.blocks?.length ?? 0) === 0 && (item.subs?.length ?? 0) === 0
}

/** 표 셀 colSpan/rowSpan — 정수 1~20 */
export function clampSpan(n: unknown): number {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) ? Math.min(20, Math.max(1, v)) : 1
}

/** 문단 들여쓰기 칸 수 — 정수 0~6 */
export function clampIndent(n: unknown): number {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) ? Math.min(6, Math.max(0, v)) : 0
}
