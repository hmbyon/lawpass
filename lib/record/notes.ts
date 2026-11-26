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
  bg?: 'g1' | 'g2' // 셀 배경 (g1 진한 회색 머리칸, g2 옅은 회색)
}
export type NoteBlock =
  | { t: 'p'; h: string; ind?: number; al?: 'c' | 'r'; hg?: 1; fl?: 1 } // hg 내어쓰기, fl 첫 줄 들여쓰기
  | { t: 'table'; rows: NoteCell[][]; sz?: 's' } // sz 's' = 원본에서 글자가 작은 표(기출 쟁점 표)
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

/** 제목이 빈 항목 — 머리줄 없이 본문을 펼쳐 둔다 */
export function isUntitledItem(item: { title?: unknown }): boolean {
  return typeof item.title !== 'string' || item.title.trim() === ''
}

/** 문단 정렬 클래스 (허용값만) */
export function alignClass(al: unknown): string {
  return al === 'c' ? 'text-center' : al === 'r' ? 'text-right' : ''
}

/** 표 셀 배경 클래스 (허용값만) */
export function cellBgClass(bg: unknown): string {
  return bg === 'g1' || bg === 'g2' ? `note-bg-${bg}` : ''
}

/** 기재례 박스: 1열 표 — 행이 1개 이상이고 모든 행에 셀이 정확히 1개(여러 열을 차지하는 셀 없음) */
export function isBoxTable(block: NoteBlock): boolean {
  return (
    block?.t === 'table' &&
    Array.isArray(block.rows) &&
    block.rows.length > 0 &&
    block.rows.every((row) => Array.isArray(row) && row.length === 1 && clampSpan(row[0]?.cs) === 1)
  )
}

/** 표 글자 크기: sz 's' 만 작게, 나머지는 본문 문단과 같은 크기 */
export function tableSizeClass(block: { sz?: unknown }): string {
  return block?.sz === 's' ? 'text-xs' : 'text-sm'
}

/** 기출 항목: 소항목이 1개 이상이고 모든 소항목에 회차 태그가 있다 */
export function isExamItem(item: NotesIndexItem): boolean {
  const subs = item.subs ?? []
  return subs.length > 0 && subs.every((s) => (s.exams?.length ?? 0) > 0)
}

/** 기출 항목의 회차 칩 (변시 번호순 → 모의 연·월순). 기출 항목이 아니면 없다 */
export function examChipsOfItem(item: NotesIndexItem): string[] {
  return isExamItem(item) ? sortedExamKeys((item.subs ?? []).flatMap((s) => s.exams ?? [])) : []
}

/**
 * 회차 칩으로 고른 소항목. 색인 item.subs[i] 와 본문 body.subs[i] 는 같은 순서라 인덱스로 맞춘다.
 * 고른 칩이 없으면 전부. 고른 키에 맞는 소항목이 하나도 없으면(색인·본문이 어긋난 경우) 빈 화면 대신 전부를 보여준다
 */
export function subsForExam<S>(body: { subs?: S[] }, item: NotesIndexItem, key: string | null | undefined): S[] {
  const all = body.subs ?? []
  if (!key) return all
  const picked = all.filter((_, i) => (item.subs?.[i]?.exams ?? []).some((e) => examKey(e) === key))
  return picked.length > 0 ? picked : all
}

/** 본문 문단의 내어쓰기·첫 줄 들여쓰기 클래스 (허용값 1 일 때만) */
export function paragraphClass(block: { hg?: unknown; fl?: unknown }): string {
  return [block?.hg === 1 && 'note-hg', block?.fl === 1 && 'note-fl'].filter(Boolean).join(' ')
}

/**
 * 본문 문단의 왼쪽 여백(rem). 들여쓰기는 인라인 style 로 주므로, 내어쓰기(hg)의 한 칸(1.25rem)도
 * 여기에 더한다 — CSS .note-hg 의 padding-left 는 인라인 style 에 가려진다
 */
export function paragraphPadding(block: { ind?: unknown; hg?: unknown }): number {
  return (clampIndent(block?.ind) + (block?.hg === 1 ? 1 : 0)) * 1.25
}
