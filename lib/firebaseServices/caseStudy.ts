import { db } from '@/lib/firebase'
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore'
import { ADMIN_UID, byteLength } from '@/lib/firebaseServices/sync'
import type { Card, CaseIndex } from '@/lib/caseStudy/types'
import { isRecordCard } from '@/lib/caseStudy/group'
import { NOTES_INDEX_ID, type NoteDoc, type NotesIndex } from '@/lib/record/notes'
import { decodeNoteFromStore, encodeNoteForStore } from '@/lib/record/noteStorage'
import { decodeCardsFromStore, encodeCardsForStore, RECORD_CARD_DOC_IDS, type RecordCardsDoc } from '@/lib/record/cardStorage'

/**
 * 사례형 카드 — 관리자 계정 트리 아래 둔다 (docs/case-study-design.md).
 *
 *   users/{ADMIN_UID}/{mode}/caseStudy              색인 문서 (schema, cards)
 *   users/{ADMIN_UID}/{mode}/caseStudy/cards/{id}   카드 문서
 *
 * 읽기는 firestore.rules 의 caseStudy 블록이 로그인한 누구에게나 연다.
 * 쓰기는 기존 본인 규칙 그대로라 관리자 계정만 성공한다
 */

// Firestore 문서 한도 1MiB 보다 여유를 둔다. 카드는 조각으로 나누지 않으므로 넘으면 저장 자체를 막는다
const MAX_DOC_BYTES = 900_000

// 한 번의 commit 에 담는 한도. Firestore 상한(쓰기 500건 · 요청 10MiB)보다 넉넉히 아래로 잡는다
export const BATCH_MAX_OPS = 450
export const BATCH_MAX_BYTES = 4_000_000

function indexRef(mode: string) {
  return doc(db, 'users', ADMIN_UID, mode, 'caseStudy')
}

function cardRef(mode: string, id: string) {
  return doc(db, 'users', ADMIN_UID, mode, 'caseStudy', 'cards', id)
}

function assertSize(value: unknown, what: string) {
  const bytes = byteLength(value)
  if (bytes > MAX_DOC_BYTES) {
    throw new Error(`${what} 크기가 ${Math.round(bytes / 1000)}KB 로 한도(900KB)를 넘습니다`)
  }
}

// 판례번호(cases)는 색인 v1.1 에서 생긴 필드다. v1 문서에는 없으므로 읽을 때 [] 로 채워 둔다
const withCases = <T extends { cases?: string[] }>(o: T): T => ({ ...o, cases: o.cases ?? [] })

// 기록형 카드는 판례 탭(includeRecord: true)만 받는다. 사례형 화면은 기본값으로 빠진 색인을 받는다
export async function fetchCaseIndex(mode: string, { includeRecord = false }: { includeRecord?: boolean } = {}): Promise<CaseIndex | null> {
  const snap = await getDoc(indexRef(mode))
  if (!snap.exists()) return null
  const index = snap.data() as CaseIndex
  const cards = includeRecord ? index.cards : index.cards.filter((c) => !isRecordCard(c))
  return { ...index, cards: cards.map((c) => ({ ...withCases(c), problems: (c.problems ?? []).map(withCases) })) }
}

export async function fetchCaseCard(mode: string, id: string): Promise<Card | null> {
  const snap = await getDoc(cardRef(mode, id))
  if (!snap.exists()) return null
  const card = snap.data() as Card
  return { ...withCases(card), problems: (card.problems ?? []).map(withCases) }
}

export async function caseCardExists(mode: string, id: string): Promise<boolean> {
  return (await getDoc(cardRef(mode, id))).exists()
}

export async function saveCaseIndex(mode: string, index: CaseIndex): Promise<void> {
  assertSize(index, '색인')
  await setDoc(indexRef(mode), index)
}

export async function saveCaseCard(mode: string, card: Card): Promise<void> {
  assertSize(card, `카드 ${card.id}`)
  await setDoc(cardRef(mode, card.id), card)
}

// 카드 여러 장을 한 번에 쓴다. 원자적이라 하나라도 거부되면 전부 안 써진다 —
// 어느 카드가 문제인지 가리려면 호출부가 saveCaseCard 로 한 장씩 다시 써야 한다
export async function saveCaseCardsBatch(mode: string, cards: Card[]): Promise<void> {
  const batch = writeBatch(db)
  for (const card of cards) {
    assertSize(card, `카드 ${card.id}`)
    batch.set(cardRef(mode, card.id), card)
  }
  await batch.commit()
}

// ── 기록형 정리본 ────────────────────────────────────────────────
//   users/{ADMIN_UID}/{mode}/caseStudy/notes/{id}     정리본 문서
//   users/{ADMIN_UID}/{mode}/caseStudy/notes/_index   색인
// 읽기는 firestore.rules 의 caseStudy/{document=**} 블록이 그대로 덮는다

function noteRef(mode: string, id: string) {
  return doc(db, 'users', ADMIN_UID, mode, 'caseStudy', 'notes', id)
}

// Firestore 는 배열 안의 배열을 못 쓴다 — 표의 행을 객체로 감싸 저장하고 읽을 때 되돌린다(lib/record/noteStorage)
export async function saveNoteDoc(mode: string, note: NoteDoc): Promise<void> {
  const stored = encodeNoteForStore(note)
  assertSize(stored, `정리본 ${note.id}`)
  await setDoc(noteRef(mode, note.id), stored)
}

export async function saveNotesIndex(mode: string, index: NotesIndex): Promise<void> {
  assertSize(index, '정리본 색인')
  await setDoc(noteRef(mode, NOTES_INDEX_ID), index)
}

export async function fetchNotesIndex(mode: string): Promise<NotesIndex | null> {
  const snap = await getDoc(noteRef(mode, NOTES_INDEX_ID))
  return snap.exists() ? (snap.data() as NotesIndex) : null
}

export async function fetchNoteDoc(mode: string, id: string): Promise<NoteDoc | null> {
  const snap = await getDoc(noteRef(mode, id))
  return snap.exists() ? decodeNoteFromStore(snap.data() as NoteDoc) : null
}

// ── 기록형 문제 풀기 카드 ────────────────────────────────────────
//   users/{ADMIN_UID}/{mode}/caseStudy/recordCards/{id}
// 정리본처럼 표의 행을 객체로 감싸 저장하고(lib/record/cardStorage) 읽을 때 되돌린다.
// 읽기는 firestore.rules 의 caseStudy/{document=**} 블록이 그대로 덮는다

function recordCardsRef(mode: string, id: string) {
  return doc(db, 'users', ADMIN_UID, mode, 'caseStudy', 'recordCards', id)
}

export async function saveRecordCardsDoc(mode: string, cards: RecordCardsDoc): Promise<void> {
  const stored = encodeCardsForStore(cards)
  assertSize(stored, `기록형 카드 ${cards.id}`)
  await setDoc(recordCardsRef(mode, cards.id), stored)
}

export async function fetchRecordCardsDoc(mode: string, id: string): Promise<RecordCardsDoc | null> {
  const snap = await getDoc(recordCardsRef(mode, id))
  return snap.exists() ? decodeCardsFromStore(snap.data() as RecordCardsDoc) : null
}

/** 색인 대신 정해 둔 카드 묶음(변시·모의)을 읽는다. 아직 안 올라온 묶음은 빠진다 */
export async function fetchAllRecordCards(mode: string): Promise<RecordCardsDoc[]> {
  const docs = await Promise.all(RECORD_CARD_DOC_IDS.map((id) => fetchRecordCardsDoc(mode, id)))
  return docs.filter((d): d is RecordCardsDoc => d !== null)
}
