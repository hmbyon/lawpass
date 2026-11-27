'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchAllRecordCards } from '@/lib/firebaseServices/caseStudy'
import { fetchDrillResults, saveDrillResult } from '@/lib/firebaseServices/recordDrill'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import { cardsWithSubject, type RecordCard } from '@/lib/record/cardStorage'
import {
  applyResult, filterByCbt, orderCards, recentYears, selectableOf, sortCardsForList, subjectGroupsOfCards,
  unsolvedCards, yearOptionsOf, type DrillMark, type DrillResults,
} from '@/lib/record/drillProgress'
import { EXAM_MONTH_OPTIONS, type ExamMonthLabel } from '@/lib/questionSource'
import { FilterChips } from '@/components/filter-chips'
import { NoteTable, type TableBlock } from '@/components/record/notes-viewer'

// 시험 유형 — case-cbt.tsx 의 KINDS·KIND_LABEL·kindOf 와 같다(기록형에는 '유사'가 없다)
const KINDS = ['변시', '모의']
const KIND_LABEL: Record<string, string> = { 변시: '변호사시험', 모의: '모의고사' }
const kindOf = (label: string) => KINDS.find((k) => KIND_LABEL[k] === label) ?? label
// 랜덤 출제 카드 수 — case-cbt.tsx 의 COUNT_OPTIONS 와 같다
const COUNT_OPTIONS = [1, 2, 3, 5]
type PickMode = '랜덤 출제' | '직접 선택'
const MARKS: { id: DrillMark; label: string }[] = [
  { id: 'o', label: '맞음' },
  { id: 'h', label: '아쉬움' },
  { id: 'x', label: '틀림' },
]

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
export function DrillView({
  isAdmin,
  openRequest,
  onOpenRequestDone,
}: {
  isAdmin: boolean
  // 오답노트의 '이 카드 풀어 보기' — 그 카드 한 장으로 풀이를 연다(nonce 가 바뀔 때마다)
  openRequest?: { cardId: string; nonce: number } | null
  onOpenRequestDone?: () => void
}) {
  const [cards, setCards] = useState<RecordCard[] | undefined>(undefined) // undefined = 불러오는 중
  const [loadError, setLoadError] = useState('')
  const [results, setResults] = useState<DrillResults>({})
  const [saveError, setSaveError] = useState('')

  // 시작 화면 조건 — 사례형 CBT 실전과 같은 필터(과목 / 시험 유형 / 모의고사 회차 / 연도)·출제 방식
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [months, setMonths] = useState<ExamMonthLabel[]>([])
  const [years, setYears] = useState<string[]>([])
  const [pickMode, setPickMode] = useState<PickMode>('랜덤 출제')
  const [count, setCount] = useState(1)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // 랜덤 출제는 필터·카드 수가 바뀔 때 미리 뽑아 둔다. 시작하면 다시 뽑는다
  const [seed, setSeed] = useState(() => Date.now())
  // 안 푼 카드만 풀기 — 풀이 결과 문서에 결과가 있으면 푼 카드. 못 읽으면 체크박스만 막는다
  const [onlyUnsolved, setOnlyUnsolved] = useState(false)
  const [solvedError, setSolvedError] = useState(false)

  // 풀이 중인 묶음 (카드 id 순서·위치·정답 펼침·이번 묶음 채점)
  const [session, setSession] = useState<{ ids: string[]; pos: number; revealed: boolean; marks: Record<string, DrillMark> } | null>(null)
  const [text, setText] = useState('')

  const load = useCallback(() => {
    setCards(undefined)
    setLoadError('')
    setSolvedError(false)
    const mode = getAppMode()
    const uid = auth.currentUser?.uid
    if (uid) {
      fetchDrillResults(uid, mode)
        .then(setResults)
        .catch(() => setSolvedError(true))
    } else setSolvedError(true)
    fetchAllRecordCards(mode)
      .then((docs) => setCards(cardsWithSubject(docs)))
      .catch((e: Error) => setLoadError(e.message || '불러오지 못했습니다'))
  }, [])
  useEffect(load, [load])

  const all = useMemo(() => sortCardsForList(cards ?? []), [cards])
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all])
  const groups = useMemo(() => subjectGroupsOfCards(all), [all])
  const allSubjects = useMemo(() => groups.flatMap((g) => g.subjects), [groups])
  const selectable = useMemo(() => selectableOf(all, subjects), [all, subjects])
  const yearOptions = useMemo(() => yearOptionsOf(all), [all])
  const filteredAll = useMemo(() => filterByCbt(all, { subjects, kinds, months, years }), [all, subjects, kinds, months, years])
  const unsolvedCount = unsolvedCards(filteredAll, results).length
  const filtered = useMemo(
    () => (onlyUnsolved ? unsolvedCards(filteredAll, results) : filteredAll),
    [filteredAll, onlyUnsolved, results]
  )
  const chosenInList = filtered.filter((c) => picked.has(c.id))
  const allPicked = filtered.length > 0 && chosenInList.length === filtered.length
  const drawn = useMemo(() => new Set(orderCards(filtered, true, seed).slice(0, count)), [filtered, count, seed])
  // 풀이 화면에는 목록 순서(회차·과목)로 넣는다
  const chosen = pickMode === '랜덤 출제' ? filtered.filter((c) => drawn.has(c)) : chosenInList

  function changeSubjects(next: string[]) {
    setSubjects(next)
    // 과목을 모두 빼면 나머지 선택도 비운다(CBT 와 같다)
    if (next.length === 0) {
      setKinds([])
      setMonths([])
      setYears([])
    }
  }
  function toggleGroup(groupSubjects: string[]) {
    const every = groupSubjects.every((s) => subjects.includes(s))
    changeSubjects(every ? subjects.filter((s) => !groupSubjects.includes(s)) : [...new Set([...subjects, ...groupSubjects])])
  }
  // 모의고사를 켜면 회차를 모두 켜고, 끄면 비운다(CBT 와 같다)
  function changeKinds(next: string[]) {
    if (next.includes('모의') && !kinds.includes('모의')) setMonths(selectable.months)
    else if (!next.includes('모의')) setMonths([])
    setKinds(next)
  }
  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setPicked((prev) => {
      const next = new Set(prev)
      for (const c of filtered) {
        if (allPicked) next.delete(c.id)
        else next.add(c.id)
      }
      return next
    })
  }

  // 목록 순서 그대로 풀이 화면에 넣는다
  function start(list: RecordCard[]) {
    if (list.length === 0) return
    setSession({ ids: list.map((c) => c.id), pos: 0, revealed: false, marks: {} })
    setText('')
    setSeed((n) => n + 1)
    window.scrollTo({ top: 0 })
  }
  // 카드 id 하나로 풀이를 시작한다. 카드를 다 읽은 뒤에 연다
  const requestNonce = openRequest?.nonce
  useEffect(() => {
    if (!openRequest || !cards) return
    const card = byId.get(openRequest.cardId)
    if (card) start([card])
    onOpenRequestDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce, cards])

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

  // ── 시작 화면 — 사례형 CBT 실전(case-cbt.tsx)과 같은 구조·문구 ─────────
  const allYearsSelected = selectable.years.length > 0 && selectable.years.every((y) => years.includes(y))
  const allMonthsSelected = selectable.months.length > 0 && selectable.months.every((m) => months.includes(m))
  const random = pickMode === '랜덤 출제'
  const startCount = chosen.length
  return (
    <Frame>
      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">문제 풀기</h2>
        <p className="text-sm text-muted-foreground">
          기록형 카드를 무작위로 뽑거나 목록에서 골라 직접 써 본 뒤 정답과 비교합니다. 필터를 고르지 않으면 전체입니다.
        </p>
      </div>

      {/* 과목 — 각 시험 과목 버튼 아래에 그 묶음의 과목 칩 */}
      <div className={SECTION}>
        <label className={LABEL}>과목</label>
        <div className={`grid gap-2 items-start ${groups.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {groups.map((g) => {
            const every = g.subjects.every((s) => subjects.includes(s))
            const some = g.subjects.some((s) => subjects.includes(s))
            return (
              <div key={g.label} className="space-y-2">
                <button
                  onClick={() => toggleGroup(g.subjects)}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    every
                      ? 'bg-primary text-primary-foreground border-primary'
                      : some
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  {g.label}
                </button>
                <FilterChips
                  options={g.subjects}
                  selected={subjects}
                  onChange={(next) => changeSubjects(allSubjects.filter((s) => next.includes(s)))}
                  centered
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* 시험 유형 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <label className={LABEL}>시험 유형 (복수 선택)</label>
        <FilterChips
          options={KINDS.map((k) => KIND_LABEL[k])}
          selected={kinds.map((k) => KIND_LABEL[k])}
          onChange={(labels) => changeKinds(labels.map(kindOf))}
          available={selectable.kinds.map((k) => KIND_LABEL[k])}
        />
      </div>

      {/* 모의고사 회차 — '모의고사'를 고른 동안에만 보인다 */}
      {kinds.includes('모의') && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>모의고사 회차 (복수 선택)</label>
            <button onClick={() => setMonths(allMonthsSelected ? [] : selectable.months)} className={smallBtn(allMonthsSelected)}>
              전체
            </button>
          </div>
          <FilterChips options={[...EXAM_MONTH_OPTIONS]} selected={months} onChange={setMonths} available={selectable.months} />
        </div>
      )}

      {/* 연도 — 연도를 못 읽은 카드는 연도를 고르면 빠진다 */}
      {yearOptions.length > 0 && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>연도 (복수 선택)</label>
            <div className="flex gap-1.5">
              {[1, 3, 5].map((n) => (
                <button key={n} onClick={() => setYears(recentYears(yearOptions, selectable.years, n))} className={smallBtn(false)}>
                  최근 {n}개년
                </button>
              ))}
              <button onClick={() => setYears(allYearsSelected ? [] : selectable.years)} className={smallBtn(allYearsSelected)}>
                전체
              </button>
            </div>
          </div>
          <FilterChips options={yearOptions} selected={years} onChange={setYears} available={selectable.years} />
        </div>
      )}

      {/* 풀이 기록 — CBT 와 같은 카드 */}
      <div className="bg-card border border-border rounded-xl p-4">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyUnsolved}
              onChange={(e) => setOnlyUnsolved(e.target.checked)}
              disabled={solvedError}
              className="accent-[oklch(0.65_0.2_290)] w-3.5 h-3.5"
            />
            <span className="text-sm text-foreground">안 푼 카드만 풀기</span>
          </span>
          <span className="text-xs text-muted-foreground">
            지금 조건에서 안 푼 카드 <span className="text-foreground font-medium">{unsolvedCount}</span>
            /{filteredAll.length}장
          </span>
        </label>
        {solvedError ? (
          <p className="mt-1.5 text-xs text-muted-foreground">풀이 기록을 불러오지 못했습니다</p>
        ) : (
          onlyUnsolved && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              한 번이라도 채점한 카드는 빠지고, 한 번도 안 푼 카드만 나와요.
            </p>
          )
        )}
      </div>

      {/* 출제 방식 — 필터 결과에서 무작위로 뽑거나 목록에서 직접 고른다 */}
      <div className={SECTION}>
        <label className={LABEL}>출제 방식</label>
        <FilterChips<PickMode>
          options={['랜덤 출제', '직접 선택']}
          selected={[pickMode]}
          single
          onChange={(m) => setPickMode(m[0] ?? pickMode)}
        />
      </div>

      {/* 카드 수 — 랜덤 출제. 필터 결과보다 많은 수는 고를 수 없다 */}
      {random && (
        <div className={SECTION}>
          <label className={LABEL}>카드 수</label>
          <div className="grid grid-cols-4 gap-2">
            {COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                disabled={n > filtered.length}
                className={`py-2 rounded-lg text-sm font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  count === n
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
                }`}
              >
                {n}장
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 카드 목록 — 직접 선택 */}
      {!random && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <label className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted text-xs text-foreground cursor-pointer">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={filtered.length === 0} className="accent-primary" />
            <span className="font-medium">전체 선택</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {chosenInList.length} / {filtered.length}장
            </span>
          </label>
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">조건에 맞는 카드가 없습니다</p>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto divide-y divide-border">
              {filtered.map((c) => (
                <li key={c.id}>
                  <label className="flex items-start gap-2 px-4 py-2 cursor-pointer hover:bg-muted/50">
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} className="mt-0.5 accent-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-foreground">{c.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {c.subject ? `${c.subject} · ${c.label}` : c.label}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 결과 */}
      <div className={RESULT_CARD}>
        <span className="text-muted-foreground">
          필터 결과: <span className="text-foreground font-medium">{filtered.length}장</span>
        </span>
        {random && filtered.length < count && filtered.length > 0 && (
          <span className="text-yellow-400 text-xs">전체 {filtered.length}장만 출제</span>
        )}
      </div>

      <button className={START_BTN} disabled={subjects.length === 0 || startCount === 0} onClick={() => start(chosen)}>
        {subjects.length === 0
          ? '과목을 선택해주세요'
          : filtered.length === 0
            ? '조건에 맞는 카드가 없습니다'
            : startCount === 0
              ? '풀 카드를 골라 주세요'
              : `풀기 시작 — ${startCount}장`}
      </button>
    </Frame>
  )
}
