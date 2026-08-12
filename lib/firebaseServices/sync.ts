import { db } from '@/lib/firebase'
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore'
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

// Firebase의 임시저장(studySessions) / 진행중인 퀴즈(quizSession) 문서 삭제
export async function clearFirebaseSessions(userId: string) {
  await deleteDoc(doc(db, 'users', userId, 'data', 'studySessions'))
  await deleteDoc(doc(db, 'users', userId, 'data', 'quizSession'))
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

  // 임시저장 데이터 복원 (없으면 이전 계정의 잔여 데이터가 보이지 않도록 로컬도 비움)
  const studySessions = ssSnap.exists() ? ssSnap.data().list : null
  if (studySessions?.length > 0) {
    localStorage.setItem('lawpass_saved_study_sessions', JSON.stringify(studySessions))
  } else {
    localStorage.removeItem('lawpass_saved_study_sessions')
  }

  const quizSession = qsSnap.exists() ? qsSnap.data() : null
  if (quizSession?.id) {
    localStorage.setItem('lawpass_saved_session', JSON.stringify(quizSession))
  } else {
    localStorage.removeItem('lawpass_saved_session')
  }

  return { questions, wrongNotes }
}
