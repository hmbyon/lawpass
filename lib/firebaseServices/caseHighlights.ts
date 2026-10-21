import { db } from '@/lib/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { Highlight } from '@/lib/highlights'

/**
 * 사례형 문제 본문·모범답안의 형광펜과 숨긴 기존 표시 — 사용자 본인 트리 아래 문항마다 문서 하나.
 *
 *   users/{uid}/{mode}/caseHighlights/problems/{problemId}   { highlights, hidden, updatedAt }
 *
 * 카드 데이터(관리자 트리의 caseStudy)와도, 선택형 형광펜(users/{uid}/{mode}/highlights,
 * 로컬 lawpass_highlights_*)과도 갈린다. firestore.rules 의 본인 규칙만 걸린다
 */
export interface CaseHighlightRecord {
  highlights: Highlight[]
  // 숨긴 기존 표시(모범답안의 조문·판례 칠, 밑줄, 굵게). '{field}:{서식 id}' — 예 'a12@1k3j9x:law:3-20'.
  // field 에 블록 글자 해시가 들어 있어 카드가 고쳐지면 옛 키는 무시된다(지우지 않는다)
  hidden?: string[]
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
