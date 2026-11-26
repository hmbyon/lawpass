/**
 * 기록형 문제 풀기 카드 — 데이터 형식과 Firestore 저장 형태.
 *
 *   users/{ADMIN_UID}/{mode}/caseStudy/recordCards/{id}   카드 묶음 문서 (카드-{공법·민사·형사}-{변시·모의})
 *
 * 카드 표(rows)는 정리본 표 블록과 같은 모양이라 Firestore 에 그대로 못 쓴다(배열 안의 배열).
 * 정리본과 같은 방식(noteStorage 의 행 감싸기)으로 저장하고 읽을 때 되돌린다.
 * 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
 */
import { decodeRows, encodeRows } from './noteStorage'
import type { NoteCell, NoteExam } from './notes'

// 색인 문서 없이 이 여섯을 읽는다. 아직 안 올린 묶음은 건너뛴다
export const RECORD_CARD_DOC_IDS = [
  '카드-민사-변시', '카드-민사-모의', '카드-형사-변시', '카드-형사-모의', '카드-공법-변시', '카드-공법-모의',
] as const

export interface RecordCard {
  id: string
  exam: NoteExam
  label: string // '15회 변시', '26.6모'
  note: string | null // '법리 주의' 등
  no?: number | string
  title: string // 문제 제목 (민사는 청구 제목)
  parties: string // 당사자 설명 html
  rows: NoteCell[][] // 정답 표
  tailH?: string // 공통 청구취지(소송비용·가집행) html
  subject?: string // 읽을 때 묶음 문서의 subject 를 붙인다(데이터 파일에는 없다)
}

export interface RecordCardsDoc {
  schema: 1
  kind: 'recordCards'
  id: string
  subject: string
  title: string
  cards: RecordCard[]
}

/** 저장용: 카드마다 표의 행을 { c: [...] } 로 감싼다. 입력은 바꾸지 않는다 */
export function encodeCardsForStore(doc: RecordCardsDoc): RecordCardsDoc {
  return {
    ...doc,
    cards: (doc.cards ?? []).map((c) => (Array.isArray(c.rows) ? ({ ...c, rows: encodeRows(c.rows) } as unknown as RecordCard) : c)),
  }
}

/** 읽은 뒤: 행을 배열로 되돌린다. 옛 형태(행이 배열)도 그대로 받는다 */
export function decodeCardsFromStore(doc: RecordCardsDoc): RecordCardsDoc {
  return {
    ...doc,
    cards: (doc.cards ?? []).map((c) => (Array.isArray(c.rows) ? { ...c, rows: decodeRows(c.rows as unknown[]) } : c)),
  }
}

/** 묶음들의 카드를 합치며 카드마다 그 묶음의 과목(subject)을 붙인다 */
export function cardsWithSubject(docs: RecordCardsDoc[]): RecordCard[] {
  return docs.flatMap((d) => (d.cards ?? []).map((c) => ({ ...c, subject: d.subject })))
}
