// 상대 경로: check:record-notes 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import type { Card, CaseIndex } from './types'
import { sanitizeCardCases, sanitizeIndexCases } from './sanitize'
import { NOTES_INDEX_ID, type NoteDoc, type NotesIndex } from '../record/notes'
import type { RecordCardsDoc } from '../record/cardStorage'

// warnings: 파일은 받되 일부 항목(cases)을 버렸다는 알림. 저장을 막지 않는다
export type ParsedFile =
  | { kind: 'index'; name: string; index: CaseIndex; warnings: string[] }
  | { kind: 'card'; name: string; card: Card; warnings: string[] }
  | { kind: 'note'; name: string; note: NoteDoc; warnings: string[] }
  | { kind: 'notesIndex'; name: string; index: NotesIndex; warnings: string[] }
  | { kind: 'recordCards'; name: string; cards: RecordCardsDoc; warnings: string[] }

// Firestore 문서 id 로 쓰므로 '/' 가 들어가면 경로가 갈라진다. '_index' 는 정리본 색인 자리라 막는다
function checkNoteId(id: unknown, what: string): string {
  if (typeof id !== 'string' || !id) throw new Error(`${what} id 가 없습니다`)
  if (id.includes('/')) throw new Error(`${what} id 에 '/' 가 들어 있습니다 (${id})`)
  if (id === NOTES_INDEX_ID) throw new Error(`${what} id 로 '${NOTES_INDEX_ID}' 는 쓸 수 없습니다`)
  return id
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// 기록형 정리본 색인(_notes_index.json)
function parseNotesIndex(name: string, obj: Record<string, unknown>): ParsedFile {
  if (!Array.isArray(obj.docs)) throw new Error('docs 배열이 없습니다')
  for (const d of obj.docs) {
    if (!isObj(d)) throw new Error('docs 에 객체가 아닌 항목이 있습니다')
    const id = checkNoteId(d.id, '정리본 색인 항목')
    if (typeof d.subject !== 'string') throw new Error(`${id}: subject 가 문자열이 아닙니다`)
    if (!Array.isArray(d.items)) throw new Error(`${id}: items 배열이 없습니다`)
  }
  return { kind: 'notesIndex', name, index: obj as unknown as NotesIndex, warnings: [] }
}

// 기록형 문제 풀기 카드 묶음 (kind 'recordCards')
function parseRecordCards(name: string, obj: Record<string, unknown>): ParsedFile {
  const id = checkNoteId(obj.id, '기록형 카드')
  if (typeof obj.subject !== 'string') throw new Error('subject 가 문자열이 아닙니다')
  const cards = obj.cards as unknown[]
  cards.forEach((c, i) => {
    if (!isObj(c)) throw new Error(`${id}: cards[${i}] 가 객체가 아닙니다`)
    for (const k of ['id', 'label', 'title'] as const) {
      if (typeof c[k] !== 'string' || !c[k]) throw new Error(`${id}: cards[${i}].${k} 가 없습니다`)
    }
    if (!Array.isArray(c.rows) || !c.rows.every(Array.isArray)) throw new Error(`${id}: cards[${i}].rows 가 배열의 배열이 아닙니다`)
  })
  return { kind: 'recordCards', name, cards: obj as unknown as RecordCardsDoc, warnings: [] }
}

// 기록형 정리본 문서 (최상위 items, problems 없음)
function parseNote(name: string, obj: Record<string, unknown>): ParsedFile {
  const id = checkNoteId(obj.id, '정리본')
  if (typeof obj.subject !== 'string') throw new Error('subject 가 문자열이 아닙니다')
  if (typeof obj.title !== 'string') throw new Error('title 이 문자열이 아닙니다')
  const items = obj.items as unknown[]
  items.forEach((it, i) => {
    if (!isObj(it)) throw new Error(`${id}: items[${i}] 가 객체가 아닙니다`)
    if (!Array.isArray(it.blocks)) throw new Error(`${id}: items[${i}].blocks 가 배열이 아닙니다`)
    if (!Array.isArray(it.subs)) throw new Error(`${id}: items[${i}].subs 가 배열이 아닙니다`)
  })
  return { kind: 'note', name, note: obj as unknown as NoteDoc, warnings: [] }
}

// 가져오기 전 최소 검증. 형식이 어긋난 파일은 저장하지 않고 사유를 돌려준다(throw)
export function parseCaseFile(name: string, text: string): ParsedFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('JSON 형식이 아닙니다')
  }
  const obj = data as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('최상위가 객체가 아닙니다')
  if (obj.schema !== 1) throw new Error(`schema 가 1 이 아닙니다 (${String(obj.schema)})`)
  if (name === '_index.json') {
    if (!Array.isArray(obj.cards)) throw new Error('cards 배열이 없습니다')
    if (obj.cards.some((c) => typeof (c as { id?: unknown })?.id !== 'string')) throw new Error('id 없는 색인 항목이 있습니다')
    const index = obj as unknown as CaseIndex
    return { kind: 'index', name, index, warnings: sanitizeIndexCases(index) }
  }
  if (name === '_notes_index.json') return parseNotesIndex(name, obj)
  if (obj.kind === 'recordCards' && Array.isArray(obj.cards)) return parseRecordCards(name, obj)
  if (Array.isArray(obj.items) && !('problems' in obj)) return parseNote(name, obj)
  if (typeof obj.id !== 'string' || !obj.id) throw new Error('id 가 없습니다')
  // Firestore 문서 id 로 쓰므로 '/' 가 들어가면 경로가 갈라진다
  if (obj.id.includes('/')) throw new Error(`id 에 '/' 가 들어 있습니다 (${obj.id})`)
  if (!Array.isArray(obj.problems)) throw new Error('problems 배열이 없습니다')
  const card = obj as unknown as Card
  return { kind: 'card', name, card, warnings: sanitizeCardCases(card) }
}

// 일괄 쓰기 단위로 나눈다. 건수와 바이트 둘 다 넘지 않게 — 항목 하나가 예산을 넘으면 그것만 단독 묶음이다
export function chunkForBatch<T>(items: T[], maxOps: number, maxBytes: number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let bytes = 0
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).length
    if (cur.length > 0 && (cur.length >= maxOps || bytes + size > maxBytes)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(item)
    bytes += size
  }
  if (cur.length > 0) out.push(cur)
  return out
}
