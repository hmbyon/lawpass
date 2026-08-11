'use client'

import type { Question, WrongNote } from './types'

const KEYS = {
  apiKey: 'lawpass_api_key',
  questions: 'lawpass_questions',
  wrongNotes: 'lawpass_wrong_notes',
} as const

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('[v0] localStorage write failed', e)
  }
}

export function getApiKey(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(KEYS.apiKey) ?? ''
}

export function setApiKey(key: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEYS.apiKey, key)
}

export function getQuestions(): Question[] {
  return safeGet<Question[]>(KEYS.questions, [])
}

export function saveQuestions(questions: Question[]) {
  safeSet(KEYS.questions, questions)
}

export function addQuestions(incoming: Question[], sourceFile?: string): { added: number; merged: number } {
  const existing = getQuestions()
  let added = 0
  let merged = 0

  const byPassage = new Map(existing.map((q) => [q.passage.slice(0, 100), q]))

  for (const q of incoming) {
    const key = q.passage.slice(0, 100)
    const found = byPassage.get(key)
    if (found) {
      const expl = new Set([
        ...(found.explanations ?? (found.explanation ? [found.explanation] : [])),
        ...(q.explanations ?? (q.explanation ? [q.explanation] : [])),
      ])
      found.explanations = Array.from(expl)
      found.explanation = Array.from(expl)[0] ?? null
      byPassage.set(key, found)
      merged++
    } else {
      byPassage.set(key, { ...q, sourceFile })
      added++
    }
  }

  const merged_questions = Array.from(byPassage.values())
  saveQuestions(merged_questions)
  return { added, merged }
}

// 파일별 문제 삭제
export function deleteQuestionsBySource(sourceFile: string) {
  saveQuestions(getQuestions().filter((q) => q.sourceFile !== sourceFile))
}

// 업로드된 파일 목록 조회
export function getSourceFiles(): { name: string; count: number }[] {
  const questions = getQuestions()
  const map = new Map<string, number>()
  for (const q of questions) {
    const key = q.sourceFile ?? '(출처 없음)'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
}

export function getWrongNotes(): WrongNote[] {
  return safeGet<WrongNote[]>(KEYS.wrongNotes, [])
}

export function saveWrongNotes(notes: WrongNote[]) {
  safeSet(KEYS.wrongNotes, notes)
}

export function addWrongNote(note: WrongNote) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.questionId === note.questionId)
  if (idx >= 0) {
    const prev = notes[idx]
    const wrongCount = (prev.wrongCount ?? 0) + 1
    const totalCount = (prev.totalCount ?? 0) + 1
    const 위험도 = calcRisk(wrongCount, totalCount)
    const newAnalysis = note.analysis ? { ...note.analysis, 위험도 } : null
    const analysisHistory = [
      ...(prev.analysisHistory ?? (prev.analysis ? [prev.analysis] : [])),
      ...(newAnalysis ? [newAnalysis] : []),
    ]
    const dominantCause = calcDominantCause(analysisHistory, note.isStudyMode)
    notes[idx] = {
      ...prev,
      ...note,
      wrongCount,
      totalCount,
      memo: prev.memo,
      hiddenFields: prev.hiddenFields,
      isBookmarked: prev.isBookmarked,
      analysis: newAnalysis,
      analysisHistory,
      dominantCause,
    }
  } else {
    const wrongCount = 1
    const totalCount = 1
    const 위험도 = 1
    const newAnalysis = note.analysis ? { ...note.analysis, 위험도 } : null
    const analysisHistory = newAnalysis ? [newAnalysis] : []
    notes.push({
      ...note,
      wrongCount,
      totalCount,
      isBookmarked: note.isBookmarked ?? false,
      analysis: newAnalysis,
      analysisHistory,
    })
  }
  saveWrongNotes(notes)
}

// 북마크 추가 (선학습 미리보기에서)
export function addBookmark(question: import('./types').Question): void {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.questionId === question.id)
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], isBookmarked: true }
    saveWrongNotes(notes)
    return
  }
  const bookmark: WrongNote = {
    id: `bookmark_${question.id}_${Date.now()}`,
    questionId: question.id,
    question,
    userAnswer: '',
    status: null,
    isStudyMode: true,
    analysis: null,
    analysisHistory: [],
    dominantCause: null,
    createdAt: Date.now(),
    wrongCount: 0,
    totalCount: 0,
    isBookmarked: true,
  }
  notes.push(bookmark)
  saveWrongNotes(notes)
}

// 북마크 해제
export function removeBookmark(questionId: string): void {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.questionId === questionId)
  if (idx >= 0) {
    if (notes[idx].wrongCount === 0) {
      // 순수 북마크(틀린 적 없음)면 삭제
      notes.splice(idx, 1)
    } else {
      // 오답 기록 있으면 북마크만 해제
      notes[idx] = { ...notes[idx], isBookmarked: false }
    }
    saveWrongNotes(notes)
  }
}

// 히스토리 기반 최다 오답 원인 계산
function calcDominantCause(history: import('./types').ErrorAnalysis[], isStudyMode: boolean): import('./types').CauseType | null {
  if (history.length === 0) return null
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, study: 0 }
  for (const a of history) {
    const { 가설A, 가설B, 가설C, 선학습적용실패 } = a.오답원인
    if (isStudyMode && 선학습적용실패 && 선학습적용실패 !== 'null' && 선학습적용실패 !== '-') {
      counts.study++
    } else {
      if (가설A.length > 가설B.length && 가설A.length > 가설C.length) counts.A++
      else if (가설B.length > 가설C.length) counts.B++
      else counts.C++
    }
  }
  return (['study', 'A', 'B', 'C'] as import('./types').CauseType[])
    .reduce((a, b) => (counts[a] >= counts[b] ? a : b))
}

// 정답 시 totalCount만 증가, 위험도 재계산
export function addCorrectNote(questionId: string) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.questionId === questionId)
  if (idx >= 0) {
    const prev = notes[idx]
    const totalCount = (prev.totalCount ?? prev.wrongCount ?? 1) + 1
    const wrongCount = prev.wrongCount ?? 1
    const 위험도 = calcRisk(wrongCount, totalCount)
    notes[idx] = {
      ...prev,
      totalCount,
      analysis: prev.analysis ? { ...prev.analysis, 위험도 } : null,
    }
    saveWrongNotes(notes)
  }
}

function calcRisk(wrongCount: number, totalCount: number): number {
  if (totalCount === 0 || wrongCount === 0) return 1
  const rate = wrongCount / totalCount
  if (rate <= 0.2) return 1
  if (rate <= 0.4) return 2
  if (rate <= 0.6) return 3
  if (rate <= 0.8) return 4
  return 5
}

export function deleteWrongNote(id: string) {
  saveWrongNotes(getWrongNotes().filter((n) => n.id !== id))
}

// 메모 저장
export function updateWrongNoteMemo(id: string, memo: string) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], memo }
    saveWrongNotes(notes)
  }
}

// AI 분석 텍스트 수정 저장
export function updateWrongNoteAnalysis(id: string, patch: Partial<import('./types').ErrorAnalysis>) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx >= 0 && notes[idx].analysis) {
    notes[idx] = { ...notes[idx], analysis: { ...notes[idx].analysis!, ...patch } }
    saveWrongNotes(notes)
  }
}

// 숨긴 필드 저장
export function updateWrongNoteHiddenFields(id: string, hiddenFields: string[]) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], hiddenFields }
    saveWrongNotes(notes)
  }
}

// 선지별 메모 저장
export function updateChoiceMemo(id: string, choiceLabel: string, memo: string) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    const choiceMemos = { ...(notes[idx].choiceMemos ?? {}) }
    if (memo.trim()) {
      choiceMemos[choiceLabel] = memo
    } else {
      delete choiceMemos[choiceLabel]
    }
    notes[idx] = { ...notes[idx], choiceMemos }
    saveWrongNotes(notes)
  }
}

export function clearAll() {
  if (typeof window === 'undefined') return
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
}