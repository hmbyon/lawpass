'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Question } from '@/lib/types'
import type { ExamType, Subject } from '@/lib/types'
import { SUBJECT_UNITS } from '@/lib/units'
import { getAppMode } from '@/lib/appMode'
import { readFavoriteCases, writeFavoriteCases } from '@/lib/caseFavorites'
import { FilterChips } from '@/components/filter-chips'
import { SubItemList } from '@/components/quiz/sub-item-list'
import { isAnswerLabel } from '@/lib/answers'
import {
  groupBySource, examMonthOf, examMonthValue, EXAM_MONTH_OPTIONS, type ExamMonthLabel,
} from '@/lib/questionSource'
import {
  buildUnifiedCaseDigest, filterCases, sortCases, periodLabel, PERIOD_OPTIONS, examYearLabel,
  findCaseMentions, allExplanationText, previewMention, selectedUnitsOf, mergeUnitSelection,
  searchCases, inOrigin, CASE_STUDY_SUBJECT, caseStudyProblemCount, casesSummaryTail,
  stripBucketLabels, groupCaseStudySources, caseStudyExamLabel, caseStudyQuestionLabel, caseNumberSpans,
  toggleExpanded, allVisibleExpanded, setVisibleExpanded, expandAllNeedsConfirm,
  type CaseGroup, type CaseSort, type CaseOrigin, type CaseSource,
} from '@/lib/caseDigest'
import type { Card, CaseIndex } from '@/lib/caseStudy/types'
import { fetchCaseCard } from '@/lib/firebaseServices/caseStudy'
import { caseJumpStatus } from '@/lib/caseStudy/group'
import { answerRows, caseCitations, problemSummary, type AnswerRow } from '@/lib/caseStudy/answerOutline'
import type { Problem } from '@/lib/caseStudy/types'

/**
 * 기출판례 — 해설에 인용된 판례를 판례 단위로 모아 보여준다.
 *
 * 판례는 파싱할 때 구조로 담긴다(Question.cases). 그 필드가 생기기 전에 파싱된 문제에는
 * 없으므로, 재파싱 전에는 목록이 비어 보이는 것이 정상이다.
 */

function QuestionLine({
  q,
  caseNumber,
  open,
  onToggle,
}: {
  q: Question
  caseNumber: string
  open: boolean
  onToggle: () => void
}) {
  // 판례 조각을 먼저 보여주고 해설 전체는 눌러야 나온다. 이 화면에 온 이유가 그 판례이지
  // 문제 전체가 아니기 때문이다
  const [showAll, setShowAll] = useState(false)
  const mentions = useMemo(() => findCaseMentions(q, caseNumber), [q, caseNumber])
  const whole = useMemo(() => allExplanationText(q), [q])
  return (
    <div>
      {/* 문제번호를 눌러 그 자리에서 펼친다 (검토 화면과 같은 방식) */}
      <button
        onClick={onToggle}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          open
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
        }`}
      >
        {q.no}번
      </button>
      {open && (
        <div className="mt-1.5 mb-1 p-2.5 rounded-lg bg-muted/50 border border-border space-y-2 text-xs">
          {/* 과목은 한 단 키워 진하게. 나머지 메타는 곁들이는 정보다 */}
          <p className="text-[11px] text-muted-foreground">
            <span className="text-xs font-semibold text-foreground">{q.subject}</span>
            {' · '}
            {q.examType} · {q.year ? `${q.year}년` : '연도 미상'}
            {q.unit ? ` · ${q.unit}` : ''}
          </p>
          <p className="text-foreground whitespace-pre-wrap leading-relaxed">{q.passage}</p>
          <SubItemList question={q} small />
          <div className="space-y-1">
            {q.choices.map((c) => (
              <div
                key={c.label}
                className={`flex gap-2 p-1.5 rounded border ${
                  isAnswerLabel(q.answer, c.label)
                    ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-border text-muted-foreground'
                }`}
              >
                <span className="font-semibold shrink-0">{c.label}</span>
                <span className="flex-1">{c.text}</span>
                {isAnswerLabel(q.answer, c.label) && <span className="shrink-0">✓ 정답</span>}
              </div>
            ))}
          </div>

          {/* 이 판례가 언급된 자리 */}
          {mentions.length > 0 ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-1.5">
              <p className="text-[11px] font-medium text-primary">이 판례가 언급된 부분</p>
              {mentions.map((m, i) => (
                <div key={`${m.where}-${i}`} className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">{m.where}</p>
                  <p className="text-foreground whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              이 문제 어디에서 인용됐는지 정확히 찾지 못했습니다
            </p>
          )}

          {whole.length > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAll ? '해설 접기' : '해설 전체 보기'}
              </button>
              {showAll &&
                whole.map((m, i) => (
                  <div key={`all-${m.where}-${i}`} className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">{m.where}</p>
                    <p className="text-foreground whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 사례형 카드는 판례 화면에서 출처 줄을 펼칠 때만 읽는다. 카드 단위로 한 번만 — 실패하면 지워서 다시 시도할 수 있게
const cardCache = new Map<string, Promise<Card | null>>()
function loadCard(cardId: string): Promise<Card | null> {
  const key = `${getAppMode()}|${cardId}`
  let p = cardCache.get(key)
  if (!p) {
    p = fetchCaseCard(getAppMode(), cardId).catch((e) => {
      cardCache.delete(key)
      throw e
    })
    cardCache.set(key, p)
  }
  return p
}

type CaseStudySource = Extract<CaseSource, { kind: 'caseStudy' }>

// 판례번호가 적힌 자리를 굵게. 글자만 쪼개 React 요소로 감싼다(HTML 을 넣지 않는다)
function Highlighted({ text, caseNumber }: { text: string; caseNumber: string }) {
  const spans = caseNumberSpans(text, caseNumber)
  const parts: ReactNode[] = []
  let at = 0
  spans.forEach((sp, i) => {
    if (sp.at > at) parts.push(text.slice(at, sp.at))
    parts.push(
      <strong key={i} className="font-semibold text-sky-700 dark:text-sky-300">
        {text.slice(sp.at, sp.at + sp.len)}
      </strong>
    )
    at = sp.at + sp.len
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

// 소제목. 보라 = 선택형, 파랑 = 사례형 — 박스 색과 같다. 이 둘이 출처를 가르는 유일한 표시다
function SourceHeading({ tone, children }: { tone: 'objective' | 'caseStudy'; children: ReactNode }) {
  return (
    <p className={`pt-1 text-[11px] font-semibold ${tone === 'objective' ? 'text-primary' : 'text-sky-700 dark:text-sky-300'}`}>
      {children}
    </p>
  )
}

const answerLabel = (s: CaseStudySource) =>
  `${caseStudyExamLabel(s.examType, s.exam)} ${caseStudyQuestionLabel(s.qno, s.sub)} 답안`

/**
 * 파란 박스 — 보라 요지 박스("22번 해설")에 대응한다. 이 판례가 나온 모범답안 문단을 **통째로** 보여준다.
 * 판례 카드가 수백 장이라 화면에 들어올 때 사례형 카드를 읽는다(카드 단위 캐시 공유).
 * 같은 문단은 한 번만, 나머지는 "다른 답안 N가지"로 펼친다
 */
function CaseStudyAnswerBox({ sources, caseNumber }: { sources: CaseStudySource[]; caseNumber: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ label: string; text: string }[] | 'idle' | 'loading' | 'error'>('idle')
  const [showAll, setShowAll] = useState(false)
  const ordered = useMemo(() => groupCaseStudySources(sources).flatMap((b) => b.sources), [sources])

  function load() {
    setState('loading')
    Promise.all(ordered.map((s) => loadCard(s.cardId).then((card) => ({ s, card }))))
      .then((list) => {
        const seen = new Set<string>()
        const entries: { label: string; text: string }[] = []
        for (const { s, card } of list) {
          // 박스에는 법리 부분만 — 같은 문단에 이어진 사안포섭은 문항 토글의 모범답안에서 본문으로 이어진다
          for (const { law: text } of caseCitations(card?.problems.find((p) => p.id === s.problemId), caseNumber)) {
            if (seen.has(text)) continue
            seen.add(text)
            entries.push({ label: answerLabel(s), text })
          }
        }
        setState(entries)
      })
      .catch(() => setState('error'))
  }

  useEffect(() => {
    if (state !== 'idle') return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      load()
      return
    }
    const io = new IntersectionObserver((list) => {
      if (list.some((e) => e.isIntersecting)) {
        io.disconnect()
        load()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const box = 'rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 space-y-0.5'
  return (
    <div ref={ref} className={box}>
      {state === 'idle' || state === 'loading' ? (
        <p className="text-[11px] text-muted-foreground">답안을 불러오는 중…</p>
      ) : state === 'error' ? (
        <button type="button" onClick={load} className="text-[11px] text-muted-foreground hover:text-foreground">
          답안을 불러오지 못했습니다 · 다시 시도
        </button>
      ) : state.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">모범답안에서 이 판례가 나온 문단을 찾지 못했습니다</p>
      ) : (
        <>
          {(showAll ? state : state.slice(0, 1)).map((e, i) => (
            <div key={i} className={i > 0 ? 'pt-1.5 space-y-0.5' : 'space-y-0.5'}>
              <p className="text-[11px] text-muted-foreground">{e.label}</p>
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                <Highlighted text={e.text} caseNumber={caseNumber} />
              </p>
            </div>
          ))}
          {state.length > 1 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="pt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showAll ? '다른 답안 접기' : `다른 답안 ${state.length - 1}가지`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// 사례형 카드 화면(case-card-view AnswerBlock)과 같은 타이포·들여쓰기 — 박스 없이 본문 그대로
const ANSWER_INDENT: Record<string, string> = { l2: 'pl-3', l3: 'pl-6' }

/** 답안 한 줄. 판례가 나온 문단은 법리 부분(문단 시작~인용 문장 끝)만 형광펜, 판례번호는 굵게 */
function AnswerRowView({ row, caseNumber }: { row: AnswerRow; caseNumber: string }) {
  const indent = row.lv ? ANSWER_INDENT[row.lv] : ''
  if (row.kind === 'heading') {
    const tone = row.muted ? 'text-muted-foreground font-normal' : 'text-foreground'
    return (
      <p className={`${row.t === 'h1' ? 'mt-3 first:mt-0 text-sm font-bold' : 'mt-2 text-[13px] font-semibold'} ${tone} ${indent}`}>
        {row.title}
        {row.pts && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{row.pts}</span>}
        {row.hit && (
          <span className="ml-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[10px] font-medium text-sky-700 dark:text-sky-300">
            이 판례가 나온 답안
          </span>
        )}
      </p>
    )
  }
  const end = row.highlightEnd
  return (
    <p className={`mt-1 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap ${indent}`}>
      {end > 0 && (
        <mark className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-400/25 [box-decoration-break:clone]">
          <Highlighted text={row.text.slice(0, end)} caseNumber={caseNumber} />
        </mark>
      )}
      <Highlighted text={row.text.slice(end)} caseNumber={caseNumber} />
    </p>
  )
}

/**
 * 펼친 사례형 문항: 문제 요약 → 설문 → (접힌) 사례 원문 → 모범답안 전체 → 카드 보기.
 * 답안은 목차와 본문을 순서 그대로 보이고 판례가 나온 법리 부분만 칠한다. 목차가 길면 판례 주변만 먼저
 */
function ProblemDetail({ problem, caseNumber }: { problem: Problem; caseNumber: string }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const summary = problemSummary(problem)
  const ask = problem.question?.ask.trim()
  // 원문 마지막 문단이 설문과 같은 글인 경우가 많다 — 설문은 따로 보이므로 겹치면 뺀다
  const original = (problem.question?.paragraphs ?? []).filter((t) => t.trim() !== ask)
  const { rows, hiddenCount, foldable } = answerRows(problem, caseNumber, showAll)
  const found = rows.some((r) => r.kind === 'paragraph' && r.highlightEnd > 0)

  return (
    <>
      {summary.lines.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-muted-foreground">문제 요약</p>
          {summary.fromBrief ? (
            <ul className="list-disc pl-4 space-y-0.5 text-foreground leading-relaxed">
              {summary.lines.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : (
            summary.lines.map((t, i) => <p key={i} className="text-foreground whitespace-pre-wrap leading-relaxed">{t}</p>)
          )}
        </div>
      )}
      {problem.question?.ask && (
        <p className="text-foreground font-medium border-l-2 border-sky-500 pl-2 leading-relaxed">{problem.question.ask}</p>
      )}
      {original.length > 0 && (
        <div className="space-y-1">
          <button type="button" onClick={() => setShowOriginal((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground">
            {showOriginal ? '▾ 사례 원문 접기' : '▸ 사례 원문 보기'}
          </button>
          {showOriginal && original.map((t, i) => (
            <p key={i} className="text-foreground whitespace-pre-wrap leading-relaxed">{t}</p>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-2">
        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">모범답안</p>
        {rows.map((r) => <AnswerRowView key={r.blockIndex} row={r} caseNumber={caseNumber} />)}
        {foldable && (hiddenCount > 0 || showAll) && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[11px] text-muted-foreground hover:text-foreground">
            {showAll ? '답안 접기' : `전체 답안 보기 (${hiddenCount}개 더)`}
          </button>
        )}
        {!found && <p className="mt-1 text-[11px] text-muted-foreground">모범답안에서 이 판례가 나온 문단을 찾지 못했습니다</p>}
      </div>
    </>
  )
}

/**
 * 사례형 문항 버튼 하나 — 선택형 "22번"(QuestionLine)과 같은 자리·같은 방식으로 그 자리에서 펼친다.
 * 펼치면 문제(사안 원문·설문)와 이 판례가 나온 답안 문단, 그리고 '카드 보기'(카드로 이동)를 보여준다.
 * 카드로 가기 전에 그 문항이 아직 있는지 확인하고, 지워졌으면 이동하지 않고 안내만 한다
 */
function CaseStudyQuestionLine({
  source,
  caseNumber,
  open,
  onToggle,
  onOpenCard,
}: {
  source: CaseStudySource
  caseNumber: string
  open: boolean
  onToggle: () => void
  onOpenCard?: (cardId: string, problemId: string) => void
}) {
  const [card, setCard] = useState<Card | null | undefined | 'error'>(undefined)
  const [jumpMsg, setJumpMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!open || (card !== undefined && card !== 'error')) return
    let alive = true
    loadCard(source.cardId)
      .then((c) => alive && setCard(c))
      .catch(() => alive && setCard('error'))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source.cardId])

  function openCard() {
    if (!onOpenCard) return
    setJumpMsg(null)
    loadCard(source.cardId)
      .then((c) => {
        const status = caseJumpStatus(c, source.problemId)
        if (status === 'ok') onOpenCard(source.cardId, source.problemId)
        else setJumpMsg(status === 'missing-card' ? '이 카드는 지금 사례형 목록에 없습니다' : '카드에서 이 문항을 찾지 못했습니다')
      })
      .catch(() => setJumpMsg('사례형 카드를 불러오지 못했습니다'))
  }

  const problem = card && card !== 'error' ? card.problems.find((p) => p.id === source.problemId) : undefined
  return (
    <div>
      <button
        onClick={onToggle}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          open
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
        }`}
      >
        {caseStudyQuestionLabel(source.qno, source.sub)}
      </button>
      {open && (
        <div className="mt-1.5 mb-1 p-2.5 rounded-lg bg-muted/50 border border-border space-y-2 text-xs">
          <p className="text-[11px] text-muted-foreground">
            <span className="text-xs font-semibold text-foreground">{CASE_STUDY_SUBJECT[source.subject]}</span>
            {' · '}
            {caseStudyExamLabel(source.examType, source.exam)} · {source.cardTitle}
          </p>
          {card === undefined ? (
            <p className="text-[11px] text-muted-foreground">문제를 불러오는 중…</p>
          ) : card === 'error' ? (
            <p className="text-[11px] text-muted-foreground">사례형 카드를 불러오지 못했습니다</p>
          ) : !problem ? (
            <p className="text-[11px] text-muted-foreground">이 카드에서 문항을 찾지 못했습니다</p>
          ) : (
            <ProblemDetail problem={problem} caseNumber={caseNumber} />
          )}
          {onOpenCard && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={openCard} className="text-[11px] text-primary hover:underline">
                카드 보기 →
              </button>
              {jumpMsg && <span className="text-[11px] text-amber-600 dark:text-amber-400">{jumpMsg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CaseCard({
  group,
  allQuestions,
  openId,
  onOpen,
  favorite,
  onToggleFavorite,
  origin,
  unified,
  onOpenCaseCard,
  expanded,
  onToggleExpand,
}: {
  group: CaseGroup
  // 출처에 파일명을 붙일지는 전체 문제집을 봐야 안다 (같은 회차의 다른 판본이 있는지)
  allQuestions: Question[]
  openId: string | null
  onOpen: (id: string | null) => void
  favorite: boolean
  onToggleFavorite: (key: string) => void
  // 출처 칩. 사례형 칩이면 선택형 출처는 접어 두고, 선택형 칩이면 예전 카드와 같다
  origin: CaseOrigin
  // 사례형 출처가 하나라도 있는 통합 화면인가. 아니면 카드가 예전과 한 글자도 다르지 않다
  unified: boolean
  onOpenCaseCard?: (cardId: string, problemId: string) => void
  // 접힌 카드는 판례번호 줄(메타)까지만 그리고, 그 아래(출처·박스·문항 토글)는 마운트하지 않는다
  expanded: boolean
  onToggleExpand: () => void
}) {
  // 카드에서 바로 보여줄 조각. 판례 목록을 훑는 사람이 매번 문제를 펼쳐 보게 할 이유가 없다
  const preview = useMemo(() => (expanded ? previewMention(group) : null), [group, expanded])
  const showObjective = origin !== 'caseStudy'
  const caseStudySources = unified && origin !== 'objective'
    ? group.sources.filter((s): s is CaseStudySource => s.kind === 'caseStudy')
    : []
  const hasCaseStudy = caseStudySources.length > 0
  const hasObjective = showObjective && group.questions.length > 0
  // 출제 횟수는 소스별로 ("선택형 3 · 사례형 2", 0 은 생략). 통합 화면이 아니면 예전 표기
  const countLabel = unified
    ? [
        showObjective && group.counts.objective > 0 && `선택형 ${group.counts.objective}`,
        origin !== 'objective' && group.counts.caseStudy > 0 && `사례형 ${group.counts.caseStudy}`,
      ].filter(Boolean).join(' · ')
    : `${group.count}회 출제`
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 space-y-2">
      {/* 헤더(요지·횟수·판례번호 줄)를 누르면 펼치고 접는다. 키보드는 오른쪽 ▸/▾ 버튼이 맡는다(aria-expanded).
          별은 헤더 클릭으로 번지지 않게 막는다 */}
      <div className="space-y-2 cursor-pointer" onClick={onToggleExpand}>
      <div className="flex items-start gap-2">
        {/* 별을 누르면 즐겨찾기. 위쪽 "즐겨찾기만" 으로 모아 볼 수 있다 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(group.key)
          }}
          aria-pressed={favorite}
          aria-label={favorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
          title={favorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
          className={`shrink-0 text-lg leading-none -mt-0.5 transition-colors ${
            favorite ? 'text-yellow-500' : 'text-muted-foreground/50 hover:text-yellow-500'
          }`}
        >
          {favorite ? '★' : '☆'}
        </button>
        {group.summary ? (
          <p className="flex-1 text-sm text-foreground leading-relaxed">{group.summary}</p>
        ) : (
          // 사례형에만 나온 판례는 요지가 없다. 오류가 아니므로 보조 문구로만
          <p className="flex-1 text-sm text-muted-foreground leading-relaxed">요지 없음</p>
        )}
        <span className="shrink-0 text-xs font-semibold text-primary tabular-nums">{countLabel}</span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '판례 접기' : '판례 펼치기'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          className="shrink-0 -mt-0.5 w-5 text-sm leading-none text-muted-foreground hover:text-foreground"
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {group.court ? `${group.court} ` : ''}
        {group.decidedDate ? `${group.decidedDate} 선고 ` : ''}
        <span className="text-foreground">{group.caseNumber}</span>
        {group.otherSummaries > 0 && ` · 다른 요약 ${group.otherSummaries}가지`}
      </p>
      </div>

      {expanded && (
      <>

      {/* 해설에 실제로 적힌 문장 — 요지는 요약이라 표현이 다듬어져 있다.
          길이는 previewMention 이 결론 문장을 남기며 줄여 둔다. CSS 로 한 번 더 접으면
          그 결론이 접힌 자리 아래로 밀려나므로 여기서는 접지 않는다.
          전문은 그 문제번호를 누르면 나온다 */}
      {/* 사례형 출처가 함께 보일 때만 소제목으로 가른다. 선택형 출처만 있거나 선택형 칩이면 예전 카드 그대로 */}
      {hasCaseStudy && hasObjective && <SourceHeading tone="objective">선택형</SourceHeading>}
      {showObjective && preview && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-0.5">
          <p className="text-[11px] text-muted-foreground">
            {preview.q.no}번 {preview.mention.where}
          </p>
          <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
            {preview.mention.text}
          </p>
        </div>
      )}

      {/* 출처별로 묶는다. 판례 하나가 여러 회차에 걸쳐 나오는 것이 이 화면의 핵심이라,
          문제번호만 늘어놓으면 어느 시험 것인지 알 수 없다 */}
      {hasObjective && (
      <div className="space-y-1.5">
        {/* 라벨 뒤 괄호(문제집 파일명)는 이 화면에서는 떼고, 같은 라벨이 되면 한 줄로 합친다 */}
        {stripBucketLabels(groupBySource(group.questions, allQuestions)).map((bucket) => (
          <div key={bucket.label} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground shrink-0">{bucket.label}</span>
            {bucket.questions.map((q) => (
              <QuestionLine
                key={q.id}
                q={q}
                caseNumber={group.caseNumber}
                open={openId === `${group.key}|${q.id}`}
                onToggle={() => onOpen(openId === `${group.key}|${q.id}` ? null : `${group.key}|${q.id}`)}
              />
            ))}
          </div>
        ))}
      </div>
      )}

      {hasCaseStudy && (
        <>
          <SourceHeading tone="caseStudy">사례형</SourceHeading>
          <CaseStudyAnswerBox sources={caseStudySources} caseNumber={group.key} />
          <div className="space-y-1.5">
            {groupCaseStudySources(caseStudySources).map((bucket) => (
              <div key={bucket.label} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground shrink-0">{bucket.label}</span>
                {bucket.sources.map((src) => {
                  const id = `${group.key}|cs|${src.problemId}`
                  return (
                    <CaseStudyQuestionLine
                      key={src.problemId}
                      source={src}
                      caseNumber={group.key}
                      open={openId === id}
                      onToggle={() => onOpen(openId === id ? null : id)}
                      onOpenCard={onOpenCaseCard}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']

const ORIGIN_KEY = 'lawpass_cases_origin'
const ORIGINS: { id: CaseOrigin; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'objective', label: '선택형' },
  { id: 'caseStudy', label: '사례형' },
]

export function CasesTab({
  questions,
  caseIndex,
  caseIndexError = false,
  onOpenCaseCard,
}: {
  questions: Question[]
  // 사례형 색인. 없으면(불러오는 중·실패·로그인 전) 예전과 똑같은 선택형 판례 화면이다
  caseIndex?: CaseIndex | null
  caseIndexError?: boolean
  // 사례형 출처 줄의 '카드 보기'. 주면 그 카드·문항으로 간다(app-shell 이 사례형으로 바꿔 연다)
  onOpenCaseCard?: (cardId: string, problemId: string) => void
}) {
  const digest = useMemo(() => buildUnifiedCaseDigest(questions, caseIndex), [questions, caseIndex])
  // 사례형 출처가 실제로 하나라도 있을 때만 출처 칩·소스별 횟수를 켠다.
  // v1 색인(문항 cases 없음)이나 색인 없음이면 화면이 예전과 한 글자도 다르지 않다
  const unified = useMemo(() => digest.groups.some((g) => g.counts.caseStudy > 0), [digest.groups])
  const [origin, setOrigin] = useState<CaseOrigin>('all')
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ORIGIN_KEY)
      if (saved === 'all' || saved === 'objective' || saved === 'caseStudy') setOrigin(saved)
    } catch {
      // 저장소를 못 읽으면 기본값(전체)으로 둔다
    }
  }, [])
  function changeOrigin(next: CaseOrigin) {
    setOrigin(next)
    try {
      localStorage.setItem(ORIGIN_KEY, next)
    } catch {
      // 기억하지 못해도 이번 화면에는 적용된다
    }
  }
  // 통합 화면이 아니면 늘 선택형 기준 — counts.objective 는 count 와 같아 숫자·정렬이 예전 그대로다
  const effectiveOrigin: CaseOrigin = unified ? origin : 'objective'
  const [openId, setOpenId] = useState<string | null>(null)
  // 펼친 판례 카드(정규화한 판례번호). 이 화면에만 있는 메모리 상태라 필터·칩·검색·정렬을 바꿔도,
  // 사례형 카드에 갔다 돌아와도 그대로다(판례 화면은 숨길 뿐 언마운트하지 않는다). 저장하지 않는다
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmExpandAll, setConfirmExpandAll] = useState<number | null>(null)
  function toggleCard(key: string) {
    // 접을 때 그 카드 안에서 열어 둔 문항 토글도 닫는다 (openId 는 "판례key|…")
    if (expanded.has(key) && openId?.startsWith(`${key}|`)) setOpenId(null)
    setExpanded((prev) => toggleExpanded(prev, key))
  }
  // 기본은 최근 5개년·출제횟수순. 탭 이름이 '기출판례'인 만큼 전체도 한 번에 볼 수 있게 둔다
  const [years, setYears] = useState<number | null>(5)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [examTypes, setExamTypes] = useState<ExamType[]>([])
  const [examMonths, setExamMonths] = useState<ExamMonthLabel[]>([])
  const [examYears, setExamYears] = useState<string[]>([])
  const [sort, setSort] = useState<CaseSort>('count')
  const [query, setQuery] = useState('')
  // 즐겨찾기. 저장소는 브라우저라 마운트 뒤에 읽는다(서버 렌더와 첫 화면을 맞추려는 것)
  const [favs, setFavs] = useState<Set<string>>(() => new Set())
  const [onlyFav, setOnlyFav] = useState(false)
  useEffect(() => {
    setFavs(readFavoriteCases(getAppMode()))
  }, [])
  function toggleFavorite(key: string) {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeFavoriteCases(getAppMode(), next)
      return next
    })
  }
  const now = useMemo(() => new Date(), [])

  // 과목·단원·시험유형만 적용한 목록. 기간으로 몇 건이 빠졌는지 세려면 그 앞 단계가 필요하다
  const scoped = useMemo(
    () => filterCases(digest.groups, { subjects, units, examTypes, examMonths, examYears, now, origin: effectiveOrigin }),
    [digest.groups, subjects, units, examTypes, examMonths, examYears, now, effectiveOrigin]
  )
  // 검색은 필터 결과를 한 번 더 거른다. 단원 칩의 '있는 것'(availableUnits)은 scoped 로
  // 계산하므로, 타이핑하는 동안 칩이 사라지지는 않는다
  const searchedAll = useMemo(() => searchCases(scoped, query), [scoped, query])
  // "즐겨찾기만"을 켜면 즐겨찾은 판례만 남긴다. 선고 시기(최근 N년)는 적용하지 않는다 —
  // 내가 골라 둔 판례가 기간 밖이라고 사라지면 즐겨찾기의 뜻이 없다
  const searched = useMemo(
    () => (onlyFav ? searchedAll.filter((g) => favs.has(g.key)) : searchedAll),
    [searchedAll, onlyFav, favs]
  )
  const effectiveYears = onlyFav ? null : years
  const inRange = useMemo(
    () => filterCases(searched, { years: effectiveYears, subjects, units, examTypes, examMonths, examYears, now, origin: effectiveOrigin }),
    [searched, effectiveYears, subjects, units, examTypes, examMonths, examYears, now, effectiveOrigin]
  )
  // 선고일을 모르는 판례는 기간과 무관하게 늘 따로 보여준다 (숨기면 재파싱할지 정할 수 없다).
  // 사례형에만 나온 판례도 선고일이 없어 여기에 든다. 출제 횟수는 고른 칩 기준으로 센다
  const dated = useMemo(() => sortCases(inRange.filter((g) => g.year !== null), sort, effectiveOrigin), [inRange, sort, effectiveOrigin])
  const undated = useMemo(() => sortCases(inRange.filter((g) => g.year === null), sort, effectiveOrigin), [inRange, sort, effectiveOrigin])
  // 출처 칩에 붙일 숫자 — 다른 조건(검색·과목·기간…)은 그대로 두고 칩만 바꿨을 때 보일 판례 수
  const originCounts = useMemo(() => {
    if (!unified) return null
    const shown = (o: CaseOrigin) => {
      const sc = filterCases(digest.groups, { subjects, units, examTypes, examMonths, examYears, now, origin: o })
      const se = searchCases(sc, query)
      const fv = onlyFav ? se.filter((g) => favs.has(g.key)) : se
      return filterCases(fv, { years: effectiveYears, subjects, units, examTypes, examMonths, examYears, now, origin: o }).length
    }
    return { all: shown('all'), objective: shown('objective'), caseStudy: shown('caseStudy') }
  }, [unified, digest.groups, subjects, units, examTypes, examMonths, examYears, now, query, onlyFav, favs, effectiveYears])
  // 사례형 출처가 칩·필터 후보에 보태질 때(선택형 칩이면 예전과 같게 보태지 않는다)
  const caseStudyPool = useMemo(
    () =>
      effectiveOrigin === 'objective'
        ? []
        : scoped.flatMap((g) => g.sources.filter((s): s is Extract<CaseSource, { kind: 'caseStudy' }> => s.kind === 'caseStudy')),
    [scoped, effectiveOrigin]
  )
  const caseStudyProblems = useMemo(() => caseStudyProblemCount(digest.groups), [digest.groups])
  const originTotal = useMemo(() => digest.groups.filter((g) => inOrigin(g, effectiveOrigin)).length, [digest.groups, effectiveOrigin])
  const hiddenByPeriod = searched.filter((g) => g.year !== null).length - dated.length
  // 지금 목록에 보이는 카드 (과목별 묶음에 같은 판례가 여러 번 나와도 한 번)
  const visibleKeys = useMemo(() => Array.from(new Set([...dated, ...undated].map((g) => g.key))), [dated, undated])
  // 보이는 목록이 바뀌면 떠 있던 '모두 펼칠까요?' 확인은 숫자가 맞지 않으니 거둔다
  useEffect(() => setConfirmExpandAll(null), [visibleKeys])

  /**
   * 과목을 고르지 않았으면 과목별로 나눠 세운다. 단원 분포와 같은 방식이고, 과목 순서도
   * 같은 상수(SUBJECT_UNITS 키 순서)를 쓴다.
   *
   * 한 판례가 여러 과목에서 인용됐으면 그 과목 섹션에 **모두** 넣는다. 하나로 몰아넣으면
   * "이 판례가 여러 과목에 걸쳐 나온다"는 사실이 사라진다 — 그게 이 화면의 값이다.
   * 과목을 고른 상태에서는 이미 좁혀 보는 중이므로 나누지 않고 평평하게 둔다
   */
  const bySubject = useMemo(() => {
    if (subjects.length > 0) return null
    return (Object.keys(SUBJECT_UNITS) as Subject[])
      .map((subject) => ({ subject, cases: dated.filter((g) => g.subjects.includes(subject)) }))
      .filter((sec) => sec.cases.length > 0)
  }, [subjects, dated])

  const availableUnits = useMemo(
    () => Array.from(new Set(scoped.flatMap((g) => g.units))),
    [scoped]
  )
  const availableSubjects = useMemo(() => {
    const groups = digest.groups.filter((g) => inOrigin(g, effectiveOrigin))
    const fromCaseStudy =
      effectiveOrigin === 'objective'
        ? []
        : groups.flatMap((g) => g.sources.flatMap((s) => (s.kind === 'caseStudy' ? [CASE_STUDY_SUBJECT[s.subject]] : [])))
    return Array.from(new Set([...groups.flatMap((g) => g.subjects), ...fromCaseStudy]))
  }, [digest.groups, effectiveOrigin])
  const availableExamTypes = useMemo(
    () =>
      Array.from(
        new Set([
          ...scoped.flatMap((g) => g.questions.map((q) => q.examType)),
          ...caseStudyPool.map((s): ExamType => (s.examType === '변시' ? '변호사시험' : '모의고사')),
        ])
      ),
    [scoped, caseStudyPool]
  )
  // 회차(6/8/10모)는 '모의고사' 문제들에서만 뽑는다. 파일명에서 월을 못 읽은 문제는 후보에서 빠진다
  const availableExamMonths = useMemo(() => {
    const found = new Set<6 | 8 | 10>()
    for (const g of scoped) {
      for (const q of g.questions) {
        if (q.examType !== '모의고사') continue
        const month = examMonthOf(q.sourceFile)
        if (month) found.add(month)
      }
    }
    for (const s of caseStudyPool) {
      const month = s.examType === '모의' ? Number(String(s.exam).split('.')[1]) : 0
      if (month === 6 || month === 8 || month === 10) found.add(month)
    }
    return EXAM_MONTH_OPTIONS.filter((label) => found.has(examMonthValue(label)))
  }, [scoped, caseStudyPool])
  // 출제연도는 변호사시험·모의고사 문제들의 실제 연도에서 뽑아 최신순으로 둔다.
  // 시험유형을 골랐으면 그 유형에 있는 연도만 후보가 된다. 연도를 못 읽은 문제는 후보에서 빠진다
  const availableExamYears = useMemo(() => {
    const found = new Set<number>()
    for (const g of scoped) {
      for (const q of g.questions) {
        if (examTypes.length > 0 && !examTypes.includes(q.examType)) continue
        if (q.year) found.add(q.year)
      }
    }
    for (const s of caseStudyPool) {
      if (examTypes.length > 0 && !examTypes.includes(s.examType === '변시' ? '변호사시험' : '모의고사')) continue
      if (s.year) found.add(s.year)
    }
    return Array.from(found)
      .sort((a, b) => b - a)
      .map(examYearLabel)
  }, [scoped, examTypes, caseStudyPool])

  // 출제연도 '최근 N개년': 후보 연도(최신순) 앞에서 N개를 고른다. 비어 있으면 전체이므로 '전체'는 선택을 비운다
  const RECENT_EXAM_YEARS = [1, 3, 5]
  const recentExamYears = (n: number) => availableExamYears.slice(0, n)
  const sameYears = (a: string[], b: string[]) => a.length === b.length && a.every((y) => b.includes(y))

  function handleExamTypesChange(next: ExamType[]) {
    setExamTypes(next)
    if (!next.includes('모의고사')) setExamMonths([])
  }

  function changeSubjects(next: Subject[]) {
    setSubjects(next)
    // 고른 과목에 없는 단원은 선택에서 뺀다. 남겨 두면 결과가 0건인데 이유가 안 보인다
    const allowed = new Set(
      (next.length > 0 ? next : (Object.keys(SUBJECT_UNITS) as Subject[])).flatMap((s) => SUBJECT_UNITS[s] ?? [])
    )
    setUnits((prev) => prev.filter((u) => allowed.has(u)))
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">기출판례</h2>
        <p className="text-sm text-muted-foreground">
          해설에 인용된 판례를 판례별로 모아, 많이 나온 순서로 보여줍니다.
        </p>
        {caseIndexError && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            사례형 판례를 불러오지 못해 선택형 판례만 보여줍니다
          </p>
        )}
      </div>

      {digest.totalGroups === 0 ? (
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-1">
          <p className="text-sm text-foreground">아직 모인 판례가 없습니다</p>
          <p className="text-xs text-muted-foreground">
            판례는 PDF를 분석할 때 해설에서 함께 뽑습니다. 이 기능이 생기기 전에 분석한 문제집에는
            판례 정보가 없어, 다시 분석해야 여기에 쌓입니다.
          </p>
        </div>
      ) : (
        <>
          {/* 기간 — quiz-filter 의 "최근 N개년"과 같은 뜻이다 (올해 포함 N개 연도) */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            {/* 검색을 맨 위에 둔다. 찾을 것이 정해져 있으면 필터를 거칠 이유가 없다.
                판례가 수백 건이라 글자마다 다시 걸러도 부담이 없어 디바운스는 두지 않았다 */}
            <div className="flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="사건번호 · 요지 키워드 · 문제번호로 검색"
                className="flex-1 min-w-0 bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
              {query.trim().length > 0 && (
                <button
                  onClick={() => setQuery('')}
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  지우기
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setOnlyFav((v) => !v)}
                aria-pressed={onlyFav}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  onlyFav
                    ? 'border-yellow-500 bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-yellow-500/50'
                }`}
              >
                {onlyFav ? '★' : '☆'} 즐겨찾기만 보기 ({favs.size})
              </button>
              {onlyFav && <span className="text-[11px] text-muted-foreground">선고 시기와 상관없이 모아 봐요</span>}
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">선고 시기</label>
              <div className="flex gap-1.5">
                {PERIOD_OPTIONS.map((n) => (
                  <button
                    key={String(n)}
                    onClick={() => setYears(n)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      years === n
                        ? 'border-primary text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                    }`}
                  >
                    {periodLabel(n)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">과목 (복수 선택)</label>
              <FilterChips
                options={Object.keys(SUBJECT_UNITS) as Subject[]}
                selected={subjects}
                onChange={changeSubjects}
                available={availableSubjects}
              />
            </div>

            {/* 과목을 먼저 고르기 전에는 아무 칩도 '선택됨'으로 보이지 않는다.
                과목을 고르는 순간 — 아직 시험유형/회차를 직접 고르지 않았다면 — 한꺼번에
                전체 선택(allImplied) 상태로 자동 전환된다. 과목이 1차 게이트다 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">시험 유형 (복수 선택)</label>
              {subjects.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  과목을 먼저 고르면 전체 선택 상태로 시작합니다
                </p>
              ) : examTypes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  전체를 보고 있습니다 · 하나를 누르면 그것만 빠집니다
                </p>
              ) : null}
              <FilterChips
                options={EXAM_TYPES}
                selected={examTypes}
                onChange={handleExamTypesChange}
                available={availableExamTypes}
                allImplied={subjects.length > 0 && examTypes.length === 0}
              />
            </div>

            {/* 모의고사 회차(6/8/10모)는 과목을 고른 뒤, 모의고사가 범위 안에 있을 때(직접 골랐거나
                시험유형을 아무것도 안 골라 전체가 암묵적으로 포함된 때)만 보인다 */}
            {subjects.length > 0 && (examTypes.length === 0 || examTypes.includes('모의고사')) && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">모의고사 회차 (복수 선택)</label>
                {examMonths.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    전체를 보고 있습니다 · 하나를 누르면 그것만 빠집니다
                  </p>
                )}
                <FilterChips
                  options={[...EXAM_MONTH_OPTIONS]}
                  selected={examMonths}
                  onChange={setExamMonths}
                  available={availableExamMonths}
                  allImplied={examMonths.length === 0}
                />
              </div>
            )}

            {/* 출제연도: 변호사시험도 회차(1~N회) 대신 연도로 고른다. 문제 풀기 화면과 같은 방식 */}
            {subjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">출제연도 (복수 선택)</label>
                  {availableExamYears.length > 0 && (
                    <div className="flex gap-1.5">
                      {RECENT_EXAM_YEARS.map((n) => {
                        // 후보가 N개보다 적으면 '최근 N개년'은 전체와 같다 — 그때는 눌러도 전체로 취급한다
                        const picked = recentExamYears(n)
                        const active = examYears.length > 0 && sameYears(examYears, picked)
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setExamYears(picked.length >= availableExamYears.length ? [] : picked)}
                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                              active
                                ? 'border-primary text-primary'
                                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                            }`}
                          >
                            최근 {n}개년
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => setExamYears([])}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          examYears.length === 0
                            ? 'border-primary text-primary'
                            : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                        }`}
                      >
                        전체
                      </button>
                    </div>
                  )}
                </div>
                {availableExamYears.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">연도를 읽은 문제가 없습니다</p>
                ) : (
                  <>
                    {examYears.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        전체를 보고 있습니다 · 하나를 누르면 그것만 빠집니다
                      </p>
                    )}
                    <FilterChips
                      options={availableExamYears}
                      selected={examYears}
                      onChange={setExamYears}
                      allImplied={examYears.length === 0}
                    />
                  </>
                )}
              </div>
            )}

            {/* 단원은 고른 과목의 것만 보여준다. 과목을 안 고르면 일곱 과목의 단원이 한꺼번에
                쏟아져 고를 수가 없다 (지금 36개) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">단원 (복수 선택)</label>
              {subjects.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">과목을 고르면 그 과목의 단원이 나옵니다</p>
              ) : (
                <div className="space-y-2.5">
                  {units.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      고른 과목의 단원 전체를 보고 있습니다 · 하나를 누르면 그 단원만 빠집니다
                    </p>
                  )}
                  {/* 과목마다 한 줄로 끊는다. 이어 붙이면 어느 단원이 어느 과목 것인지
                      이름만으로는 알 수 없다 */}
                  {subjects.map((s) => (
                    <div key={s} className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{s}</p>
                      <FilterChips
                        options={SUBJECT_UNITS[s] ?? []}
                        selected={units}
                        onChange={(next) => setUnits(mergeUnitSelection(s, units, next))}
                        available={availableUnits}
                        allImplied={selectedUnitsOf(s, units).length === 0}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="text-xs font-medium text-muted-foreground">정렬</label>
              <div className="flex rounded-lg border border-border overflow-hidden text-[11px]">
                {([
                  { id: 'count' as const, label: '출제횟수순' },
                  { id: 'date' as const, label: '선고일순' },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSort(opt.id)}
                    className={`px-2 py-1 transition-colors ${
                      sort === opt.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 출처 칩 — 사례형 출처가 있을 때만. 기록형은 아직 데이터가 없어 칩을 두지 않는다 */}
          {originCounts && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="출처">
              {ORIGINS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => changeOrigin(o.id)}
                  aria-pressed={effectiveOrigin === o.id}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    effectiveOrigin === o.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {o.label} <span className="tabular-nums opacity-80">{originCounts[o.id]}</span>
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            판례 {originTotal}건 중 {dated.length + undated.length}건 표시 ·{' '}
            {casesSummaryTail(effectiveOrigin, digest.questionsWithCases, caseStudyProblems)}
            {/* 뺀 건수는 실제로 뺐을 때만 알린다 */}
            {effectiveYears !== null && hiddenByPeriod > 0 && ` · ${periodLabel(effectiveYears)}보다 오래된 판례 ${hiddenByPeriod}건은 뺐습니다`}
          </p>

          {/* 모두 펼치기/접기 — 지금 목록에 보이는 카드에만. 많으면(50장 초과) 한 번 묻고 펼친다 */}
          {visibleKeys.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
              {confirmExpandAll !== null ? (
                <>
                  <span className="text-muted-foreground">{confirmExpandAll}개 카드를 모두 펼칠까요?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded((prev) => setVisibleExpanded(prev, visibleKeys, true))
                      setConfirmExpandAll(null)
                    }}
                    className="text-primary hover:underline"
                  >
                    펼치기
                  </button>
                  <button type="button" onClick={() => setConfirmExpandAll(null)} className="text-muted-foreground hover:text-foreground">
                    취소
                  </button>
                </>
              ) : allVisibleExpanded(expanded, visibleKeys) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (openId && visibleKeys.some((k) => openId.startsWith(`${k}|`))) setOpenId(null)
                    setExpanded((prev) => setVisibleExpanded(prev, visibleKeys, false))
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  모두 접기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const n = expandAllNeedsConfirm(visibleKeys)
                    if (n !== null) setConfirmExpandAll(n)
                    else setExpanded((prev) => setVisibleExpanded(prev, visibleKeys, true))
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  모두 펼치기
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            {/* 선고일 미상 판례는 아래에 따로 나오므로, 그것까지 없을 때만 '없다'고 적는다 */}
            {dated.length === 0 && undated.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {query.trim()
                  ? '검색 결과가 없습니다'
                  : onlyFav && favs.size === 0
                    ? '즐겨찾기한 판례가 없습니다. 판례 카드 왼쪽의 ☆를 눌러 추가하세요'
                    : '고른 조건에 해당하는 판례가 없습니다'}
              </p>
            )}
            {bySubject
              ? bySubject.map((sec) => (
                  <div key={sec.subject} className="space-y-2 pt-1">
                    {/* 이 줄이 목록을 과목으로 가르는 유일한 표시다. 카드 제목(요지)보다
                        작으면 어느 과목을 보고 있는지가 스크롤 중에 사라진다 */}
                    <p className="text-sm font-semibold text-foreground">
                      {sec.subject}{' '}
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {sec.cases.length}건
                      </span>
                    </p>
                    {sec.cases.map((g) => (
                      <CaseCard
                        key={`${sec.subject}|${g.key}`}
                        group={g}
                        allQuestions={questions}
                        openId={openId}
                        onOpen={setOpenId}
                        favorite={favs.has(g.key)}
                        onToggleFavorite={toggleFavorite} origin={effectiveOrigin} unified={unified} onOpenCaseCard={onOpenCaseCard} expanded={expanded.has(g.key)} onToggleExpand={() => toggleCard(g.key)}
                      />
                    ))}
                  </div>
                ))
              : dated.map((g) => (
                  <CaseCard key={g.key} group={g} allQuestions={questions} openId={openId} onOpen={setOpenId} favorite={favs.has(g.key)} onToggleFavorite={toggleFavorite} origin={effectiveOrigin} unified={unified} onOpenCaseCard={onOpenCaseCard} expanded={expanded.has(g.key)} onToggleExpand={() => toggleCard(g.key)} />
                ))}
          </div>

          {/* 선고일을 모르는 판례는 숨기지 않는다. 몇 건이 그런지 보여야 재파싱할지 정할 수 있다 */}
          {undated.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                선고일 미상 {undated.length}건
                <span className="text-[11px]">
                  {effectiveOrigin === 'objective'
                    ? ' — 해설에 선고일이 적혀 있지 않아 연도를 알 수 없습니다'
                    : ' — 사례형에만 나온 판례 등 선고일을 알 수 없는 판례입니다 · 선고 시기 필터와 상관없이 늘 보입니다'}
                </span>
              </p>
              {undated.map((g) => (
                <CaseCard key={g.key} group={g} allQuestions={questions} openId={openId} onOpen={setOpenId} favorite={favs.has(g.key)} onToggleFavorite={toggleFavorite} origin={effectiveOrigin} unified={unified} onOpenCaseCard={onOpenCaseCard} expanded={expanded.has(g.key)} onToggleExpand={() => toggleCard(g.key)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
