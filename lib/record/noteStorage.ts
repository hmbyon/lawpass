/**
 * 정리본 문서 ↔ Firestore 저장 형태.
 *
 * Firestore 는 배열 안의 배열을 저장하지 못한다. 정리본에서 그런 자리는 표 블록의 rows([[셀…]…]) 하나뿐이라
 * 저장할 때 행을 객체로 감싸고({ c: [셀…] }) 읽을 때 되돌린다. 업로드 JSON 과 화면 쪽 형식(NoteDoc)은 그대로다.
 * (items[].exams·subs[].exams·blocks 는 객체의 배열이라 그대로 저장된다. 색인에는 중첩 배열이 없다)
 *
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */
import type { NoteBlock, NoteCell, NoteDoc } from './notes'

type StoredRow = { c: NoteCell[] }

/** 표의 행을 { c: [...] } 로 감싼다 (기록형 카드 저장도 쓴다) */
export function encodeRows(rows: NoteCell[][]): StoredRow[] {
  return rows.map((row) => ({ c: row }))
}

/** { c: [...] } 행을 배열로 되돌린다. 옛 형태(행이 배열)도 그대로 받는다 */
export function decodeRows(rows: unknown[]): NoteCell[][] {
  return rows.map((row) =>
    Array.isArray(row) ? row : Array.isArray((row as StoredRow | null)?.c) ? (row as StoredRow).c : []
  ) as NoteCell[][]
}

function mapBlocks(doc: NoteDoc, fn: (b: NoteBlock) => NoteBlock): NoteDoc {
  const blocks = (list: NoteBlock[]) => (Array.isArray(list) ? list.map(fn) : list)
  return {
    ...doc,
    items: (doc.items ?? []).map((it) => ({
      ...it,
      blocks: blocks(it.blocks),
      subs: Array.isArray(it.subs) ? it.subs.map((s) => ({ ...s, blocks: blocks(s.blocks) })) : it.subs,
    })),
  }
}

/** 저장용: 표의 행을 { c: [...] } 로 감싼다. 입력은 바꾸지 않는다 */
export function encodeNoteForStore(doc: NoteDoc): NoteDoc {
  return mapBlocks(doc, (b) =>
    b?.t === 'table' && Array.isArray(b.rows)
      ? ({ ...b, rows: encodeRows(b.rows) } as unknown as NoteBlock)
      : b
  )
}

/** 읽은 뒤: { c: [...] } 행을 배열로 되돌린다. 옛 형태(행이 배열)도 그대로 받는다 */
export function decodeNoteFromStore(doc: NoteDoc): NoteDoc {
  return mapBlocks(doc, (b) => {
    if (b?.t !== 'table' || !Array.isArray(b.rows)) return b
    return { ...b, rows: decodeRows(b.rows as unknown[]) }
  })
}
