import { db } from '@/lib/firebase'
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import type { Feedback, FeedbackType } from '@/lib/types'

export async function submitFeedback(
  userId: string,
  userEmail: string | null,
  type: FeedbackType,
  content: string
) {
  await addDoc(collection(db, 'feedback'), {
    userId,
    userEmail,
    type,
    content,
    createdAt: Date.now(),
    isRead: false,
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
