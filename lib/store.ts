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
  pendingSync: 'lawpass_pending_sync',
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

// ── 동기화 대기 플래그 ──
// 로컬 저장은 됐지만 아직 Firebase에 올리지 못한 변경이 있는지 표시한다.
// 이 플래그가 없으면 push 실패(문서 한도 초과·오프라인·권한 등)를 아무도 모르는 채로
// 다음 pull이 옛 원격 값으로 로컬을 덮어써서 방금 파싱한 문제가 통째로 사라진다
export function markPendingSync() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(modeKey(BASE_KEYS.pendingSync), '1')
  } catch {
    // 저장에 실패해도 데이터 자체에는 영향이 없다
  }
}

export function clearPendingSync() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(modeKey(BASE_KEYS.pendingSync), '0')
  } catch {
    // 무시
  }
}

export function hasPendingSync(): boolean {
  if (typeof window === 'undefined') return true
  // 플래그가 아예 없는 기존 사용자는 동기화 여부를 알 수 없다.
  // 이때 '동기화됨'으로 단정하면 첫 pull이 로컬을 날리므로 보수적으로 '대기 중'으로 본다
  return localStorage.getItem(modeKey(BASE_KEYS.pendingSync)) !== '0'
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
  markPendingSync()
}

// 지문 비교용 정규화 (줄바꿈·공백 차이로 같은 문제가 다르게 보이지 않도록)
function normalizePassage(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim()
}

// 중복 판정 1차 후보 키. 문제번호가 있으면 그것으로 좁히고, 없으면 지문 전체로 좁힌다.
// 문제번호만으로 병합하면 서로 다른 회차끼리 충돌하므로 2차 확인(isSameQuestion)을 반드시 거친다.
//
// 키에 연도를 넣지 않는다. 청크 겹침 구간의 같은 문제를 한 청크는 2023으로, 다른 청크는
// 연도 미상(0)으로 판정하면 후보 자체가 갈려 병합이 실패하고 같은 문제가 두 번 저장됐다.
// 어차피 진짜 동일성은 지문으로 판정하므로, 후보를 넓게 잡아도 잘못 합쳐지지 않는다
function questionBucketKey(q: Question): string {
  const no = Number(q.no)
  return Number.isFinite(no) && no > 0
    ? `no:${q.subject}|${q.examType}|${no}`
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

// 페이지 구간의 넓이. 한쪽이라도 없으면 "모름"이므로 무한대로 쳐서 언제나 지게 한다
function pageSpan(from?: number, to?: number): number {
  return from === undefined || to === undefined ? Infinity : to - from
}

// 같은 문제를 여러 번 만날 수 있다. 청크 겹침으로 두 번 오기도 하고,
// 분할 재시도로 10~15쪽에서 한 번, 좁혀진 12~12쪽에서 또 오기도 한다.
// 이때는 더 좁은 구간이 더 정확한 정보이므로 그쪽을 택한다.
// 다른 항목별 필드들이 쓰는 "빈 것만 채움"(??=) 방식이면 먼저 온 넓은 구간이 눌러앉는다
function betterPages(
  found: Question,
  from: number | undefined,
  to: number | undefined
): boolean {
  if (from === undefined || to === undefined) return false
  return pageSpan(from, to) < pageSpan(found.pageFrom, found.pageTo)
}

export function addQuestions(
  incoming: Question[],
  sourceFile?: string,
  // 이 묶음을 뽑아낸 원본 PDF 구간 (1-based, 양끝 포함). 알 수 없는 경로에서는 생략한다
  pages?: { from: number; to: number }
): { added: number; merged: number } {
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
      result.push({
        ...q,
        sourceFile,
        pageFrom: pages?.from ?? q.pageFrom,
        pageTo: pages?.to ?? q.pageTo,
      })
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
    // 페이지만 ??= 가 아니다 — 위 주석 참조
    const inFrom = pages?.from ?? q.pageFrom
    const inTo = pages?.to ?? q.pageTo
    if (betterPages(found, inFrom, inTo)) {
      found.pageFrom = inFrom
      found.pageTo = inTo
    }
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

// 파싱 검토 화면에서 AI가 잘못 분류한 단원을 사람이 고칠 때 쓴다.
// 단원만 바꾸고 id는 그대로 두므로 오답노트·형광펜 연결이 끊기지 않는다
export function updateQuestionUnit(questionId: string, unit: string) {
  const questions = getQuestions()
  const target = questions.find((q) => q.id === questionId)
  if (!target) return
  target.unit = unit.trim() || undefined
  saveQuestions(questions)
}

// 파싱 검토 화면에서 잘못 판정된 출제연도를 사람이 고칠 때 쓴다.
// updateQuestionUnit과 마찬가지로 id는 그대로 둔다
export function updateQuestionYear(questionId: string, year: number) {
  if (!Number.isFinite(year) || year < 0) return
  const questions = getQuestions()
  const target = questions.find((q) => q.id === questionId)
  if (!target) return
  target.year = year
  saveQuestions(questions)
}

// 파싱 검토 화면에서 문제 하나를 지울 때 쓴다.
// 같은 문제가 두 벌 저장된 것을 사람이 골라 지우는 용도다 — 2026-08-24 이전에는
// 병합 키에 연도가 들어 있어서, 같은 문제를 두 청크가 다른 연도로 판정하면 후보가
// 갈려 비교조차 되지 않은 채 두 번 저장됐다. 그 버그는 고쳤지만 이미 쌓인 것은
// 저절로 사라지지 않는다.
//
// 되돌릴 수 없으므로 부르는 쪽에서 반드시 확인을 받아야 한다
export function deleteQuestion(questionId: string) {
  saveQuestions(getQuestions().filter((q) => q.id !== questionId))
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

// 저장된 위험도를 현재 calcRisk 기준으로 맞춘다.
// 1회성 플래그로는 안 된다 — pullFromFirebase가 원격의 옛 위험도로 로컬을 덮어쓰므로
// (sync.ts의 saveWrongNotes), 플래그가 소모된 뒤 덮이면 복구 기회가 없다.
// 그래서 매번 검사하되 값이 실제로 다를 때만 저장한다 (멱등, 정상 상태에서는 쓰기 없음)
function ensureRiskLevelsRecalculated() {
  if (typeof window === 'undefined') return

  const notes = safeGet<WrongNote[]>(modeKey(BASE_KEYS.wrongNotes), [])
  let changed = false
  const next = notes.map((n) => {
    if (!n.analysis) return n
    const 위험도 = calcRisk(n.wrongCount ?? 0, n.totalCount ?? 0)
    if (n.analysis.위험도 === 위험도) return n
    changed = true
    return { ...n, analysis: { ...n.analysis, 위험도 } }
  })
  if (changed) safeSet(modeKey(BASE_KEYS.wrongNotes), next)
}

export function getWrongNotes(): WrongNote[] {
  ensureRiskLevelsRecalculated()
  return safeGet<WrongNote[]>(modeKey(BASE_KEYS.wrongNotes), [])
}

export function saveWrongNotes(notes: WrongNote[]) {
  safeSet(modeKey(BASE_KEYS.wrongNotes), notes)
  markPendingSync()
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
    if (a.오답원인?.판정) {
      counts[a.오답원인.판정]++
      continue
    }
    const { 가설A = '', 가설B = '', 가설C = '', 선학습적용실패 } = a.오답원인 ?? {}
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

// 오답률만 보면 연속 오답이 전부 100%가 되어 위험도가 5로 수렴한다.
// 그래서 "몇 번 틀렸는지"로 기준선을 잡고, 오답률은 완화 보정으로만 쓴다
function calcRisk(wrongCount: number, totalCount: number): number {
  if (totalCount === 0 || wrongCount === 0) return 1
  const rate = wrongCount / totalCount
  // 반복 오답이 곧 위험 (1회→2, 2회→3, 3회→4, 4회 이상→5)
  const base = Math.min(5, wrongCount + 1)
  // 대부분 맞히는데 가끔 틀리는 문제만 한 단계 낮춘다
  const adjusted = rate <= 0.34 ? base - 1 : base
  return Math.min(5, Math.max(1, adjusted))
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
// D-1 암기장에 노출할 노트인지. 자동 조건(위험도 3 이상)과 수동 추가를 OR로 결합한다.
// 목록 추출과 일괄 삭제가 같은 판정을 쓰도록 여기 한 곳에 둔다
export function isInMemoList(note: WrongNote): boolean {
  if (note.manuallyAddedToMemo) return true
  return (note.analysis?.위험도 ?? 0) >= 3
}

// 암기장 수동 추가/제거 토글
export function updateWrongNoteMemoInclusion(id: string, included: boolean) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], manuallyAddedToMemo: included }
    saveWrongNotes(notes)
  }
}

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
  quizzedIndices: number[] // 실제로 답을 제출한 문제 인덱스. 출제 범위가 아닌 답변 기준이다
  savedAt: number
  // 구버전 필드 (읽기 전용, 마이그레이션에만 사용)
  quizzedUpTo?: number
  previewedIndex?: number
  remainingFrom?: number
}

// 구버전 세션(previewedIndex/remainingFrom)을 새 형식으로 변환한다
function migrateStudySession(raw: SavedStudySession): SavedStudySession {
  if (Array.isArray(raw.learnedIndices)) {
    if (Array.isArray(raw.quizzedIndices)) return raw
    // 1차 구조(quizzedUpTo 단일 숫자) → 인덱스 집합
    const upTo = raw.quizzedUpTo ?? -1
    return {
      ...raw,
      quizzedIndices: Array.from({ length: Math.max(0, upTo + 1) }, (_, i) => i),
    }
  }
  // 최초 구조(previewedIndex/remainingFrom)
  const learnedCount = raw.remainingFrom ?? (raw.previewedIndex ?? -1) + 1
  return {
    allQuestions: raw.allQuestions,
    learnedIndices: Array.from({ length: Math.max(0, learnedCount) }, (_, i) => i),
    quizzedIndices: [],
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

// 학습은 했지만 아직 풀지 않은 문제의 인덱스 (연속 구간이 아니어도 정확히 잡힌다)
export function unquizzedLearnedIndices(session: SavedStudySession): number[] {
  const quizzed = new Set(session.quizzedIndices)
  return session.learnedIndices.filter((i) => !quizzed.has(i)).sort((a, b) => a - b)
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
  if (process.env.NODE_ENV === 'development') {
    console.log('[study-session] save', {
      savedAt: session.savedAt,
      learned: session.learnedIndices.length,
      quizzed: session.quizzedIndices.length,
      lastLearned: lastLearnedIndex(session) + 1,
      unquizzed: unquizzedLearnedIndices(session).map((i) => i + 1),
    })
  }
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
  if (process.env.NODE_ENV === 'development') {
    console.log('[study-session] remove', savedAt)
  }
  const sessions = getSavedStudySessions().filter((s) => s.savedAt !== savedAt)
  saveSavedStudySessions(sessions)
}

export function clearAllSavedStudySessions() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(modeKey(BASE_KEYS.savedStudySessions))
}
