import { db } from '@/lib/firebase'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { getQuestions, saveQuestions, getWrongNotes, saveWrongNotes, getApiKey, setApiKey } from '@/lib/store'
import type { Question, WrongNote } from '@/lib/types'

// Firebase에 전체 데이터 업로드
export async function pushToFirebase(userId: string) {
  const questions = getQuestions()
  const wrongNotes = getWrongNotes()

  await setDoc(doc(db, 'users', userId, 'data', 'questions'), { list: questions })
  await setDoc(doc(db, 'users', userId, 'data', 'wrongNotes'), { list: wrongNotes })
}

// Firebase에서 전체 데이터 불러와서 로컬에 저장
export async function pullFromFirebase(userId: string): Promise<{ questions: Question[], wrongNotes: WrongNote[] }> {
  const qSnap = await getDoc(doc(db, 'users', userId, 'data', 'questions'))
  const wSnap = await getDoc(doc(db, 'users', userId, 'data', 'wrongNotes'))

  const questions: Question[] = qSnap.exists() ? qSnap.data().list : []
  const wrongNotes: WrongNote[] = wSnap.exists() ? wSnap.data().list : []

  // API 키는 건드리지 않고 문제/오답노트만 덮어쓰기
  const existingApiKey = getApiKey()
  saveQuestions(questions)
  saveWrongNotes(wrongNotes)
  if (existingApiKey) setApiKey(existingApiKey)

  return { questions, wrongNotes }
}
