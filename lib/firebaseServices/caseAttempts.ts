import { db } from '@/lib/firebase'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import type { CaseAttempt } from '@/lib/caseStudy/solve'

/**
 * 사례형 풀이 기록 — 사용자 본인 트리 아래 시도(attempt)마다 문서 하나.
 *
 *   users/{uid}/{mode}/caseAttempts/attempts/{attemptId}
 *
 * 카드 데이터(관리자 트리의 caseStudy)와 경로가 갈린다. firestore.rules 의 본인 규칙
 * (users/{userId}/**)만 걸리므로 본인만 읽고 쓴다 — caseStudy 공개 읽기 블록에 걸리지 않는다.
 * 선택형 목록(questions 등)처럼 조각 목록으로 묶지 않는 것은, 시도는 계속 쌓이기만 하고
 * 기기끼리 합칠 일이 없어서다(시도마다 id 가 다르다)
 */
function attemptsRef(uid: string, mode: string) {
  return collection(db, 'users', uid, mode, 'caseAttempts', 'attempts')
}

export async function saveCaseAttempt(uid: string, mode: string, attempt: CaseAttempt): Promise<void> {
  await setDoc(doc(attemptsRef(uid, mode), attempt.id), attempt)
}

// 같은 묶음의 가장 최근 임시저장. 등호 조건 하나라 복합 색인 없이 돈다
export async function fetchCaseDraft(uid: string, mode: string, setKey: string): Promise<CaseAttempt | null> {
  const snap = await getDocs(query(attemptsRef(uid, mode), where('setKey', '==', setKey)))
  const drafts = snap.docs.map((d) => d.data() as CaseAttempt).filter((a) => a.status === 'draft')
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}
