import { db } from '@/lib/firebase'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import {
  getQuestions, saveQuestions,
  getWrongNotes, saveWrongNotes,
  getApiKey, setApiKey,
  getSavedStudySessions, getSavedSession,
} from '@/lib/store'
import type { Question, WrongNote } from '@/lib/types'

// Firebase에 전체 데이터 업로드
export async function pushToFirebase(userId: string) {
  const questions = getQuestions()
  const wrongNotes = getWrongNotes()
  const studySessions = getSavedStudySessions()
  const quizSession = getSavedSession()

  console.log('[pushToFirebase] studySessions count:', studySessions.length)

  await setDoc(doc(db, 'users', userId, 'data', 'questions'), { list: questions })
  await setDoc(doc(db, 'users', userId, 'data', 'wrongNotes'), { list: wrongNotes })
  await setDoc(doc(db, 'users', userId, 'data', 'studySessions'), { list: studySessions })
  console.log('[pushToFirebase] studySessions uploaded to Firebase')
  if (quizSession) {
    await setDoc(doc(db, 'users', userId, 'data', 'quizSession'), quizSession)
  }
}

// Firebase에서 전체 데이터 불러와서 로컬에 저장
export async function pullFromFirebase(userId: string): Promise<{ questions: Question[], wrongNotes: WrongNote[] }> {
  const qSnap = await getDoc(doc(db, 'users', userId, 'data', 'questions'))
  const wSnap = await getDoc(doc(db, 'users', userId, 'data', 'wrongNotes'))
  const ssSnap = await getDoc(doc(db, 'users', userId, 'data', 'studySessions'))
  const qsSnap = await getDoc(doc(db, 'users', userId, 'data', 'quizSession'))

  const questions: Question[] = qSnap.exists() ? qSnap.data().list : []
  const wrongNotes: WrongNote[] = wSnap.exists() ? wSnap.data().list : []

  // API 키는 건드리지 않고 보존
  const existingApiKey = getApiKey()
  saveQuestions(questions)
  saveWrongNotes(wrongNotes)
  if (existingApiKey) setApiKey(existingApiKey)

  // 임시저장 데이터 복원
  if (ssSnap.exists()) {
    const studySessions = ssSnap.data().list
    if (studySessions?.length > 0) {
      localStorage.setItem('lawpass_saved_study_sessions', JSON.stringify(studySessions))
    }
  }
  if (qsSnap.exists()) {
    const quizSession = qsSnap.data()
    if (quizSession?.id) {
      localStorage.setItem('lawpass_saved_session', JSON.stringify(quizSession))
    }
  }

  return { questions, wrongNotes }
}
