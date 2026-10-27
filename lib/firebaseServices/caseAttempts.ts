import { db } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import type { CaseAttempt } from '@/lib/caseStudy/solve'
import type { DrawingStroke } from '@/lib/types'

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

/**
 * 풀이 그림판 — 시도 문서 아래 문항마다 문서 하나.
 *
 *   users/{uid}/{mode}/caseAttempts/attempts/{attemptId}/drawings/{problemId}   { strokes, savedAt }
 *
 * 시도에 매여 있어 같은 문항을 다시 풀면(새 시도) 빈 그림판으로 시작하고, 이전 그림은 그 시도에 남는다
 */
export interface CaseAttemptDrawing {
  strokes: DrawingStroke[]
  savedAt: number
}

const drawingRef = (uid: string, mode: string, attemptId: string, problemId: string) =>
  doc(attemptsRef(uid, mode), attemptId, 'drawings', problemId)

export async function fetchCaseAttemptDrawing(
  uid: string, mode: string, attemptId: string, problemId: string
): Promise<CaseAttemptDrawing | null> {
  const snap = await getDoc(drawingRef(uid, mode, attemptId, problemId))
  return snap.exists() ? (snap.data() as CaseAttemptDrawing) : null
}

export async function saveCaseAttemptDrawing(
  uid: string, mode: string, attemptId: string, problemId: string, drawing: CaseAttemptDrawing
): Promise<void> {
  await setDoc(drawingRef(uid, mode, attemptId, problemId), drawing)
}
