import { useState, useEffect, useRef } from 'react'
import type { Question, ExplanationBlock } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'
import {
  addBookmark, removeBookmark, getWrongNotes, updateChoiceMemo,
  addSavedStudySession, getSavedStudySessions, removeSavedStudySession,
  firstUnlearnedIndex, lastLearnedIndex, unquizzedLearnedIndices,
  clearSavedSession, getSavedSession
} from '@/lib/store'
import type { SavedStudySession } from '@/lib/store'
import {
  HighlightColor,
  HighlightStyle,
  Highlight,
  HIGHLIGHT_SWATCH_CLASSES,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_LABELS,
  loadHighlights,
  saveHighlights,
  withoutOverlaps,
  renderHighlighted,
} from '@/lib/highlights'
import type { BoldRange } from '@/lib/highlights'
import { PassageTable } from '@/components/passage-table'

type StudyPhase = 'filter' | 'preview' | 'quiz'

export function StudyTab({ questions, onDone, onSync }: { questions: Question[]; onDone: () => void; onSync: () => void }) {
  const [phase, setPhase] = useState<StudyPhase>('filter')
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [previewFrom, setPreviewFrom] = useState(0)
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([])
  const [savedSessions, setSavedSessions] = useState<SavedStudySession[]>([])
  const [savedQuiz, setSavedQuiz] = useState(getSavedSession())
  const [activeSession, setActiveSession] = useState<SavedStudySession | null>(null)
  const [previewVisited, setPreviewVisited] = useState<number[]>([])

  // "이어서 풀기"로 들어온 경우에만 저장된 퀴즈 답안을 복원한다
  const [resumingQuiz, setResumingQuiz] = useState(false)

  useEffect(() => {
    setSavedSessions(getSavedStudySessions())
    const q = getSavedSession()
    if (q && q.mode === 'study') setSavedQuiz(q)
  }, [])

  function handleNewStart(qs: Question[]) {
    clearSavedSession()
    setAllQuestions(qs)
    setPreviewFrom(0)
    setPreviewVisited([])
    setSavedQuiz(null)
    setActiveSession(null)
    onSync()
    setPhase('preview')
  }

  // 이번 학습 세션의 방문 기록을 기존 세션에 합쳐 저장 형태로 만든다
  function buildSession(visited: number[]): SavedStudySession {
    const merged = new Set([...(activeSession?.learnedIndices ?? []), ...visited])
    return {
      allQuestions,
      learnedIndices: Array.from(merged).sort((a, b) => a - b),
      quizzedIndices: activeSession?.quizzedIndices ?? [],
      savedAt: activeSession?.savedAt ?? Date.now(),
    }
  }

  // 학습은 했지만 아직 풀지 않은 문제만 출제한다.
  // 연속 구간을 가정하지 않으므로 "6~20 중 일부만 풀린" 상태도 정확히 회수된다
  function startQuizFor(session: SavedStudySession, targetIndices: number[]) {
    const toQuiz = targetIndices.map((i) => session.allQuestions[i]).filter(Boolean)
    if (toQuiz.length === 0) return false

    addSavedStudySession(session)
    setSavedSessions(getSavedStudySessions())
    setActiveSession(session)
    setAllQuestions(session.allQuestions)

    clearSavedSession() // 이전 퀴즈의 답안이 새 퀴즈에 실리지 않게 한다
    setSavedQuiz(null)
    setResumingQuiz(false)
    setQuizQuestions(toQuiz)
    setPhase('quiz')
    onSync()
    return true
  }

  function handlePartialQuiz(upToIndex: number, visited: number[]) {
    const session = buildSession(visited)
    // 현재 위치까지 중, 아직 안 푼 문제만
    const targets = unquizzedLearnedIndices(session).filter((i) => i <= upToIndex)
    if (!startQuizFor(session, targets)) {
      alert('이 구간은 이미 모두 풀었습니다.')
    }
  }

  function handleSaveAndExit(upToIndex: number, visited: number[]) {
    // upToIndex까지 방문한 것으로 보되, 건너뛴 구간은 visited에만 의존한다
    const session = buildSession(visited)
    addSavedStudySession(session)
    setSavedSessions(getSavedStudySessions())
    setPhase('filter')
    setActiveSession(null)
    setPreviewVisited([])
    onSync()
  }

  function handleQuizFinish(result?: { completed: boolean; answeredQuestionIds: string[] }) {
    const completed = result?.completed ?? true

    // 중도 이탈이면 QuizEngine이 방금 저장한 퀴즈 세션을 지우지 않는다
    // ("풀던 퀴즈 이어서 하기"로 답안을 유지한 채 재진입할 수 있어야 한다)
    if (completed) clearSavedSession()

    if (activeSession) {
      // 출제 범위가 아니라 실제로 답한 문항만 풀이 완료로 기록한다
      const answered = new Set(result?.answeredQuestionIds ?? [])
      const newlyQuizzed = activeSession.allQuestions
        .map((q, i) => (answered.has(q.id) ? i : -1))
        .filter((i) => i >= 0)

      const updated: SavedStudySession = {
        ...activeSession,
        quizzedIndices: Array.from(
          new Set([...activeSession.quizzedIndices, ...newlyQuizzed])
        ).sort((a, b) => a - b),
      }
      const total = updated.allQuestions.length
      const allLearned = firstUnlearnedIndex(updated) >= total
      const allQuizzed = updated.quizzedIndices.length >= total
      // 학습·풀이가 모두 끝난 세션만 목록에서 지운다
      if (allLearned && allQuizzed) removeSavedStudySession(updated.savedAt)
      else addSavedStudySession(updated)
    }

    setSavedSessions(getSavedStudySessions())
    setSavedQuiz(completed ? null : getSavedSession())
    setActiveSession(null)
    setResumingQuiz(false)
    setPreviewVisited([])
    setPhase('filter')
    onDone()
  }

  function handleResumePreview(session: SavedStudySession, startIndex?: number) {
    setAllQuestions(session.allQuestions)
    setPreviewFrom(
      startIndex ?? Math.min(firstUnlearnedIndex(session), session.allQuestions.length - 1)
    )
    setPreviewVisited(session.learnedIndices)
    setActiveSession(session)
    setPhase('preview')
  }

  // 학습은 했지만 아직 풀지 않은 문제를 바로 퀴즈로 시작한다
  function handleResumeQuizFromSession(session: SavedStudySession) {
    setPreviewVisited(session.learnedIndices)
    if (!startQuizFor(session, startableQuizIndices(session))) {
      alert('풀 수 있는 문제가 없습니다.')
    }
  }

  function handleResumeQuiz() {
    if (!savedQuiz || savedQuiz.mode !== 'study') return
    setQuizQuestions(savedQuiz.questions)
    setSavedQuiz(null)
    setResumingQuiz(true)
    setPhase('quiz')
    onSync()
  }

  // 진행 중(중도 이탈)인 퀴즈가 커버하는 문항 id.
  // 같은 구간이 상단 "풀던 퀴즈 이어서 하기" 카드와 학습 카드에 동시에 뜨지 않도록 한다
  const pendingQuizIds =
    savedQuiz?.mode === 'study'
      ? new Set(savedQuiz.questions.map((q) => q.id))
      : new Set<string>()

  // 학습 카드에서 새로 시작할 수 있는 문항 = 아직 안 푼 것 중 진행 중인 퀴즈에 없는 것
  function startableQuizIndices(session: SavedStudySession): number[] {
    return unquizzedLearnedIndices(session).filter(
      (i) => !pendingQuizIds.has(session.allQuestions[i]?.id)
    )
  }

  function handleDeleteSession(savedAt: number) {
    removeSavedStudySession(savedAt)
    setSavedSessions(getSavedStudySessions())
    onSync() // 삭제를 Firebase에도 반영하지 않으면 다음 pull 때 되살아난다
  }

  function handleDeleteQuizSession() {
    clearSavedSession()
    setSavedQuiz(null)
    onSync()
  }

  if (phase === 'preview') {
    return (
      <StudyBulkPreview
        questions={allQuestions}
        startFrom={previewFrom}
        initialVisited={previewVisited}
        onPartialQuiz={handlePartialQuiz}
        onSaveAndExit={handleSaveAndExit}
        onBack={() => setPhase('filter')}
        onDone={onDone}
      />
    )
  }

  if (phase === 'quiz') {
    // 새로 시작한 퀴즈에 이전 세션의 답안이 실리지 않도록, 이어서 풀기일 때만 복원한다
    const saved = resumingQuiz ? getSavedSession() : null
    return (
      <QuizEngine
        questions={quizQuestions.length > 0 ? quizQuestions : (saved?.questions ?? [])}
        mode="study"
        timeLimitSeconds={null}
        initialIndex={saved?.currentIndex ?? 0}
        initialAnswers={saved?.answers ?? {}}
        initialElapsed={saved?.elapsedSeconds ?? 0}
        onFinish={handleQuizFinish}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-bold text-foreground mb-1">선학습 모드</h2>
        <p className="text-sm text-muted-foreground mb-4">
          전체 문제의 정답·해설을 먼저 학습한 뒤 몰아서 풀어봅니다.
        </p>
      </div>

      {savedQuiz && savedQuiz.mode === 'study' && (
        <div className="max-w-2xl mx-auto bg-primary/10 border border-primary/30 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-primary">📌 풀던 퀴즈 이어서 하기</p>
          <p className="text-xs text-muted-foreground">
            {savedQuiz.questions.length}문항 중{' '}
            {Object.values(savedQuiz.answers).filter(Boolean).length}개 답변 완료 ·{' '}
            {new Date(savedQuiz.savedAt).toLocaleDateString('ko-KR')} 저장
          </p>
          <div className="flex gap-2">
            <button onClick={handleResumeQuiz} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90">
              이어서 풀기
            </button>
            <button onClick={handleDeleteQuizSession} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/70">
              삭제
            </button>
          </div>
        </div>
      )}

      {savedSessions.length > 0 && (
        <div className="max-w-2xl mx-auto space-y-2">
          <p className="text-xs font-medium text-muted-foreground px-1">📖 이어서 학습하기</p>
          {savedSessions.map((session) => (
            <div key={session.savedAt} className="bg-purple-900/20 border border-purple-700/30 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                    {session.allQuestions[0]?.subject} 외 · 전체 {session.allQuestions.length}문제
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lastLearnedIndex(session) + 1}번까지 학습
                    {session.quizzedIndices.length > 0 && ` · ${session.quizzedIndices.length}문제 풀이 완료`} ·{' '}
                    {new Date(session.savedAt).toLocaleDateString('ko-KR')} 저장
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteSession(session.savedAt)}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
                >
                  삭제
                </button>
              </div>
              {/* 상태에 맞는 버튼만 노출한다 (둘 다 남아 있으면 둘 다) */}
              {startableQuizIndices(session).length > 0 && (
                <button
                  onClick={() => handleResumeQuizFromSession(session)}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
                >
                  ▶ {startableQuizIndices(session)[0] + 1}번부터 퀴즈 풀기
                  {' '}({startableQuizIndices(session).length}문제)
                </button>
              )}
              {/* 학습 경로는 퀴즈 진행 여부와 무관하게 항상 열어둔다.
                  남은 구간이 없으면 처음부터 다시 볼 수 있게 한다 (버튼 없는 카드 방지) */}
              {(() => {
                const next = firstUnlearnedIndex(session)
                const allLearned = next >= session.allQuestions.length
                return (
                  <button
                    onClick={() => handleResumePreview(session, allLearned ? 0 : next)}
                    className="w-full py-2 bg-purple-700 text-white rounded-lg text-sm font-medium hover:opacity-90"
                  >
                    📖 {allLearned ? '처음부터 다시 학습' : `${next + 1}번부터 이어서 학습`}
                  </button>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      <QuizFilter
        questions={questions}
        mode="study"
        onStart={(qs) => handleNewStart(qs)}
      />
    </div>
  )
}

function getTextOffset(container: Node, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(container)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

// 유니코드 한글 음절 조합 순서의 초성 19자
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const HANGUL_SYLLABLE_BASE = 0xac00 // '가'
const CHOSEONG_STRIDE = 588 // 중성 21 × 종성 28

// 자음 라벨을 같은 순서의 가나다 라벨로 변환한다 (중성 'ㅏ', 받침 없음)
// 예: 'ㄱ' → '가', 'ㅁ' → '마', 'ㅎ' → '하'
function syllableForConsonant(consonant: string): string | null {
  const index = CHOSEONG.indexOf(consonant)
  return index < 0 ? null : String.fromCharCode(HANGUL_SYLLABLE_BASE + index * CHOSEONG_STRIDE)
}

// 라벨로 인정할 자음: ㄱ~ㅎ (쌍자음은 보기 라벨로 쓰이지 않으므로 제외)
const SUB_LABEL_CONSONANTS = CHOSEONG.filter((c) => !'ㄲㄸㅃㅆㅉ'.includes(c))

// { 'ㄱ': 'ㄱ', '가': 'ㄱ', 'ㄴ': 'ㄴ', '나': 'ㄴ', ... 'ㅎ': 'ㅎ', '하': 'ㅎ' }
// 글자를 직접 나열하지 않고 계산으로 만들어, 새로운 라벨(ㅂ/바, ㅅ/사 …)도 코드 수정 없이 인식된다
const SUB_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SUB_LABEL_CONSONANTS.flatMap((consonant) => {
    const syllable = syllableForConsonant(consonant)
    const entries: [string, string][] = [[consonant, consonant]]
    if (syllable) entries.push([syllable, consonant])
    return entries
  })
)

// 보기 항목 라벨로 인정하는 문자들. 마커 정규식들이 이 상수를 공유해야
// SUB_LABEL_MAP과 어긋나지 않는다 (ㅁ/마가 빠져 ㄹ 항목에 흡수되던 버그)
const SUB_LABEL_CHARS = Object.keys(SUB_LABEL_MAP).join('')

const OX_CHAR_CLASS = 'OoXx○◯〇×✕✗ＯＸ'

interface SubChoice {
  stem: string
  items: { label: string; text: string }[]
}

function parseSubChoices(passage: string): SubChoice | null {
  const regex = new RegExp(`(?:^|\n)[ \t]*([${SUB_LABEL_CHARS}])[ \t]*\\.[ \t]*`, 'g')
  const markers: { label: string; start: number; contentStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(passage))) {
    const label = SUB_LABEL_MAP[m[1]]
    if (!label) continue
    const labelIndex = m.index + m[0].indexOf(m[1])
    markers.push({ label, start: labelIndex, contentStart: m.index + m[0].length })
  }
  if (markers.length < 2) return null

  // 표·서식 안의 "가.", "다." 같은 산발적 표기를 하위지문으로 오인하지 않도록,
  // 실제 보기 항목처럼 ㄱ부터 순서대로 이어지는 경우만 인정한다
  const order = markers.map((m) => SUB_LABEL_CONSONANTS.indexOf(m.label))
  if (order[0] !== 0) return null
  if (order.some((v, i) => i > 0 && v !== order[i - 1] + 1)) return null

  const stem = passage.slice(0, markers[0].start).trim()
  const items: { label: string; text: string }[] = []
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].contentStart
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : passage.length
    const text = passage.slice(textStart, textEnd).trim()
      .replace(new RegExp(`\\s*\\([${OX_CHAR_CLASS}]\\)\\.?\\s*$`), '')
      .trim()
    if (text) items.push({ label: markers[i].label, text })
  }
  return items.length >= 2 ? { stem, items } : null
}

// 원본에서 밑줄로 강조돼 있던 구간을 AI가 **텍스트** 형태로 표시해 준다.
// 형광펜 오프셋은 화면에 렌더된 텍스트 기준이므로, ** 마크를 제거한 문자열과
// 그 문자열 기준 볼드 범위를 함께 돌려줘야 두 기능이 어긋나지 않는다
// 발문의 부정어. "옳지 않은 것은?" 유형이면 정답 선지의 문장이 '틀린 서술'이다
const NEGATIVE_STEM = /(옳지\s*않은|적절하지\s*않은|타당하지\s*않은|바르지\s*않은|올바르지\s*않은|틀린|잘못된|아닌\s*것)/
const POSITIVE_STEM = /(옳은|적절한|타당한|바른|올바른)\s*것/

// 선지 문장의 참/거짓은 추론할 필요가 없다 — 발문 유형과 정답 하나로 결정된다.
// AI가 채운 값보다 이 계산이 신뢰도가 높고, 옛 데이터에도 재파싱 없이 적용된다
function deriveChoiceTruth(q: Question): Record<string, boolean> | undefined {
  if (!q.answer || q.choices.length === 0) return undefined
  const negative = NEGATIVE_STEM.test(q.passage)
  const positive = POSITIVE_STEM.test(q.passage)
  if (!negative && !positive) return undefined // 유형을 못 읽으면 추측하지 않는다
  return Object.fromEntries(
    q.choices.map((c) => [c.label, negative ? c.label !== q.answer : c.label === q.answer])
  )
}

function parseBoldMarks(raw: string): { text: string; bolds: BoldRange[] } {
  const regex = /\*\*([\s\S]+?)\*\*/g
  const bolds: BoldRange[] = []
  let text = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(raw))) {
    text += raw.slice(last, match.index)
    const start = text.length
    text += match[1]
    bolds.push({ start, end: text.length })
    last = match.index + match[0].length
  }
  text += raw.slice(last)
  return { text, bolds }
}

// 해설은 블록 배열이 표준이지만, 블록 구조 도입 이전 데이터와 정규식 폴백 결과는 문자열이다
function toExplanationBlocks(raw: string | ExplanationBlock[] | undefined): ExplanationBlock[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    const content = raw.trim()
    return content ? [{ type: 'text', content }] : []
  }
  return raw.filter((b) => b?.content?.trim())
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// subItems에는 발문(stem)이 없다. 지문에서 첫 항목이 시작되는 위치를 찾아 그 앞을 발문으로 자른다.
// 못 찾으면 기존 정규식 파싱의 stem으로, 그것도 없으면 지문 전체로 폴백한다
function stemForSubItems(passage: string, items: { label: string; text: string }[]): string {
  const first = items[0]
  if (!first) return passage

  const probe = first.text.trim().slice(0, 20)
  let idx = probe ? passage.indexOf(probe) : -1
  if (idx < 0) {
    idx = passage.search(new RegExp(`(?:^|\n)\\s*${escapeRegExp(first.label)}\\s*[.)]`))
  }
  if (idx < 0) return parseSubChoices(passage)?.stem ?? passage

  // 본문 앞에 남은 라벨 표기("ㄱ." 등)까지 함께 잘라낸다
  return passage
    .slice(0, idx)
    .replace(new RegExp(`\\s*${escapeRegExp(first.label)}\\s*[.)]?\\s*$`), '')
    .trim()
}

// subItems(구조화 추출)를 우선 사용하고, 없으면 지문 정규식 파싱으로 폴백한다
function resolveSubChoices(q: Question): SubChoice | null {
  if (q.subItems?.length) {
    const items = q.subItems.map((it) => ({ label: it.label, text: it.text }))
    return { stem: stemForSubItems(q.passage, items), items }
  }
  return parseSubChoices(q.passage)
}

function parseSubExplanations(explanation: string | null): Record<string, string> {
  if (!explanation) return {}
  const regex = new RegExp(`(?<![가-힣])([${SUB_LABEL_CHARS}])\\s*\\.\\s*\\([${OX_CHAR_CLASS}]\\)`, 'g')
  const markers: { label: string; start: number; end: number }[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(explanation))) {
    const label = SUB_LABEL_MAP[match[1]]
    if (label) markers.push({ label, start: match.index, end: match.index + match[0].length })
  }

  const result: Record<string, string> = {}
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].end
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : explanation.length
    const text = explanation.slice(textStart, textEnd).trim()
    if (text) result[markers[i].label] = text
  }

  return result
}

function StudyBulkPreview({
  questions,
  startFrom,
  initialVisited = [],
  onPartialQuiz,
  onSaveAndExit,
  onBack,
  onDone,
}: {
  questions: Question[]
  startFrom: number
  initialVisited?: number[]
  onPartialQuiz: (upToIndex: number, visited: number[]) => void
  onSaveAndExit: (upToIndex: number, visited: number[]) => void
  onBack: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState(startFrom)
  // 실제로 연 문제만 기록한다. 도트로 건너뛰면 중간 구간은 미학습으로 남는다
  const [visited, setVisited] = useState<Set<number>>(() => new Set([...initialVisited, startFrom]))

  useEffect(() => {
    setVisited((prev) => (prev.has(current) ? prev : new Set(prev).add(current)))
  }, [current])

  const visitedList = () => Array.from(visited).sort((a, b) => a - b)
  const [bookmarked, setBookmarked] = useState<Set<string>>(() => {
    const notes = getWrongNotes()
    return new Set(
      questions
        .filter((q) => notes.some((n) => n.questionId === q.id && n.isBookmarked))
        .map((q) => q.id)
    )
  })
  const [choiceMemoOpen, setChoiceMemoOpen] = useState<string | null>(null)
  const [choiceMemoText, setChoiceMemoText] = useState('')
  const [choiceMemos, setChoiceMemos] = useState<Record<string, Record<string, string>>>(() => {
    const notes = getWrongNotes()
    const result: Record<string, Record<string, string>> = {}
    for (const q of questions) {
      const note = notes.find((n) => n.questionId === q.id)
      if (note?.choiceMemos) result[q.id] = note.choiceMemos
    }
    return result
  })

  const q = questions[current]
  const isLast = current === questions.length - 1
  const isBookmarked = bookmarked.has(q.id)
  const subChoices = resolveSubChoices(q)
  // ㄱㄴㄷㄹ 조합형 문제의 ①~⑤는 "조합"이라 문장 참/거짓 개념이 없으므로 계산에서 제외한다
  const choiceTruth = subChoices ? q.choiceIsCorrectStatement : (deriveChoiceTruth(q) ?? q.choiceIsCorrectStatement)
  // subItems가 있으면 O/X·해설을 거기서 직접 읽는다 (라벨 키로 조회)
  const subItemByLabel = new Map((q.subItems ?? []).map((it) => [it.label, it]))
  // 옛 데이터 폴백: 전용 필드를 우선하고, 없는 항목만 정규식 파싱 결과로 채운다
  const subExplanations = subChoices
    ? { ...parseSubExplanations(q.explanation), ...(q.subChoiceExplanations ?? {}) }
    : {}

  const [highlights, setHighlights] = useState<Highlight[]>(() => loadHighlights(q.id))
  const [highlightPopup, setHighlightPopup] = useState<{ field: string; start: number; end: number; x: number; y: number } | null>(null)
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>('fill') // 연속 적용 편하도록 선택을 유지
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHighlights(loadHighlights(q.id))
    setHighlightPopup(null)
    fieldRefs.current = {}
  }, [q.id])

  useEffect(() => {
    if (!highlightPopup) return
    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setHighlightPopup(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [highlightPopup])

  function ensureBookmarked() {
    if (!bookmarked.has(q.id)) {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    onDone()
  }

  function handleTextMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    if (!sel.toString().trim()) return

    const range = sel.getRangeAt(0)
    let matchedField: string | null = null
    let container: HTMLElement | null = null
    for (const [field, el] of Object.entries(fieldRefs.current)) {
      if (el && el.contains(range.commonAncestorContainer)) {
        matchedField = field
        container = el
        break
      }
    }
    if (!matchedField || !container) return

    const start = getTextOffset(container, range.startContainer, range.startOffset)
    const end = getTextOffset(container, range.endContainer, range.endOffset)
    if (end <= start) return

    const rect = range.getBoundingClientRect()
    setHighlightPopup({ field: matchedField, start, end, x: rect.left + rect.width / 2, y: rect.top })
  }

  function applyHighlight(color: HighlightColor) {
    if (!highlightPopup) return
    const { field, start, end } = highlightPopup
    const cleaned = withoutOverlaps(highlights, field, start, end)
    const next = [...cleaned, { id: `h_${Date.now()}`, field, start, end, color, style: highlightStyle }]
    setHighlights(next)
    saveHighlights(q.id, next)
    setHighlightPopup(null)
    window.getSelection()?.removeAllRanges()
    ensureBookmarked()
  }

  // 형광펜/선지메모가 모두 사라지면 자동으로 북마크 해제 (수동 추가분도 동일하게 처리)
  // 삭제 직후 state는 아직 갱신 전이므로 남은 형광펜/메모를 인자로 받는다. 해제했으면 true 반환
  function unbookmarkIfEmpty(
    remainingHighlights: Highlight[],
    remainingMemos: Record<string, string> = choiceMemos[q.id] ?? {}
  ): boolean {
    if (!bookmarked.has(q.id)) return false
    if (remainingHighlights.length > 0) return false
    if (Object.keys(remainingMemos).length > 0) return false
    removeBookmark(q.id)
    setBookmarked((prev) => { const next = new Set(prev); next.delete(q.id); return next })
    onDone()
    return true
  }

  function removeHighlight(id: string) {
    const next = highlights.filter((h) => h.id !== id)
    setHighlights(next)
    saveHighlights(q.id, next)
    unbookmarkIfEmpty(next)
  }

  function toggleBookmark() {
    if (isBookmarked) {
      removeBookmark(q.id)
      setBookmarked((prev) => { const next = new Set(prev); next.delete(q.id); return next })
    } else {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    onDone()
  }

  function saveChoiceMemo(label: string, memo: string) {
    const trimmed = memo.trim()
    // 메모를 지우는 경우엔 북마크를 새로 만들지 않는다 (바로 아래에서 해제 대상이 되므로)
    if (trimmed && !isBookmarked) {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    const notes = getWrongNotes()
    const note = notes.find((n) => n.questionId === q.id)
    if (note) updateChoiceMemo(note.id, label, memo)

    const nextMemos = { ...(choiceMemos[q.id] ?? {}) }
    if (trimmed) nextMemos[label] = memo
    else delete nextMemos[label]
    setChoiceMemos((prev) => ({ ...prev, [q.id]: nextMemos }))

    setChoiceMemoOpen(null)
    setChoiceMemoText('')
    // 해제된 경우 unbookmarkIfEmpty가 onDone을 호출하므로 중복 동기화를 피한다
    const unbookmarked = !trimmed && unbookmarkIfEmpty(highlights, nextMemos)
    if (!unbookmarked) onDone()
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">학습 {current + 1} / {questions.length}</span>
        <span className="text-xs text-muted-foreground">{q.subject} · {q.year}년</span>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4" onMouseUp={handleTextMouseUp}>
        <div className="flex justify-end">
          <button
            onClick={toggleBookmark}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
              isBookmarked
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                : 'bg-muted text-muted-foreground border-border hover:border-yellow-500/40 hover:text-yellow-400'
            }`}
          >
            {isBookmarked ? '⭐ 오답노트에 추가됨' : '☆ 오답노트에 추가'}
          </button>
        </div>

        <p
          ref={(el) => { fieldRefs.current[subChoices ? 'passage_stem' : 'passage'] = el }}
          className="text-sm leading-relaxed text-foreground whitespace-pre-wrap select-text"
        >
          {renderHighlighted(
            subChoices ? subChoices.stem : q.passage,
            subChoices ? 'passage_stem' : 'passage',
            highlights,
            removeHighlight
          )}
        </p>

        {/* 지문 안의 표/서식 */}
        {q.passageTable && q.passageTable.length > 0 && (
          <PassageTable
            tables={q.passageTable}
            highlights={highlights}
            onRemoveHighlight={removeHighlight}
            registerRef={(key, el) => { fieldRefs.current[key] = el }}
          />
        )}

        {/* ㄱㄴㄷㄹ 보기 항목 */}
        {subChoices && (
          <div className="space-y-2 pl-3 border-l-2 border-border">
            {subChoices.items.map((item) => {
              const memoKey = `${q.id}_${item.label}`
              const existingMemo = choiceMemos[q.id]?.[item.label]
              const subItem = subItemByLabel.get(item.label)
              const subAnswer = subItem ? subItem.isCorrect : q.subChoiceAnswers?.[item.label]
              // 새 블록 구조를 우선하고, 없으면 옛 데이터(정규식 파싱 결과 문자열)로 폴백
              const subItemBlocks = toExplanationBlocks(subItem?.explanation)
              const subBlocks = subItemBlocks.length > 0
                ? subItemBlocks
                : toExplanationBlocks(subExplanations[item.label])
              // 블록 배열이면 블록마다 독립 필드 키가 필요하다.
              // 옛 문자열 데이터는 기존 키를 그대로 써야 이미 칠해둔 형광펜이 어긋나지 않는다
              const isBlockData = subItemBlocks.length > 0
              const subExpFieldKey = (i: number) =>
                isBlockData ? `subexp_${item.label}_${i}` : `subexp_${item.label}`
              const subSummary = subItem?.explanationSummary?.trim()
              const fieldKey = `sub_${item.label}`
              const isOpen = choiceMemoOpen === memoKey

              return (
                <div key={item.label}>
                  <div className="flex gap-2 items-start text-sm">
                    {subAnswer !== undefined && (
                      <span className={`shrink-0 font-bold ${subAnswer ? 'text-emerald-400' : 'text-red-400'}`}>
                        {subAnswer ? 'O' : 'X'}
                      </span>
                    )}
                    <span className="font-semibold text-primary shrink-0">{item.label}.</span>
                    <span
                      ref={(el) => { fieldRefs.current[fieldKey] = el }}
                      className="text-foreground flex-1 select-text"
                    >
                      {renderHighlighted(item.text, fieldKey, highlights, removeHighlight)}
                    </span>
                    <button
                      onClick={() => {
                        if (isOpen) { setChoiceMemoOpen(null); setChoiceMemoText('') }
                        else { setChoiceMemoOpen(memoKey); setChoiceMemoText(existingMemo ?? '') }
                      }}
                      className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                        existingMemo ? 'text-yellow-400 hover:text-yellow-300' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {existingMemo ? '📌' : '🖊️'}
                    </button>
                  </div>

                  {existingMemo && !isOpen && (
                    <div className="ml-3 mt-1 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
                      {existingMemo}
                    </div>
                  )}

                  {isOpen && (
                    <div className="ml-3 mt-1 space-y-1.5">
                      <textarea
                        value={choiceMemoText}
                        onChange={(e) => setChoiceMemoText(e.target.value)}
                        placeholder="이 항목에서 유의할 점을 메모하세요..."
                        rows={2}
                        autoFocus
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setChoiceMemoOpen(null); setChoiceMemoText('') }} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                        {existingMemo && (
                          <button onClick={() => saveChoiceMemo(item.label, '')} className="text-xs text-red-400 hover:text-red-300">삭제</button>
                        )}
                        <button onClick={() => saveChoiceMemo(item.label, choiceMemoText)} className="text-xs text-primary font-medium hover:opacity-80">저장</button>
                      </div>
                    </div>
                  )}

                  {(subSummary || subBlocks.length > 0) && (
                    <div className="ml-5 mt-1 bg-muted rounded-lg p-2.5 space-y-2">
                      {subSummary && (
                        <div className="flex gap-1.5 items-start">
                          <span className="shrink-0 text-[10px] text-primary font-medium mt-0.5">요약</span>
                          <p className="text-xs font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
                            {(() => {
                              const { text, bolds } = parseBoldMarks(subSummary)
                              return renderHighlighted(text, `subsum_${item.label}`, [], undefined, bolds)
                            })()}
                          </p>
                        </div>
                      )}
                      {subSummary && subBlocks.length > 0 && <div className="border-t border-border" />}
                      {subBlocks.map((block, bi) => {
                        const key = subExpFieldKey(bi)
                        const { text: blockText, bolds } = parseBoldMarks(block.content)
                        if (block.type === 'lawBox') {
                          return (
                            <div key={key} className="border border-primary/30 bg-primary/5 rounded-lg p-2 space-y-1">
                              {block.title && (
                                <p className="text-[11px] font-semibold text-primary leading-snug">{parseBoldMarks(block.title).text}</p>
                              )}
                              <p
                                ref={(el) => { fieldRefs.current[key] = el }}
                                className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
                              >
                                {renderHighlighted(blockText, key, highlights, removeHighlight, bolds)}
                              </p>
                            </div>
                          )
                        }
                        return (
                          <p
                            key={key}
                            ref={(el) => { fieldRefs.current[key] = el }}
                            className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
                          >
                            {renderHighlighted(blockText, key, highlights, removeHighlight, bolds)}
                          </p>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 선지 (1~5번) */}
        <div className="space-y-2">
          {q.choices.map((c) => {
            const memoKey = `${q.id}_${c.label}`
            const existingMemo = choiceMemos[q.id]?.[c.label]
            const isCorrect = c.label === q.answer
            const rawExplanation = q.choiceExplanations?.[c.label]
            const explanationBlocks = toExplanationBlocks(rawExplanation)
            // 블록 배열이면 블록마다 독립 필드 키가 필요하다.
            // 옛 문자열 데이터는 기존 키를 그대로 써야 이미 칠해둔 형광펜이 어긋나지 않는다
            const isBlockExplanation = Array.isArray(rawExplanation)
            const choiceExpFieldKey = (i: number) =>
              isBlockExplanation ? `choiceexp_${c.label}_${i}` : `choiceexp_${c.label}`
            const explanationSummary = q.choiceExplanationSummaries?.[c.label]?.trim()
            const statementIsTrue = choiceTruth?.[c.label]
            const fieldKey = `choice_${c.label}`
            const isOpen = choiceMemoOpen === memoKey

            return (
              <div key={c.label}>
                <div className={`flex gap-3 items-start p-3 rounded-lg border text-sm ${
                  isCorrect ? 'border-emerald-600 bg-emerald-900/20' : 'border-border'
                }`}>
                  <span className={`font-semibold shrink-0 ${isCorrect ? 'text-emerald-400' : 'text-primary'}`}>
                    {c.label}
                  </span>
                  <span
                    ref={(el) => { fieldRefs.current[fieldKey] = el }}
                    className="text-foreground flex-1 select-text"
                  >
                    {renderHighlighted(c.text, fieldKey, highlights, removeHighlight)}
                  </span>
                  {/* 선지 문장 자체의 참/거짓 (정답 여부와 별개). 옛 데이터에는 없으므로 그때는 표시하지 않는다 */}
                  {statementIsTrue !== undefined && (
                    <span className={`shrink-0 text-xs font-bold ${statementIsTrue ? 'text-blue-400' : 'text-red-400'}`}>
                      {statementIsTrue ? 'O' : 'X'}
                    </span>
                  )}
                  {isCorrect && (
                    <span className="shrink-0 text-emerald-400 text-xs font-medium">✓ 정답</span>
                  )}
                  <button
                    onClick={() => {
                      if (isOpen) { setChoiceMemoOpen(null); setChoiceMemoText('') }
                      else { setChoiceMemoOpen(memoKey); setChoiceMemoText(existingMemo ?? '') }
                    }}
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                      existingMemo ? 'text-yellow-400 hover:text-yellow-300' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {existingMemo ? '📌' : '🖊️'}
                  </button>
                </div>

                {existingMemo && !isOpen && (
                  <div className="ml-3 mt-1 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
                    {existingMemo}
                  </div>
                )}

                {isOpen && (
                  <div className="ml-3 mt-1 space-y-1.5">
                    <textarea
                      value={choiceMemoText}
                      onChange={(e) => setChoiceMemoText(e.target.value)}
                      placeholder="이 항목에서 유의할 점을 메모하세요..."
                      rows={2}
                      autoFocus
                      className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setChoiceMemoOpen(null); setChoiceMemoText('') }} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                      {existingMemo && (
                        <button onClick={() => saveChoiceMemo(c.label, '')} className="text-xs text-red-400 hover:text-red-300">삭제</button>
                      )}
                      <button onClick={() => saveChoiceMemo(c.label, choiceMemoText)} className="text-xs text-primary font-medium hover:opacity-80">저장</button>
                    </div>
                  </div>
                )}

                {/* 선지 해설은 있으면 항상 보여준다.
                    이전에는 !subChoices 조건이 걸려 있었는데, subChoices는 subItems가 없을 때
                    지문 정규식 파싱으로 폴백하므로 지문에 "가./나." 같은 줄이 있으면 참이 되어
                    일반 ①~⑤ 문제의 선지 해설이 통째로 렌더되지 않았다 (볼드 미표시의 실제 원인) */}
                {(explanationSummary || explanationBlocks.length > 0) && (
                  <div className="ml-3 mt-1 bg-muted rounded-lg p-2.5 space-y-2">
                    {explanationSummary && (
                      <div className="flex gap-1.5 items-start">
                        <span className="shrink-0 text-[10px] text-primary font-medium mt-0.5">요약</span>
                        <p className="text-xs font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
                          {(() => {
                            const { text, bolds } = parseBoldMarks(explanationSummary)
                            return renderHighlighted(text, `choicesum_${c.label}`, [], undefined, bolds)
                          })()}
                        </p>
                      </div>
                    )}
                    {explanationSummary && explanationBlocks.length > 0 && <div className="border-t border-border" />}
                    {explanationBlocks.map((block, bi) => {
                      const key = choiceExpFieldKey(bi)
                      const { text: blockText, bolds } = parseBoldMarks(block.content)
                      if (block.type === 'lawBox') {
                        return (
                          <div key={key} className="border border-primary/30 bg-primary/5 rounded-lg p-2 space-y-1">
                            {block.title && (
                              <p className="text-[11px] font-semibold text-primary leading-snug">{parseBoldMarks(block.title).text}</p>
                            )}
                            <p
                              ref={(el) => { fieldRefs.current[key] = el }}
                              className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
                            >
                              {renderHighlighted(blockText, key, highlights, removeHighlight, bolds)}
                            </p>
                          </div>
                        )
                      }
                      return (
                        <p
                          key={key}
                          ref={(el) => { fieldRefs.current[key] = el }}
                          className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
                        >
                          {renderHighlighted(blockText, key, highlights, removeHighlight, bolds)}
                        </p>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 형광펜 스타일·색상 팝업 */}
      {highlightPopup && (
        <div
          ref={popupRef}
          className="fixed z-50 flex flex-col gap-1.5 bg-card border border-border rounded-xl shadow-lg px-2 py-2"
          style={{ left: highlightPopup.x, top: Math.max(highlightPopup.y - 88, 8), transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-1">
            {([['fill', '배경'], ['underline', '밑줄']] as [HighlightStyle, string][]).map(([style, label]) => (
              <button
                key={style}
                type="button"
                onClick={() => setHighlightStyle(style)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  highlightStyle === style
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHighlightPopup(null)}
              className="ml-auto text-muted-foreground hover:text-foreground text-xs px-1"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => applyHighlight(color)}
                title={`${HIGHLIGHT_COLOR_LABELS[color]} ${highlightStyle === 'underline' ? '밑줄' : '형광펜'}`}
                className={
                  highlightStyle === 'underline'
                    ? `w-6 h-6 rounded-full border-2 border-black/10 flex items-end justify-center pb-0.5 hover:scale-110 transition-transform`
                    : `w-6 h-6 rounded-full border border-black/10 hover:scale-110 transition-transform ${HIGHLIGHT_SWATCH_CLASSES[color]}`
                }
              >
                {highlightStyle === 'underline' && (
                  <span className={`block w-4 h-1 rounded-full ${HIGHLIGHT_SWATCH_CLASSES[color]}`} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 네비게이션 */}
      <div className="flex gap-2">
        <button
          onClick={() => current === startFrom ? onBack() : setCurrent(c => c - 1)}
          className="flex-1 py-2 bg-muted rounded-lg text-sm font-medium hover:bg-muted/70 transition-colors"
        >
          {current === startFrom ? '← 목록으로' : '이전'}
        </button>
        {isLast ? (
          <button
            onClick={() => onPartialQuiz(current, visitedList())}
            className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            학습 완료 — 문제 풀기 →
          </button>
        ) : (
          <button
            onClick={() => setCurrent(c => c + 1)}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            다음
          </button>
        )}
      </div>

      {/* 여기까지 풀기 / 임시저장 */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!confirm(`1~${current + 1}번 문제를 지금 풀고, 나머지 ${questions.length - current - 1}문제는 나중에 이어서 할까요?`)) return
            onPartialQuiz(current, visitedList())
          }}
          className="flex-1 py-2 border border-primary/40 text-primary rounded-lg text-xs hover:bg-primary/10 transition-colors"
        >
          ▶ 여기까지({current + 1}문제) 풀기
        </button>
        <button
          onClick={() => {
            if (!confirm(`여기서 멈추고 나중에 ${current + 1}번부터 이어서 할까요?`)) return
            onSaveAndExit(current, visitedList())
          }}
          className="flex-1 py-2 border border-border text-muted-foreground rounded-lg text-xs hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          💾 임시저장 후 나가기
        </button>
      </div>

      {/* 도트 네비게이션 */}
      <div className="flex flex-wrap gap-1 justify-center">
        {questions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => setCurrent(idx)}
            className={`w-6 h-6 rounded text-xs font-medium transition-all ${
              idx === current
                ? 'bg-primary text-primary-foreground'
                : bookmarked.has(q.id)
                  ? 'bg-yellow-500/30 text-yellow-300'
                  : visited.has(idx)
                    ? 'bg-emerald-700/50 text-emerald-300'
                    : 'bg-muted text-muted-foreground'
            }`}
          >
            {idx + 1}
          </button>
        ))}
      </div>

      {bookmarked.size > 0 && (
        <p className="text-xs text-center text-yellow-400">
          ⭐ {bookmarked.size}개 오답노트에 추가됨
        </p>
      )}
    </div>
  )
}