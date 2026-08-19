import { db } from '@/lib/firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteField, query, orderBy } from 'firebase/firestore'
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

// 관리자 답글 저장. 빈 문자열을 넘기면 답글을 삭제한다
export async function setFeedbackReply(feedbackId: string, reply: string) {
  const trimmed = reply.trim()
  await updateDoc(
    doc(db, 'feedback', feedbackId),
    trimmed
      ? { adminReply: trimmed, repliedAt: Date.now() }
      : { adminReply: deleteField(), repliedAt: deleteField() }
  )
}

// 안읽은 피드백 수. 관리자만 호출하며 건수가 적어 복합 인덱스 없이 전체를 훑는다
export async function countUnreadFeedback(): Promise<number> {
  const snap = await getDocs(collection(db, 'feedback'))
  return snap.docs.filter((d) => (d.data() as { isRead?: boolean }).isRead !== true).length
}
