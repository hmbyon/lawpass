import { db } from '@/lib/firebase'
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import type { CaseStar, StarBackend } from '@/lib/caseStudy/d1Stars'

/**
 * 사례형 D-1 암기장 '전날 볼 것' 찜 — 사용자 본인 트리 아래 문항마다 문서 하나.
 *
 *   users/{uid}/{mode}/caseD1/stars/{problemId}   { problemId, cardId, starredAt }
 *
 * 풀이 기록(caseAttempts)·형광펜(caseHighlights)과 갈린 새 경로다. 해제하면 그 문서를 지운다.
 * firestore.rules 의 본인 규칙(users/{userId}/**)만 걸린다
 */
const starsRef = (uid: string, mode: string) => collection(db, 'users', uid, mode, 'caseD1', 'stars')

export function caseStarBackend(uid: string, mode: string): StarBackend {
  return {
    list: async () => (await getDocs(starsRef(uid, mode))).docs.map((d) => d.data() as CaseStar),
    put: (s) => setDoc(doc(starsRef(uid, mode), s.problemId), s),
    remove: (problemId) => deleteDoc(doc(starsRef(uid, mode), problemId)),
  }
}
