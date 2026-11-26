'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchAllRecordCards } from '@/lib/firebaseServices/caseStudy'
import { fetchDrillResults, saveDrillResult } from '@/lib/firebaseServices/recordDrill'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import { cardsWithSubject, type RecordCard } from '@/lib/record/cardStorage'
import {
  applyResult, drillStats, examChipsOfCards, filterCards, orderCards, subjectsOfCards,
  type DrillMark, type DrillResults,
} from '@/lib/record/drillProgress'
import { FilterChips } from '@/components/filter-chips'
import { NoteTable, type TableBlock } from '@/components/record/notes-viewer'

const KINDS = ['변시', '모의']
const MARKS: { id: DrillMark; label: string }[] = [
  { id: 'o', label: '맞음' },
  { id: 'h', label: '아쉬움' },
  { id: 'x', label: '틀림' },
]
const OPT_WRONG = '틀린·아쉬운 카드만'
const OPT_SHUFFLE = '섞어서 풀기'

// 사례형 화면과 같은 클래스. 그쪽 상수가 export 되지 않아 같은 값을 둔다(사례형 파일은 건드리지 않는다)
// case-cbt.tsx: SECTION · LABEL · smallBtn · 결과 카드 · 시작 버튼
const SECTION = 'bg-card border border-border rounded-xl p-4 space-y-3'
const LABEL = 'text-xs font-medium text-muted-foreground'
const SMALL_BTN = 'text-[10px] px-2 py-0.5 rounded-full border transition-colors'
const smallBtn = (on: boolean) =>
  `${SMALL_BTN} ${on ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`
const RESULT_CARD = 'bg-card border border-border rounded-xl p-4 flex items-center justify-between text-sm'
const START_BTN =
  'w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity'
// case-solve.tsx: 보조 버튼(btn) · 주 버튼(제출) · 답안 입력창
const btn = 'text-xs border border-border rounded-lg px-2.5 py-1 transition-colors hover:border-foreground/30 disabled:opacity-40'
const primaryBtn = 'text-xs font-semibold rounded-lg px-3 py-1 bg-primary text-primary-foreground'
const TEXTAREA =
  'w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground focus:outline-none focus:border-primary/50'

// 정답 표 — 정리본 열람의 표(NoteTable)를 그대로 쓴다. 블록 객체를 카드마다 고정해 행 높이 맞춤이 매 렌더 다시 돌지 않게 한다
function AnswerTable({ card }: { card: RecordCard }) {
  const block = useMemo<TableBlock>(() => ({ t: 'table', rows: card.rows }), [card])
  return <NoteTable b={block} />
}

// 정리본과 같은 sanitizer 출력만 넣는다
function NoteHtml({ html }: { html: string }) {
  return <div className="record-note text-sm" dangerouslySetInnerHTML={{ __html: sanitizeNote(html ?? '') }} />
}

// 사례형 화면과 같은 바깥 틀 (.case-study 범위 · 폭 · 간격)
function Frame({ children }: { children: ReactNode }) {
  return <div className="case-study space-y-5 max-w-2xl mx-auto">{children}</div>
}

/**
 * 기록형 문제 풀기 — 공법·민사·형사 기출 카드. 앞면(당사자·문제 제목) → 직접 써 보기 → 정답 표 → 자가채점.
 * 결과는 카드마다 본인 계정에 저장해, 틀린·아쉬운 카드만 다시 풀 수 있게 한다
 */
export function DrillView({ isAdmin }: { isAdmin: boolean }) {
  const [cards, setCards] = useState<RecordCard[] | undefined>(undefined) // undefined = 불러오는 중
  const [loadError, setLoadError] = useState('')
  const [results, setResults] = useState<DrillResults>({})
  const [saveError, setSaveError] = useState('')

  // 시작 화면 조건
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [exams, setExams] = useState<string[]>([])
  const [wrongOnly, setWrongOnly] = useState(false)
  const [shuffle, setShuffle] = useState(false)

  // 풀이 중인 묶음 (카드 id 순서·위치·정답 펼침·이번 묶음 채점)
  const [session, setSession] = useState<{ ids: string[]; pos: number; revealed: boolean; marks: Record<string, DrillMark> } | null>(null)
  const [text, setText] = useState('')

  const load = useCallback(() => {
    setCards(undefined)
    setLoadError('')
    const mode = getAppMode()
    const uid = auth.currentUser?.uid
    Promise.all([fetchAllRecordCards(mode), uid ? fetchDrillResults(uid, mode) : Promise.resolve({})])
      .then(([docs, res]) => {
        setCards(cardsWithSubject(docs))
        setResults(res)
      })
      .catch((e: Error) => setLoadError(e.message || '불러오지 못했습니다'))
  }, [])
  useEffect(load, [load])

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards])
  // 고른 과목(없으면 전부)의 카드 — 시험 유형·회차 칩, 현황 숫자가 이 기준이다
  const subjectOptions = useMemo(() => subjectsOfCards(cards ?? []), [cards])
  const ofSubjects = useCallback(
    (list: string[]) => filterCards(cards ?? [], { subjects: list, kinds: [], exams: [], wrongOnly: false }, {}),
    [cards]
  )
  const subjectCards = useMemo(() => ofSubjects(subjects), [ofSubjects, subjects])
  const examChips = useMemo(() => examChipsOfCards(subjectCards, kinds), [subjectCards, kinds])
  const chosen = useMemo(
    () => filterCards(cards ?? [], { subjects, kinds, exams: exams.filter((e) => examChips.includes(e)), wrongOnly }, results),
    [cards, subjects, kinds, exams, examChips, wrongOnly, results]
  )
  const stats = useMemo(() => drillStats(subjectCards, results), [subjectCards, results])
  // 과목을 바꾸면 새 선택지에 없는 회차 선택은 푼다
  function changeSubjects(next: string[]) {
    setSubjects(next)
    const chips = examChipsOfCards(ofSubjects(next), kinds)
    setExams((prev) => prev.filter((e) => chips.includes(e)))
  }

  function start(list: RecordCard[]) {
    if (list.length === 0) return
    setSession({ ids: orderCards(list, shuffle, Date.now()).map((c) => c.id), pos: 0, revealed: false, marks: {} })
    setText('')
    window.scrollTo({ top: 0 })
  }
  function grade(card: RecordCard, mark: DrillMark) {
    const next = applyResult(results, card.id, mark, Date.now())
    setResults(next)
    setSaveError('')
    const uid = auth.currentUser?.uid
    if (uid) saveDrillResult(uid, getAppMode(), card.id, next[card.id]).catch(() => setSaveError('결과를 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.'))
    setSession((s) => (s ? { ...s, pos: s.pos + 1, revealed: false, marks: { ...s.marks, [card.id]: mark } } : s))
    setText('')
    window.scrollTo({ top: 0 })
  }

  if (loadError) {
    return (
      <Frame>
        <div className={`${SECTION} text-xs text-muted-foreground`}>
          <p>카드를 불러오지 못했습니다 ({loadError})</p>
          <button onClick={load} className={btn}>다시 시도</button>
        </div>
      </Frame>
    )
  }
  if (cards === undefined) {
    return (
      <Frame>
        <p className="text-xs text-muted-foreground animate-pulse">카드를 불러오는 중…</p>
      </Frame>
    )
  }
  if (cards.length === 0) {
    return (
      <Frame>
        <div className={`${SECTION} text-sm text-muted-foreground`}>
          {isAdmin ? '가져오기에서 카드 파일을 올려 주세요' : '준비 중이에요'}
        </div>
      </Frame>
    )
  }

  // ── 풀이 화면 ─────────────────────────────────────────────
  if (session) {
    const { ids, pos, revealed, marks } = session
    if (pos >= ids.length) {
      const tally = { o: 0, h: 0, x: 0 }
      for (const m of Object.values(marks)) tally[m]++
      const again = ids.filter((id) => marks[id] === 'h' || marks[id] === 'x').map((id) => byId.get(id)).filter((c): c is RecordCard => !!c)
      return (
        <Frame>
          <div>
            <h2 className="text-lg font-bold text-foreground mb-1">다 풀었어요</h2>
            <p className="text-sm text-muted-foreground">틀리거나 아쉬운 카드는 다시 풀어 보세요.</p>
          </div>
          <div className={RESULT_CARD}>
            <span className="text-muted-foreground">이번 결과</span>
            <span className="text-foreground font-medium tabular-nums">
              맞음 {tally.o} · 아쉬움 {tally.h} · 틀림 {tally.x}
            </span>
          </div>
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <button className={START_BTN} disabled={again.length === 0} onClick={() => start(again)}>
            {again.length > 0 ? `틀린 카드만 다시 풀기 — ${again.length}장` : '다시 풀 카드가 없습니다'}
          </button>
          <button className={`${btn} w-full py-2 text-muted-foreground`} onClick={() => setSession(null)}>
            처음으로
          </button>
        </Frame>
      )
    }
    const card = byId.get(ids[pos])
    const prev = () => setSession({ ...session, pos: pos - 1, revealed: false })
    return (
      <Frame>
        {/* 진행도 — 사례형 풀이 화면 머리줄과 같은 모양 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <button onClick={() => setSession(null)} className={`${btn} text-muted-foreground`}>← 나가기</button>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">문제 풀기</span>
          <span className="tabular-nums text-sm font-semibold text-foreground">
            {pos + 1} / {ids.length}
          </span>
        </div>

        {!card ? (
          // 카드가 다시 올라와 id 가 사라진 경우 — 건너뛴다
          <div className={`${SECTION} text-xs text-muted-foreground`}>
            <p>이 카드를 찾지 못했습니다</p>
            <button className={btn} onClick={() => setSession({ ...session, pos: pos + 1, revealed: false })}>다음</button>
          </div>
        ) : (
          <>
            <div className={SECTION}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 rounded-md border border-primary bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {card.subject ? `${card.subject} · ${card.label}` : card.label}
                </span>
                {card.note && <span className="text-[11px] text-yellow-400">{card.note}</span>}
              </div>
              {card.parties && <NoteHtml html={card.parties} />}
              <p className="text-sm font-bold text-foreground">{card.title}</p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center">
                <label className={LABEL}>내 답안</label>
                <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">{text.length}자</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="답안을 적어 보세요 (저장되지 않습니다)"
                className={TEXTAREA}
              />
            </div>

            {!revealed ? (
              <div className="flex flex-wrap items-center gap-2">
                <button className={btn} disabled={pos === 0} onClick={prev}>← 이전 카드</button>
                <button className={`${primaryBtn} ml-auto`} onClick={() => setSession({ ...session, revealed: true })}>
                  정답 보기
                </button>
              </div>
            ) : (
              <>
                <div className={SECTION}>
                  <label className={LABEL}>정답</label>
                  <div className="record-note">
                    <AnswerTable card={card} />
                    {card.tailH && (
                      <div className="pt-2 space-y-1">
                        <p className={LABEL}>공통 청구취지(소송비용 등)</p>
                        <NoteHtml html={card.tailH} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={btn} disabled={pos === 0} onClick={prev}>← 이전 카드</button>
                  <span className="ml-auto" />
                  {MARKS.map((m) => (
                    <button
                      key={m.id}
                      className={marks[card.id] === m.id ? primaryBtn : btn}
                      onClick={() => grade(card, m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              </>
            )}
          </>
        )}
      </Frame>
    )
  }

  // ── 시작 화면 ─────────────────────────────────────────────
  const allExams = examChips.length > 0 && examChips.every((e) => exams.includes(e))
  const options = [...(wrongOnly ? [OPT_WRONG] : []), ...(shuffle ? [OPT_SHUFFLE] : [])]
  return (
    <Frame>
      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">문제 풀기</h2>
        <p className="text-sm text-muted-foreground">
          기출 카드를 보고 직접 써 본 뒤 정답과 비교해요. 필터를 고르지 않으면 전체입니다.
        </p>
      </div>

      <div className={SECTION}>
        <label className={LABEL}>과목 (복수 선택)</label>
        <FilterChips options={subjectOptions} selected={subjects} onChange={changeSubjects} />
      </div>

      <div className={SECTION}>
        <label className={LABEL}>시험 유형 (복수 선택)</label>
        <FilterChips
          options={KINDS}
          selected={kinds}
          onChange={setKinds}
          available={KINDS.filter((k) => subjectCards.some((c) => c.exam?.kind === k))}
        />
      </div>

      {examChips.length > 0 && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>회차 (복수 선택)</label>
            <button onClick={() => setExams(allExams ? [] : examChips)} className={smallBtn(allExams)}>
              전체
            </button>
          </div>
          <FilterChips options={examChips} selected={exams.filter((e) => examChips.includes(e))} onChange={setExams} />
        </div>
      )}

      <div className={SECTION}>
        <label className={LABEL}>옵션</label>
        <FilterChips
          options={[OPT_WRONG, OPT_SHUFFLE]}
          selected={options}
          onChange={(next) => {
            setWrongOnly(next.includes(OPT_WRONG))
            setShuffle(next.includes(OPT_SHUFFLE))
          }}
        />
      </div>

      <div className={`${RESULT_CARD} flex-wrap gap-2`}>
        <span className="text-muted-foreground">
          선택된 카드: <span className="text-foreground font-medium">{chosen.length}장</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          맞음 {stats.o} · 아쉬움 {stats.h} · 틀림 {stats.x} · 안 푼 {stats.none}
        </span>
      </div>

      <button className={START_BTN} disabled={chosen.length === 0} onClick={() => start(chosen)}>
        {chosen.length > 0 ? `풀기 시작 — ${chosen.length}장` : '조건에 맞는 카드가 없습니다'}
      </button>
    </Frame>
  )
}
