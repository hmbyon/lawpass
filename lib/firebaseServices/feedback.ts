import { db } from '@/lib/firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteField, query, orderBy, where } from 'firebase/firestore'
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
  return snap.docs.filter((d) => (d.data() as { isRead?: boolean }).isRead !== true).length
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
  return list.filter((f) => f.adminReply && f.replyReadByUser !== true).length
}

// 사용자가 답글을 확인한 것으로 표시
export async function markRepliesRead(feedbackIds: string[]) {
  await Promise.all(
    feedbackIds.map((id) => updateDoc(doc(db, 'feedback', id), { replyReadByUser: true }))
  )
}
