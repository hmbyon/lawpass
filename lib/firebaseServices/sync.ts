import { db } from '@/lib/firebase'
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore'
import {
  getQuestions, saveQuestions,
  getWrongNotes, saveWrongNotes,
  getApiKey, setApiKey,
  getSavedStudySessions, saveSavedStudySessions, clearAllSavedStudySessions,
  getSavedSession, saveSession, clearSavedSession,
  type SavedSession,
} from '@/lib/store'
import { getAppMode } from '@/lib/appMode'
import type { Question, WrongNote } from '@/lib/types'

// Firebase에 전체 데이터 업로드 (모드별 경로: users/{userId}/{law|general}/*)
export async function pushToFirebase(userId: string) {
  const mode = getAppMode()
  const questions = getQuestions()
  const wrongNotes = getWrongNotes()
  const studySessions = getSavedStudySessions()
  const quizSession = getSavedSession()

  console.log('[pushToFirebase] studySessions count:', studySessions.length)

  await setDoc(doc(db, 'users', userId, mode, 'questions'), { list: questions })
  await setDoc(doc(db, 'users', userId, mode, 'wrongNotes'), { list: wrongNotes })
  await setDoc(doc(db, 'users', userId, mode, 'studySessions'), { list: studySessions })
  console.log('[pushToFirebase] studySessions uploaded to Firebase')
  if (quizSession) {
    await setDoc(doc(db, 'users', userId, mode, 'quizSession'), quizSession)
  } else {
    // 로컬에서 지웠으면 원격 문서도 지운다.
    // 이 분기가 없으면 다음 pull 때 삭제한 퀴즈 세션이 되살아난다
    await deleteDoc(doc(db, 'users', userId, mode, 'quizSession')).catch(() => {})
  }
}

// Firebase의 임시저장(studySessions) / 진행중인 퀴즈(quizSession) 문서 삭제
export async function clearFirebaseSessions(userId: string) {
  const mode = getAppMode()
  await deleteDoc(doc(db, 'users', userId, mode, 'studySessions'))
  await deleteDoc(doc(db, 'users', userId, mode, 'quizSession'))
}

// Firebase에서 전체 데이터 불러와서 로컬에 저장 (현재 모드 기준)
export async function pullFromFirebase(userId: string): Promise<{ questions: Question[], wrongNotes: WrongNote[] }> {
  const mode = getAppMode()
  const qSnap = await getDoc(doc(db, 'users', userId, mode, 'questions'))
  const wSnap = await getDoc(doc(db, 'users', userId, mode, 'wrongNotes'))
  const ssSnap = await getDoc(doc(db, 'users', userId, mode, 'studySessions'))
  const qsSnap = await getDoc(doc(db, 'users', userId, mode, 'quizSession'))

  const questions: Question[] = qSnap.exists() ? qSnap.data().list : []
  const wrongNotes: WrongNote[] = wSnap.exists() ? wSnap.data().list : []

  // API 키는 건드리지 않고 보존
  const existingApiKey = getApiKey()
  saveQuestions(questions)
  saveWrongNotes(wrongNotes)
  if (existingApiKey) setApiKey(existingApiKey)

  // 임시저장 데이터 복원 (없으면 이전 계정/모드의 잔여 데이터가 보이지 않도록 로컬도 비움)
  const studySessions = ssSnap.exists() ? ssSnap.data().list : null
  if (studySessions?.length > 0) {
    saveSavedStudySessions(studySessions)
  } else {
    clearAllSavedStudySessions()
  }

  const quizSession = qsSnap.exists() ? (qsSnap.data() as SavedSession) : null
  if (quizSession?.id) {
    saveSession(quizSession)
  } else {
    clearSavedSession()
  }

  return { questions, wrongNotes }
}
