import { db } from '@/lib/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ADMIN_UID, byteLength } from '@/lib/firebaseServices/sync'
import type { Card, CaseIndex } from '@/lib/caseStudy/types'

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

export async function fetchCaseIndex(mode: string): Promise<CaseIndex | null> {
  const snap = await getDoc(indexRef(mode))
  return snap.exists() ? (snap.data() as CaseIndex) : null
}

export async function fetchCaseCard(mode: string, id: string): Promise<Card | null> {
  const snap = await getDoc(cardRef(mode, id))
  return snap.exists() ? (snap.data() as Card) : null
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
