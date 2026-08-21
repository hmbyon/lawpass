import { db } from '@/lib/firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, deleteField, query, orderBy, where } from 'firebase/firestore'
import type { Feedback, FeedbackType } from '@/lib/types'
import type { AppMode } from '@/lib/appMode'

export async function submitFeedback(
  userId: string,
  userEmail: string | null,
  type: FeedbackType,
  content: string,
  mode: AppMode
) {
  await addDoc(collection(db, 'feedback'), {
    userId,
    userEmail,
    type,
    content,
    createdAt: Date.now(),
    isRead: false,
    mode,
  })
}

export async function getAllFeedback(): Promise<Feedback[]> {
  const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Feedback, 'id'>) }))
}

// 피드백 문서를 완전히 삭제한다 (관리자 전용). 되돌릴 수 없으므로 호출부에서 확인을 받는다
export async function deleteFeedback(feedbackId: string) {
  await deleteDoc(doc(db, 'feedback', feedbackId))
}

export async function setFeedbackRead(feedbackId: string, isRead: boolean) {
  await updateDoc(doc(db, 'feedback', feedbackId), { isRead })
}

// 관리자 답글 저장. 빈 문자열을 넘기면 답글을 삭제한다.
// 답글을 새로 달거나 수정하면 replyReadByUser를 false로 되돌려 사용자에게 다시 알린다
export async function setFeedbackReply(feedbackId: string, reply: string) {
  const trimmed = reply.trim()
  await updateDoc(
    doc(db, 'feedback', feedbackId),
    trimmed
      ? { adminReply: trimmed, repliedAt: Date.now(), replyReadByUser: false }
      : { adminReply: deleteField(), repliedAt: deleteField(), replyReadByUser: deleteField() }
  )
}

// 안읽은 피드백 수. 관리자만 호출하며 건수가 적어 복합 인덱스 없이 전체를 훑는다
export async function countUnreadFeedback(): Promise<number> {
  const snap = await getDocs(collection(db, 'feedback'))
  const unread = snap.docs.filter((d) => (d.data() as { isRead?: boolean }).isRead !== true)
  if (process.env.NODE_ENV === 'development') {
    console.log('[badge] 관리자 안읽음', unread.length, '/', snap.docs.length,
      unread.map((d) => ({ id: d.id, isRead: (d.data() as { isRead?: boolean }).isRead })))
  }
  return unread.length
}

// 내가 남긴 피드백. orderBy를 함께 쓰면 복합 인덱스가 필요하므로 정렬은 클라이언트에서 한다
export async function getMyFeedback(userId: string): Promise<Feedback[]> {
  const q = query(collection(db, 'feedback'), where('userId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Feedback, 'id'>) }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

// 아직 확인하지 않은 관리자 답글 수 (답글이 있고 replyReadByUser가 true가 아닌 것)
export async function countUnreadReplies(userId: string): Promise<number> {
  const list = await getMyFeedback(userId)
  const unread = list.filter((f) => f.adminReply && f.replyReadByUser !== true)
  if (process.env.NODE_ENV === 'development') {
    console.log('[badge] 내 답글 안읽음', unread.length, '/ 내 피드백', list.length,
      unread.map((f) => ({ id: f.id, replyReadByUser: f.replyReadByUser })))
  }
  return unread.length
}

// 사용자가 답글을 확인한 것으로 표시.
// 한 건이 실패해도 나머지는 진행하고, 실패 건수를 돌려준다 (권한 오류를 조용히 삼키지 않기 위함)
export async function markRepliesRead(feedbackIds: string[]): Promise<{ ok: number; failed: number }> {
  const results = await Promise.allSettled(
    feedbackIds.map((id) => updateDoc(doc(db, 'feedback', id), { replyReadByUser: true }))
  )
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    console.error('[feedback] 답글 읽음 처리 실패 (Firestore 규칙에서 replyReadByUser 쓰기 허용 필요)',
      failed.map((r) => (r as PromiseRejectedResult).reason))
  }
  return { ok: results.length - failed.length, failed: failed.length }
}
