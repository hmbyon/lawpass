import { db } from '@/lib/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { Highlight } from '@/lib/highlights'

/**
 * 사례형 문제 본문의 형광펜 — 사용자 본인 트리 아래 문항마다 문서 하나.
 *
 *   users/{uid}/{mode}/caseHighlights/problems/{problemId}   { highlights, updatedAt }
 *
 * 카드 데이터(관리자 트리의 caseStudy)와도, 선택형 형광펜(users/{uid}/{mode}/highlights,
 * 로컬 lawpass_highlights_*)과도 갈린다. firestore.rules 의 본인 규칙만 걸린다
 */
export interface CaseHighlightRecord {
  highlights: Highlight[]
  updatedAt: number
}

const ref = (uid: string, mode: string, problemId: string) => doc(db, 'users', uid, mode, 'caseHighlights', 'problems', problemId)

export async function fetchCaseHighlights(uid: string, mode: string, problemId: string): Promise<CaseHighlightRecord | null> {
  const snap = await getDoc(ref(uid, mode, problemId))
  return snap.exists() ? (snap.data() as CaseHighlightRecord) : null
}

export async function saveCaseHighlights(uid: string, mode: string, problemId: string, record: CaseHighlightRecord): Promise<void> {
  // 표시 항목에 undefined 필드(colors 등)가 섞일 수 있다 — Firestore 는 undefined 를 받지 않는다
  await setDoc(ref(uid, mode, problemId), JSON.parse(JSON.stringify(record)))
}
