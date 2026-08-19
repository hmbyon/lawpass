'use client'

import type { Question, WrongNote } from './types'
import { getAppMode } from './appMode'

// apiKey는 개인 인증정보라 모드 공통으로 유지, 나머지는 모드별 접미사(_law/_general)로 분리
const BASE_KEYS = {
  apiKey: 'lawpass_api_key',
  questions: 'lawpass_questions',
  wrongNotes: 'lawpass_wrong_notes',
  savedSession: 'lawpass_saved_session',
  savedStudySession: 'lawpass_saved_study_session',
  savedStudySessions: 'lawpass_saved_study_sessions',
} as const

const MODE_SCOPED_BASE_KEYS: string[] = [
  BASE_KEYS.questions,
  BASE_KEYS.wrongNotes,
  BASE_KEYS.savedSession,
  BASE_KEYS.savedStudySession,
  BASE_KEYS.savedStudySessions,
]

function modeKey(base: string): string {
  return `${base}_${getAppMode()}`
}

// 모드 분리 이전에 저장된 데이터(접미사 없는 키)를 law 모드 키로 1회 이관
function migrateLegacyKeys() {
  if (typeof window === 'undefined') return
  for (const base of MODE_SCOPED_BASE_KEYS) {
    const legacyValue = localStorage.getItem(base)
    if (legacyValue === null) continue
    const lawKey = `${base}_law`
    if (localStorage.getItem(lawKey) === null) {
      localStorage.setItem(lawKey, legacyValue)
    }
    localStorage.removeItem(base)
  }
}

migrateLegacyKeys()

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
  return localStorage.getItem(BASE_KEYS.apiKey) ?? ''
}

export function setApiKey(key: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(BASE_KEYS.apiKey, key)
}

export function getQuestions(): Question[] {
  return safeGet<Question[]>(modeKey(BASE_KEYS.questions), [])
}

export function saveQuestions(questions: Question[]) {
  safeSet(modeKey(BASE_KEYS.questions), questions)
}

// 지문 비교용 정규화 (줄바꿈·공백 차이로 같은 문제가 다르게 보이지 않도록)
function normalizePassage(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim()
}

// 중복 판정 1차 후보 키. 문제번호가 있으면 그것으로 좁히고, 없으면 지문 전체로 좁힌다.
// 문제번호만으로 병합하면 같은 해의 서로 다른 모의고사끼리 충돌하므로 2차 확인을 반드시 거친다
function questionBucketKey(q: Question): string {
  const no = Number(q.no)
  return Number.isFinite(no) && no > 0
    ? `no:${q.subject}|${q.examType}|${q.year}|${no}`
    : `psg:${normalizePassage(q.passage)}`
}

// 2차 확인: 정말 같은 문제인가.
// 청크 겹침으로 한쪽이 페이지 경계에서 잘린 경우 짧은 쪽이 긴 쪽의 앞부분이 되므로 같은 문제로 인정한다
function isSameQuestion(a: Question, b: Question): boolean {
  const pa = normalizePassage(a.passage)
  const pb = normalizePassage(b.passage)
  if (pa === pb) return true
  const [shorter, longer] = pa.length <= pb.length ? [pa, pb] : [pb, pa]
  return shorter.length >= 40 && longer.startsWith(shorter)
}

// 더 온전한 판본을 고르기 위한 점수 (채워진 선지 수 우선, 그다음 지문 길이)
function completenessScore(q: Question): number {
  const filledChoices = q.choices.filter((c) => c.text?.trim()).length
  return filledChoices * 100000 + q.passage.length
}

export function addQuestions(incoming: Question[], sourceFile?: string): { added: number; merged: number } {
  const result = getQuestions()
  let added = 0
  let merged = 0

  // 후보 키 → result 배열 인덱스 목록 (기존 문제의 순서를 그대로 보존한다)
  const buckets = new Map<string, number[]>()
  result.forEach((q, i) => {
    const key = questionBucketKey(q)
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  })

  for (const q of incoming) {
    const key = questionBucketKey(q)
    const candidates = buckets.get(key) ?? []
    const matchIndex = candidates.find((i) => isSameQuestion(result[i], q))

    if (matchIndex === undefined) {
      result.push({ ...q, sourceFile })
      buckets.set(key, [...candidates, result.length - 1])
      added++
      continue
    }

    const found = result[matchIndex]
    const expl = new Set([
      ...(found.explanations ?? (found.explanation ? [found.explanation] : [])),
      ...(q.explanations ?? (q.explanation ? [q.explanation] : [])),
    ])
    found.explanations = Array.from(expl)
    found.explanation = Array.from(expl)[0] ?? null
    // 항목별 필드는 기존 값이 없을 때만 채운다 (재파싱으로 뒤늦게 추출된 경우 보강)
    found.subChoiceAnswers ??= q.subChoiceAnswers
    found.choiceIsCorrectStatement ??= q.choiceIsCorrectStatement
    found.choiceExplanations ??= q.choiceExplanations
    found.choiceExplanationSummaries ??= q.choiceExplanationSummaries
    found.subChoiceExplanations ??= q.subChoiceExplanations
    found.subItems ??= q.subItems
    found.passageTable ??= q.passageTable
    // 청크 경계에서 잘린 판본이 온전한 판본을 밀어내지 않도록, 더 완전한 쪽 내용을 채택한다.
    // id는 유지하므로 오답노트·형광펜 연결이 끊기지 않는다
    if (completenessScore(q) > completenessScore(found)) {
      found.passage = q.passage
      found.choices = q.choices
      if (q.subItems?.length) found.subItems = q.subItems
    }
    merged++
  }

  saveQuestions(result)
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

// 여러 출처 파일의 문제를 하나로 합침. 지문 앞 100자 기준으로 중복 제거(해설은 병합해서 보존)하고,
// 합쳐진 문제는 모두 newName을 sourceFile로 갖게 되어 기존 출처 파일명은 목록에서 사라짐
export function mergeSourceFiles(sourceFileNames: string[], newName: string) {
  const questions = getQuestions()
  const selected = new Set(sourceFileNames)
  const toMerge = questions.filter((q) => selected.has(q.sourceFile ?? '(출처 없음)'))
  const others = questions.filter((q) => !selected.has(q.sourceFile ?? '(출처 없음)'))

  const byPassage = new Map<string, Question>()
  for (const q of toMerge) {
    const key = q.passage.slice(0, 100)
    const found = byPassage.get(key)
    if (found) {
      const expl = new Set([
        ...(found.explanations ?? (found.explanation ? [found.explanation] : [])),
        ...(q.explanations ?? (q.explanation ? [q.explanation] : [])),
      ])
      found.explanations = Array.from(expl)
      found.explanation = Array.from(expl)[0] ?? null
    } else {
      byPassage.set(key, { ...q, sourceFile: newName })
    }
  }

  saveQuestions([...others, ...Array.from(byPassage.values())])
}

export function getWrongNotes(): WrongNote[] {
  return safeGet<WrongNote[]>(modeKey(BASE_KEYS.wrongNotes), [])
}

export function saveWrongNotes(notes: WrongNote[]) {
  safeSet(modeKey(BASE_KEYS.wrongNotes), notes)
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
    const 위험도 = DEFAULT_RISK // 1회뿐이라 오답률(100%)로 계산하면 과대평가됨
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

// 오답률로 위험도를 계산할 수 없을 때(오답 1회 등) 쓰는 기본값
export const DEFAULT_RISK = 2

// 분석(analysis)이 없거나 값이 깨진 노트라도 항상 위험도를 돌려준다.
// 위험도가 analysis 안에만 저장되는 탓에 AI 분석 실패 시 별점이 사라지던 문제 대응.
export function getRiskLevel(note: WrongNote): number {
  const stored = Number(note.analysis?.위험도)
  if (Number.isFinite(stored) && stored >= 1 && stored <= 5) return Math.round(stored)

  const wrongCount = note.wrongCount ?? 0
  const totalCount = note.totalCount ?? 0
  if (wrongCount === 0) return 0 // 순수 북마크는 별점 없음
  if (totalCount <= 1) return DEFAULT_RISK // 오답 1회뿐이라 오답률 계산 불가
  return calcRisk(wrongCount, totalCount)
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
  localStorage.removeItem(BASE_KEYS.apiKey)
  localStorage.removeItem(modeKey(BASE_KEYS.questions))
  localStorage.removeItem(modeKey(BASE_KEYS.wrongNotes))
}
// ── 임시저장 (세션 중단/이어서 풀기) ──
export interface SavedSession {
  id: string
  mode: 'cbt' | 'study'
  questions: import('./types').Question[]
  answers: Record<string, string | null>
  currentIndex: number
  timeLimitSeconds: number | null
  elapsedSeconds: number
  savedAt: number
}

export function getSavedSession(): SavedSession | null {
  return safeGet<SavedSession | null>(modeKey(BASE_KEYS.savedSession), null)
}

export function saveSession(session: SavedSession) {
  safeSet(modeKey(BASE_KEYS.savedSession), session)
}

export function clearSavedSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(modeKey(BASE_KEYS.savedSession))
}

// ── 선학습 임시저장 ──
// 학습 진도(learnedIndices)와 퀴즈 진도(quizzedUpTo)를 독립적으로 추적한다.
// 하나의 값으로 뭉뚱그리면 "학습은 20번까지 했지만 퀴즈는 5번까지"를 표현할 수 없다
export interface SavedStudySession {
  allQuestions: import('./types').Question[]
  learnedIndices: number[] // 실제로 열어본 문제 인덱스 (건너뛴 구간이 정확히 남는다)
  quizzedUpTo: number // 퀴즈까지 끝낸 마지막 인덱스. 아직 없으면 -1
  savedAt: number
  // 구버전 필드 (읽기 전용, 마이그레이션에만 사용)
  previewedIndex?: number
  remainingFrom?: number
}

// 구버전 세션(previewedIndex/remainingFrom)을 새 형식으로 변환한다
function migrateStudySession(raw: SavedStudySession): SavedStudySession {
  if (Array.isArray(raw.learnedIndices)) {
    return { ...raw, quizzedUpTo: raw.quizzedUpTo ?? -1 }
  }
  const learnedCount = raw.remainingFrom ?? (raw.previewedIndex ?? -1) + 1
  return {
    allQuestions: raw.allQuestions,
    learnedIndices: Array.from({ length: Math.max(0, learnedCount) }, (_, i) => i),
    quizzedUpTo: -1,
    savedAt: raw.savedAt,
  }
}

// 아직 학습하지 않은 첫 인덱스. 전부 학습했으면 문제 수를 반환한다
export function firstUnlearnedIndex(session: SavedStudySession): number {
  const learned = new Set(session.learnedIndices)
  for (let i = 0; i < session.allQuestions.length; i++) {
    if (!learned.has(i)) return i
  }
  return session.allQuestions.length
}

// 학습한 가장 마지막 인덱스. 하나도 없으면 -1
export function lastLearnedIndex(session: SavedStudySession): number {
  return session.learnedIndices.reduce((max, i) => (i > max ? i : max), -1)
}

// 학습은 했지만 아직 퀴즈로 풀지 않은 구간이 있는지
export function hasUnquizzedRange(session: SavedStudySession): boolean {
  return lastLearnedIndex(session) > session.quizzedUpTo
}

export function getSavedStudySession(): SavedStudySession | null {
  const raw = safeGet<SavedStudySession | null>(modeKey(BASE_KEYS.savedStudySession), null)
  return raw ? migrateStudySession(raw) : null
}

export function saveStudySession(session: SavedStudySession) {
  safeSet(modeKey(BASE_KEYS.savedStudySession), session)
}

export function clearSavedStudySession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(modeKey(BASE_KEYS.savedStudySession))
}

// ── 선학습 임시저장 목록 (여러 개) ──
export function getSavedStudySessions(): SavedStudySession[] {
  return safeGet<SavedStudySession[]>(modeKey(BASE_KEYS.savedStudySessions), []).map(migrateStudySession)
}

export function saveSavedStudySessions(sessions: SavedStudySession[]) {
  safeSet(modeKey(BASE_KEYS.savedStudySessions), sessions)
}

export function addSavedStudySession(session: SavedStudySession) {
  const sessions = getSavedStudySessions()
  // savedAt이 같으면 덮어쓰기, 다르면 새로 추가
  const idx = sessions.findIndex((s) => s.savedAt === session.savedAt)
  if (idx >= 0) {
    sessions[idx] = session
  } else {
    sessions.push(session)
  }
  saveSavedStudySessions(sessions)
}

export function removeSavedStudySession(savedAt: number) {
  const sessions = getSavedStudySessions().filter((s) => s.savedAt !== savedAt)
  saveSavedStudySessions(sessions)
}

export function clearAllSavedStudySessions() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(modeKey(BASE_KEYS.savedStudySessions))
}
