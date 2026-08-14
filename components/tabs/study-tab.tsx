import { useState, useEffect, useRef } from 'react'
import type { Question } from '@/lib/types'
import { QuizFilter } from '@/components/quiz/quiz-filter'
import { QuizEngine } from '@/components/quiz/quiz-engine'
import {
  addBookmark, removeBookmark, getWrongNotes, updateChoiceMemo,
  addSavedStudySession, getSavedStudySessions, removeSavedStudySession,
  clearSavedSession, getSavedSession
} from '@/lib/store'
import type { SavedStudySession } from '@/lib/store'

type StudyPhase = 'filter' | 'preview' | 'quiz'

export function StudyTab({ questions, onDone, onSync }: { questions: Question[]; onDone: () => void; onSync: () => void }) {
  const [phase, setPhase] = useState<StudyPhase>('filter')
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [previewFrom, setPreviewFrom] = useState(0)
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([])
  const [savedSessions, setSavedSessions] = useState<SavedStudySession[]>([])
  const [savedQuiz, setSavedQuiz] = useState(getSavedSession())
  const [activeSession, setActiveSession] = useState<SavedStudySession | null>(null)

  useEffect(() => {
    setSavedSessions(getSavedStudySessions())
    const q = getSavedSession()
    if (q && q.mode === 'study') setSavedQuiz(q)
  }, [])

  function handleNewStart(qs: Question[]) {
    clearSavedSession()
    setAllQuestions(qs)
    setPreviewFrom(0)
    setSavedQuiz(null)
    setActiveSession(null)
    onSync()
    setPhase('preview')
  }

  function handlePartialQuiz(upToIndex: number) {
    const toQuiz = allQuestions.slice(0, upToIndex + 1)
    const remaining = upToIndex + 1

    if (remaining < allQuestions.length) {
      const session: SavedStudySession = {
        allQuestions,
        previewedIndex: upToIndex,
        remainingFrom: remaining,
        savedAt: activeSession?.savedAt ?? Date.now(),
      }
      addSavedStudySession(session)
      setSavedSessions(getSavedStudySessions())
    } else {
      // 다 봤으면 해당 세션 삭제
      if (activeSession) {
        removeSavedStudySession(activeSession.savedAt)
        setSavedSessions(getSavedStudySessions())
      }
    }

    setQuizQuestions(toQuiz)
    setPhase('quiz')
    onSync()
  }

  function handleSaveAndExit(upToIndex: number) {
    const session: SavedStudySession = {
      allQuestions,
      previewedIndex: upToIndex,
      remainingFrom: upToIndex,
      savedAt: activeSession?.savedAt ?? Date.now(),
    }
    addSavedStudySession(session)
    setSavedSessions(getSavedStudySessions())
    setPhase('filter')
    setActiveSession(null)
    onSync()
  }

  function handleQuizFinish() {
    clearSavedSession()
    setSavedSessions(getSavedStudySessions())
    setSavedQuiz(null)
    setPhase('filter')
    onDone()
  }

  function handleResumePreview(session: SavedStudySession) {
    setAllQuestions(session.allQuestions)
    setPreviewFrom(session.remainingFrom)
    setActiveSession(session)
    setPhase('preview')
  }

  function handleResumeQuiz() {
    if (!savedQuiz || savedQuiz.mode !== 'study') return
    setQuizQuestions(savedQuiz.questions)
    setSavedQuiz(null)
    setPhase('quiz')
    onSync()
  }

  function handleDeleteSession(savedAt: number) {
    removeSavedStudySession(savedAt)
    setSavedSessions(getSavedStudySessions())
  }

  if (phase === 'preview') {
    return (
      <StudyBulkPreview
        questions={allQuestions}
        startFrom={previewFrom}
        onPartialQuiz={handlePartialQuiz}
        onSaveAndExit={handleSaveAndExit}
        onBack={() => setPhase('filter')}
        onDone={onDone}
      />
    )
  }

  if (phase === 'quiz') {
    const saved = getSavedSession()
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

      {/* 이어서 하기 - 퀴즈 */}
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
            <button onClick={() => { clearSavedSession(); setSavedQuiz(null) }} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/70">
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 이어서 하기 - 미리보기 목록 */}
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
                    {session.remainingFrom + 1}번부터 이어서 ·{' '}
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
              <button
                onClick={() => handleResumePreview(session)}
                className="w-full py-2 bg-purple-700 text-white rounded-lg text-sm font-medium hover:opacity-90"
              >
                {session.remainingFrom + 1}번부터 이어서 학습
              </button>
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

// ── 형광펜 ──────────────────────────────────────────────────────────────────
type HighlightColor = 'yellow' | 'green' | 'pink'

interface Highlight {
  id: string
  field: string
  start: number
  end: number
  color: HighlightColor
}

const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/70 dark:bg-yellow-500/40',
  green: 'bg-emerald-300/70 dark:bg-emerald-500/40',
  pink: 'bg-pink-300/70 dark:bg-pink-500/40',
}

const HIGHLIGHT_SWATCH_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-400',
  pink: 'bg-pink-400',
}

function highlightsKey(questionId: string) {
  return `lawpass_highlights_${questionId}`
}

function loadHighlights(questionId: string): Highlight[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(highlightsKey(questionId))
    return raw ? (JSON.parse(raw) as Highlight[]) : []
  } catch {
    return []
  }
}

function saveHighlights(questionId: string, highlights: Highlight[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(highlightsKey(questionId), JSON.stringify(highlights))
  } catch (e) {
    console.error('[study-tab] 형광펜 저장 실패', e)
  }
}

// 지정한 field 안에서 새 하이라이트와 겹치는 기존 하이라이트 제거
function withoutOverlaps(highlights: Highlight[], field: string, start: number, end: number) {
  return highlights.filter((h) => h.field !== field || h.end <= start || h.start >= end)
}

// container 안에서 node/offset 위치까지의 순수 텍스트 길이(문자 오프셋) 계산
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

// 텍스트를 하이라이트 구간에 따라 <mark>로 분할 렌더링
function renderHighlighted(
  text: string,
  field: string,
  highlights: Highlight[],
  onRemove: (id: string) => void
) {
  const fieldHighlights = highlights
    .filter((h) => h.field === field && h.start < h.end && h.end <= text.length)
    .sort((a, b) => a.start - b.start)

  if (fieldHighlights.length === 0) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const h of fieldHighlights) {
    if (h.start > cursor) nodes.push(text.slice(cursor, h.start))
    nodes.push(
      <mark
        key={h.id}
        onClick={(e) => {
          e.stopPropagation()
          onRemove(h.id)
        }}
        title="클릭하면 형광펜이 지워집니다"
        className={`${HIGHLIGHT_CLASSES[h.color]} rounded-sm cursor-pointer`}
      >
        {text.slice(h.start, h.end)}
      </mark>
    )
    cursor = Math.max(cursor, h.end)
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

// ── 가나다/ㄱㄴㄷㄹ 보기 항목 파싱 ─────────────────────────────────────────
// 지문·해설 원문이 "가나다라" 또는 "ㄱㄴㄷㄹ" 어느 표기를 쓰든 인식해 ㄱㄴㄷㄹ로 정규화
// (subChoiceAnswers 등 다른 필드가 ㄱㄴㄷㄹ 키를 쓰기 때문)
const SUB_LABEL_MAP: Record<string, string> = {
  '가': 'ㄱ', '나': 'ㄴ', '다': 'ㄷ', '라': 'ㄹ',
  'ㄱ': 'ㄱ', 'ㄴ': 'ㄴ', 'ㄷ': 'ㄷ', 'ㄹ': 'ㄹ',
}

interface SubChoice {
  stem: string
  items: { label: string; text: string }[]
}

function parseSubChoices(passage: string): SubChoice | null {
  // 줄 시작에 오는 라벨만 항목 표시로 인정 (문장이 "~다."로 끝나는 등 일반 텍스트의
  // 우연한 "가/나/다/라 + ." 매칭을 배제하기 위해 줄 시작 여부로 앵커링)
  const regex = /(?:^|\n)[ \t]*([가나다라ㄱㄴㄷㄹ])[ \t]*\.[ \t]*/g
  const markers: { label: string; start: number; contentStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(passage))) {
    const label = SUB_LABEL_MAP[m[1]]
    if (!label) continue
    const labelIndex = m.index + m[0].indexOf(m[1])
    markers.push({ label, start: labelIndex, contentStart: m.index + m[0].length })
  }
  if (markers.length < 2) return null

  const stem = passage.slice(0, markers[0].start).trim()
  const items: { label: string; text: string }[] = []
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].contentStart
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : passage.length
    const text = passage.slice(textStart, textEnd).trim()
    if (text) items.push({ label: markers[i].label, text })
  }
  return items.length >= 2 ? { stem, items } : null
}

// 전체 해설 텍스트에서 "ㄱ.(O)", "나.(X)" 등 항목별 표시를 찾아 각 항목의 해설을 분리
function parseSubExplanations(explanation: string | null): Record<string, string> {
  if (!explanation) return {}
  // 앞에 다른 한글 음절이 붙어있으면 (예: "유효하다.(O)") 항목 표시가 아니라 일반 문장의
  // 끝맺음이 우연히 겹친 것이므로, 한글 음절 뒤가 아닐 때만 항목 표시로 인정
  const regex = /(?<![가-힣])([가나다라ㄱㄴㄷㄹ])\s*\.\s*\([OoXx]\)/g
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
  onPartialQuiz,
  onSaveAndExit,
  onBack,
  onDone,
}: {
  questions: Question[]
  startFrom: number
  onPartialQuiz: (upToIndex: number) => void
  onSaveAndExit: (upToIndex: number) => void
  onBack: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState(startFrom)
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
  const subChoices = parseSubChoices(q.passage)
  const subExplanations = subChoices ? parseSubExplanations(q.explanation) : {}

  // 형광펜 상태 (문제 전환 시 다시 로드)
  const [highlights, setHighlights] = useState<Highlight[]>(() => loadHighlights(q.id))
  const [highlightPopup, setHighlightPopup] = useState<{ field: string; start: number; end: number; x: number; y: number } | null>(null)
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHighlights(loadHighlights(q.id))
    setHighlightPopup(null)
    fieldRefs.current = {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const next = [...cleaned, { id: `h_${Date.now()}`, field, start, end, color }]
    setHighlights(next)
    saveHighlights(q.id, next)
    setHighlightPopup(null)
    window.getSelection()?.removeAllRanges()
    ensureBookmarked()
  }

  function removeHighlight(id: string) {
    const next = highlights.filter((h) => h.id !== id)
    setHighlights(next)
    saveHighlights(q.id, next)
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
    if (!isBookmarked) {
      addBookmark(q)
      setBookmarked((prev) => new Set([...prev, q.id]))
    }
    const notes = getWrongNotes()
    const note = notes.find((n) => n.questionId === q.id)
    if (note) updateChoiceMemo(note.id, label, memo)
    setChoiceMemos((prev) => {
      const next = { ...prev }
      if (!next[q.id]) next[q.id] = {}
      if (memo.trim()) {
        next[q.id] = { ...next[q.id], [label]: memo }
      } else {
        const { [label]: _, ...rest } = next[q.id]
        next[q.id] = rest
      }
      return next
    })
    setChoiceMemoOpen(null)
    setChoiceMemoText('')
    onDone()
  }

  function ChoiceMemoButton({ memoKey, label, existingMemo }: { memoKey: string; label: string; existingMemo?: string }) {
    return (
      <button
        onClick={() => {
          if (choiceMemoOpen === memoKey) { setChoiceMemoOpen(null); setChoiceMemoText('') }
          else { setChoiceMemoOpen(memoKey); setChoiceMemoText(existingMemo ?? '') }
        }}
        className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
          existingMemo ? 'text-yellow-400 hover:text-yellow-300' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {existingMemo ? '📌' : '🖊️'}
      </button>
    )
  }

  function ChoiceMemoPanel({ memoKey, label, existingMemo }: { memoKey: string; label: string; existingMemo?: string }) {
    const isOpen = choiceMemoOpen === memoKey
    if (existingMemo && !isOpen) {
      return (
        <div className="ml-3 mt-1 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
          {existingMemo}
        </div>
      )
    }
    if (!isOpen) return null
    return (
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
            <button onClick={() => saveChoiceMemo(label, '')} className="text-xs text-red-400 hover:text-red-300">삭제</button>
          )}
          <button onClick={() => saveChoiceMemo(label, choiceMemoText)} className="text-xs text-primary font-medium hover:opacity-80">저장</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">학습 {current + 1} / {questions.length}</span>
        <span className="bg-purple-800/50 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-700/40">
          선학습 미리보기
        </span>
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

        {/* ㄱㄴㄷㄹ 보기 항목 */}
        {subChoices && (
          <div className="space-y-2 pl-3 border-l-2 border-border">
            {subChoices.items.map((item) => {
              const memoKey = `${q.id}_${item.label}`
              const existingMemo = choiceMemos[q.id]?.[item.label]
              const subAnswer = q.subChoiceAnswers?.[item.label]
              const subExplanation = subExplanations[item.label]
              const fieldKey = `sub_${item.label}`
              return (
                <div key={item.label}>
                  <div className="flex gap-2 items-start text-sm">
                    {subAnswer !== undefined && (
                      <span className={`shrink-0 font-bold ${subAnswer ? 'text-emerald-400' : 'text-red-400'}`}>
                        {subAnswer ? '✓ O' : '✗ X'}
                      </span>
                    )}
                    <span className="font-semibold text-primary shrink-0">{item.label}.</span>
                    <span
                      ref={(el) => { fieldRefs.current[fieldKey] = el }}
                      className="text-foreground flex-1 select-text"
                    >
                      {renderHighlighted(item.text, fieldKey, highlights, removeHighlight)}
                    </span>
                    <ChoiceMemoButton memoKey={memoKey} label={item.label} existingMemo={existingMemo} />
                  </div>
                  <ChoiceMemoPanel memoKey={memoKey} label={item.label} existingMemo={existingMemo} />
                  {subExplanation && (
                    <div className="ml-5 mt-1 bg-muted rounded-lg p-2.5">
                      <p className="text-xs text-foreground leading-relaxed">{subExplanation}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-2">
          {q.choices.map((c) => {
            const memoKey = `${q.id}_${c.label}`
            const existingMemo = choiceMemos[q.id]?.[c.label]
            const isCorrect = c.label === q.answer
            const explanation = q.choiceExplanations?.[c.label]
            const fieldKey = `choice_${c.label}`
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
                  <span className={`shrink-0 text-xs font-bold ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isCorrect ? 'O' : 'X'}
                  </span>
                  {isCorrect && (
                    <span className="shrink-0 text-emerald-400 text-xs font-medium">✓ 정답</span>
                  )}
                  <ChoiceMemoButton memoKey={memoKey} label={c.label} existingMemo={existingMemo} />
                </div>
                <ChoiceMemoPanel memoKey={memoKey} label={c.label} existingMemo={existingMemo} />
                {!subChoices && explanation && (
                  <div className="ml-3 mt-1 bg-muted rounded-lg p-2.5">
                    <p className="text-xs text-foreground leading-relaxed">{explanation}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 형광펜 색상 팝업 */}
      {highlightPopup && (
        <div
          ref={popupRef}
          className="fixed z-50 flex items-center gap-1.5 bg-card border border-border rounded-full shadow-lg px-2 py-1.5"
          style={{ left: highlightPopup.x, top: Math.max(highlightPopup.y - 44, 8), transform: 'translateX(-50%)' }}
        >
          {(['yellow', 'green', 'pink'] as HighlightColor[]).map((color) => (
            <button
              key={color}
              onClick={() => applyHighlight(color)}
              className={`w-6 h-6 rounded-full border border-black/10 hover:scale-110 transition-transform ${HIGHLIGHT_SWATCH_CLASSES[color]}`}
              title={color === 'yellow' ? '노랑' : color === 'green' ? '초록' : '핑크'}
            />
          ))}
          <button onClick={() => setHighlightPopup(null)} className="text-muted-foreground hover:text-foreground text-xs px-1">×</button>
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
            onClick={() => onPartialQuiz(current)}
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

      {/* 여기까지만 풀기 / 임시저장 */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!confirm(`1~${current + 1}번 문제를 지금 풀고, 나머지 ${questions.length - current - 1}문제는 나중에 이어서 할까요?`)) return
            onPartialQuiz(current)
          }}
          className="flex-1 py-2 border border-primary/40 text-primary rounded-lg text-xs hover:bg-primary/10 transition-colors"
        >
          ▶ 여기까지({current + 1}문제) 풀기
        </button>
        <button
          onClick={() => {
            if (!confirm(`여기서 멈추고 나중에 ${current + 1}번부터 이어서 할까요?`)) return
            onSaveAndExit(current)
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
                  : idx < current
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
