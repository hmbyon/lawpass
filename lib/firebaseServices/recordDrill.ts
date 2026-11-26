import { db } from '@/lib/firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { DrillRecord, DrillResults } from '@/lib/record/drillProgress'

/**
 * 기록형 문제 풀기 자가채점 결과 — 사용자 본인 트리 아래 문서 하나에 카드 id → 결과 map.
 *
 *   users/{uid}/{mode}/recordDrill/results/cards   { results: { [cardId]: DrillRecord } }
 *
 * 사례형 풀이 기록(caseAttempts)·D-1 찜(caseD1)과 같은 꼴의 경로다. firestore.rules 의 본인 규칙
 * (users/{userId}/**)만 걸린다 — 본인만 읽고 쓴다. 카드가 149장 규모라 문서 하나로 충분하다
 */
const resultsRef = (uid: string, mode: string) => doc(db, 'users', uid, mode, 'recordDrill', 'results', 'cards')

export async function fetchDrillResults(uid: string, mode: string): Promise<DrillResults> {
  const snap = await getDoc(resultsRef(uid, mode))
  return snap.exists() ? ((snap.data().results ?? {}) as DrillResults) : {}
}

// 카드 하나만 합쳐 쓴다(merge). 객체 키로 넘기므로 카드 id 의 '.' 등이 필드 경로로 해석되지 않는다
export async function saveDrillResult(uid: string, mode: string, cardId: string, rec: DrillRecord): Promise<void> {
  await setDoc(resultsRef(uid, mode), { results: { [cardId]: rec } }, { merge: true })
}
