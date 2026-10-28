'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CaseIndex, IndexCard, IndexProblem, Problem } from '@/lib/caseStudy/types'
import { getAppMode } from '@/lib/appMode'
import { fetchCaseCard, fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import { answerTarget, mockValue, sortCards } from '@/lib/caseStudy/group'
import { FilterChips } from '@/components/filter-chips'
import { EXAM_MONTH_OPTIONS, examMonthLabel, type ExamMonthLabel } from '@/lib/questionSource'
import { CaseSolve } from '@/components/case-study/case-solve'
import { CaseErrorNotice } from '@/components/case-study/case-study-browse'
import {
  EXAM_SUBJECT, categoryLabel, examShort, examSubjectRank, examYear,
} from '@/components/case-study/case-index-view'

// 풀 수 있는 문항 하나. stub 은 답안이 있는 원본 문항(카드)으로 바꿔 한 번만 넣는다
interface Item {
  card: IndexCard
  p: IndexProblem
  kind: string // 색인에는 타입 밖의 '유사'도 온다
  year: string | null
  month: ExamMonthLabel | null // 모의 회차(6·8·10모). 모의가 아니거나 exam 에서 못 읽으면 null
  examSubject: string
}

// 시험 유형 — 값은 색인의 kind, 칩 글자는 선택형과 같은 문구('유사'는 사례에만 있다)
const KINDS = ['변시', '모의', '유사']
const KIND_LABEL: Record<string, string> = { 변시: '변호사시험', 모의: '모의고사', 유사: '유사 문제' }
const kindOf = (label: string) => KINDS.find((k) => KIND_LABEL[k] === label) ?? label
// 과목 칸 순서 — 이 탭만 선택형과 같게 민사법 → 형사법 → 공법(답안·목차와 회차별 정렬은 공법부터 그대로)
const GROUP_ORDER = ['민사법', '형사법', '공법']
const groupRank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length)
// 랜덤 출제 문항 수. 사례 한 문항이 길어 선택형(10~70)보다 훨씬 적게 둔다
const COUNT_OPTIONS = [1, 2, 3, 5]
type PickMode = '랜덤 출제' | '직접 선택'

// 모의 exam 은 '23.6'·'24.10' 처럼 '연.월'이다. 6·8·10 이 아니면 회차로 치지 않는다
function mockMonth(kind: string, exam: number | string): ExamMonthLabel | null {
  if (kind !== '모의') return null
  const m = Number(String(exam).split('.')[1])
  return m === 6 || m === 8 || m === 10 ? examMonthLabel(m) : null
}
const unitKey = (subject: string, category: string) => `${subject}|${category}`
const examSubjectOf = (subject: string) => EXAM_SUBJECT[subject] ?? subject
const coll = new Intl.Collator('ko', { numeric: true })
const kindRank = (k: string) => (k === '변시' ? 0 : k === '모의' ? 1 : 2)

// 시험 회차 → 시험 과목(공법 → 형사법 → 민사법) → 문 번호 → 소문항. 회차별 보기와 같은 순서다
function compareItems(a: Item, b: Item): number {
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    (a.kind === '변시' ? Number(a.p.exam) - Number(b.p.exam) : mockValue(b.p.exam) - mockValue(a.p.exam)) ||
    examSubjectRank(a.examSubject) - examSubjectRank(b.examSubject) ||
    coll.compare(a.p.qno, b.p.qno) ||
    coll.compare(a.p.sub ?? '', b.p.sub ?? '')
  )
}

function buildItems(index: CaseIndex): Item[] {
  const byId = new Map(index.cards.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: Item[] = []
  for (const c of sortCards(index.cards)) {
    for (const p of c.problems) {
      const t = answerTarget(c, p)
      if (seen.has(t.problem)) continue
      const card = byId.get(t.card)
      const target = card?.problems.find((x) => x.id === t.problem)
      if (!card || !target || target.stubFor) continue
      seen.add(t.problem)
      const kind = target.kind as string
      out.push({
        card, p: target, kind, year: examYear(kind, target.exam), month: mockMonth(kind, target.exam), examSubject: examSubjectOf(card.subject),
      })
    }
  }
  return out.sort(compareItems)
}

const SECTION = 'bg-card border border-border rounded-xl p-4 space-y-3'
const LABEL = 'text-xs font-medium text-muted-foreground'
const SMALL_BTN = 'text-[10px] px-2 py-0.5 rounded-full border transition-colors'
const smallBtn = (on: boolean) =>
  `${SMALL_BTN} ${on ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`

/**
 * 사례형 CBT 실전 — 선택형 CBT 실전(QuizFilter)과 같은 순서·문구의 필터(과목 / 시험 유형 / 모의고사 회차 / 연도 / 범위)로
 * 문항을 골라 풀이 화면으로 연다. 필터는 아무것도 고르지 않으면 전체다. 문항은 랜덤 출제(문항 수)나 목록에서 직접 고른다.
 * 선택형 필터는 선택형 문항에 묶여 있어 칩(FilterChips)과 같은 마크업으로 같은 모양을 만든다
 */
export function CaseCbt() {
  const mode = getAppMode()
  const [index, setIndex] = useState<CaseIndex | null | undefined>(undefined)
  const [indexError, setIndexError] = useState<unknown>(null)
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [months, setMonths] = useState<ExamMonthLabel[]>([])
  const [pickMode, setPickMode] = useState<PickMode>('랜덤 출제')
  const [count, setCount] = useState(1)
  const [years, setYears] = useState<string[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [solve, setSolve] = useState<{
    title: string; problems: Problem[]; notice?: string; targetMinutes: number | null; showTimer: boolean
  } | null>(null)
  // 목표 시간 — 고른 문항 배점 합 × 0.6분(변시 사례형 1점당 0.6분)을 제안하고, 직접 고치면 그 값을 쓴다
  const [customMinutes, setCustomMinutes] = useState<string | null>(null)
  const [useTimer, setUseTimer] = useState(true)
  // 랜덤 출제는 필터·문항 수가 바뀔 때 미리 뽑아 둔다(목표 시간 제안이 실제로 풀 문항을 보게). 시작하면 다시 뽑는다
  const [seed, setSeed] = useState(0)
  const [loading, setLoading] = useState(false)
  const [startError, setStartError] = useState('')
  const cache = useRef(new Map<string, Card | null>())

  useEffect(() => {
    fetchCaseIndex(mode).then(setIndex).catch(setIndexError)
  }, [mode])

  const items = useMemo(() => (index ? buildItems(index) : []), [index])

  // 과목: 시험 과목 묶음(민사법·형사법·공법) 아래에 그 묶음의 카드 과목. 세부 과목 순서는 진도별 과목 순서다
  const groups = useMemo(() => {
    const subjectsInOrder = [...new Set(sortCards(index?.cards ?? []).map((c) => c.subject))]
    const names = [...new Set(subjectsInOrder.map(examSubjectOf))].sort(
      (a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b)
    )
    return names.map((label) => ({ label, subjects: subjectsInOrder.filter((s) => examSubjectOf(s) === label) }))
  }, [index])

  // 범위(단원 = 카드 category): 과목마다 한 줄(과목을 안 골랐으면 전체 과목, 과목 칸 순서). 단원 순서는 진도별 목록 그대로,
  // 글자는 과목 접두어를 뗀다
  const unitRows = useMemo(() => {
    const ordered = sortCards(index?.cards ?? [])
    const all = groups.flatMap((g) => g.subjects)
    return all.filter((s) => subjects.length === 0 || subjects.includes(s)).map((s) => {
      const cats = [...new Set(ordered.filter((c) => c.subject === s).map((c) => c.category))]
      return { subject: s, options: cats.map((c) => ({ key: unitKey(s, c), label: categoryLabel(c, s) })) }
    })
  }, [index, subjects, groups])

  const kindOptions = useMemo(() => KINDS.filter((k) => items.some((it) => it.kind === k)), [items])
  const monthOptions = useMemo(
    () => EXAM_MONTH_OPTIONS.filter((m) => items.some((it) => it.month === m)),
    [items]
  )
  const yearOptions = useMemo(
    () => [...new Set(items.map((it) => it.year).filter((y): y is string => !!y))].sort((a, b) => Number(b) - Number(a)),
    [items]
  )

  const filtered = useMemo(
    () =>
      items.filter(
        (it) =>
          (subjects.length === 0 || subjects.includes(it.card.subject)) &&
          (kinds.length === 0 || kinds.includes(it.kind)) &&
          // 회차는 모의고사를 골랐을 때 모의 문항에만 건다. 월을 못 읽은 문항은 거르지 않는다(선택형과 같다)
          (!kinds.includes('모의') || months.length === 0 || it.kind !== '모의' || it.month === null || months.includes(it.month)) &&
          (years.length === 0 || (it.year !== null && years.includes(it.year))) &&
          (units.length === 0 ||
            units.includes(unitKey(it.card.subject, it.card.category)) ||
            // 고른 과목인데 그 과목에서 고른 범위가 없으면 그 과목 전체
            (subjects.includes(it.card.subject) && !units.some((u) => u.startsWith(`${it.card.subject}|`))))
      ),
    [items, subjects, kinds, months, years, units]
  )
  const chosenInList = filtered.filter((it) => picked.has(it.p.id))
  const allPicked = filtered.length > 0 && chosenInList.length === filtered.length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => new Set([...filtered].sort(() => Math.random() - 0.5).slice(0, count)), [filtered, count, seed])
  // 풀이 화면에는 목록 순서(회차·문 번호)로 넣는다
  const chosen = pickMode === '랜덤 출제' ? filtered.filter((it) => drawn.has(it)) : chosenInList
  // 배점이 없는 문항은 계산에서 뺀다. ×6÷10 으로 셈해 0.6 소수 오차로 1분이 더 올라가지 않게 한다
  const scoredPoints = chosen.reduce((n, it) => n + (it.p.points > 0 ? it.p.points : 0), 0)
  const unscored = chosen.filter((it) => !(it.p.points > 0)).length
  const suggestedMinutes = Math.ceil((scoredPoints * 6) / 10)
  const minutesText = customMinutes ?? (suggestedMinutes > 0 ? String(suggestedMinutes) : '')
  const targetMinutes = parseInt(minutesText, 10) > 0 ? parseInt(minutesText, 10) : null

  function changeSubjects(next: string[]) {
    setSubjects(next)
    // 뺀 과목의 범위 선택은 지운다
    setUnits((prev) => prev.filter((u) => next.includes(u.split('|')[0])))
  }

  function toggleGroup(groupSubjects: string[]) {
    const all = groupSubjects.every((s) => subjects.includes(s))
    changeSubjects(all ? subjects.filter((s) => !groupSubjects.includes(s)) : [...new Set([...subjects, ...groupSubjects])])
  }

  // 모의고사를 켜면 회차를 모두 켜고, 끄면 비운다(선택형과 같다)
  function changeKinds(next: string[]) {
    if (next.includes('모의') && !kinds.includes('모의')) setMonths(monthOptions)
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
      for (const it of filtered) {
        if (allPicked) next.delete(it.p.id)
        else next.add(it.p.id)
      }
      return next
    })
  }

  // 고른 문항이 든 카드를 받아(한 번 받은 것은 다시 쓰지 않는다) 회차·문 번호 순으로 풀이 화면에 넣는다
  async function start() {
    if (chosen.length === 0) return
    setStartError('')
    setLoading(true)
    try {
      for (const id of new Set(chosen.map((it) => it.card.id))) {
        if (!cache.current.has(id)) cache.current.set(id, await fetchCaseCard(mode, id))
      }
      const problems = chosen
        .map((it) => cache.current.get(it.card.id)?.problems.find((p) => p.id === it.p.id))
        .filter((p): p is Problem => !!p && !p.stubFor)
      const lost = chosen.length - problems.length
      if (problems.length === 0) setStartError('고른 문항을 카드에서 찾지 못했습니다')
      else {
        setSolve({
          title: `CBT 실전 · ${problems.length}문항`,
          problems,
          notice: lost > 0 ? `문항 ${lost}개를 카드에서 찾지 못해 뺐습니다` : undefined,
          targetMinutes: useTimer ? targetMinutes : null,
          showTimer: useTimer,
        })
        setSeed((n) => n + 1)
      }
    } catch (e) {
      setStartError(`문항을 불러오지 못했습니다: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  if (indexError) return <CaseErrorNotice error={indexError} />
  if (index === undefined) return <p className="text-center text-xs text-muted-foreground py-8 animate-pulse">불러오는 중…</p>
  if (index === null || items.length === 0) {
    return <p className="text-center text-xs text-muted-foreground py-8">아직 올라온 사례형 카드가 없습니다</p>
  }

  const allYearsSelected = yearOptions.length > 0 && yearOptions.every((y) => years.includes(y))
  const allMonthsSelected = monthOptions.length > 0 && monthOptions.every((m) => months.includes(m))
  const random = pickMode === '랜덤 출제'
  const startCount = chosen.length

  return (
    <div className="case-study space-y-5 max-w-2xl mx-auto">
      {solve && (
        <CaseSolve
          title={solve.title}
          problems={solve.problems}
          notice={solve.notice}
          initialTargetMinutes={solve.targetMinutes}
          showTimer={solve.showTimer}
          onClose={() => setSolve(null)}
        />
      )}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <p className="text-xs text-muted-foreground animate-pulse">문항을 불러오는 중…</p>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">CBT 실전 모드</h2>
        <p className="text-sm text-muted-foreground">
          사례형 문항을 무작위로 뽑거나 목록에서 골라 실전처럼 답안을 작성합니다. 필터를 고르지 않으면 전체입니다.
        </p>
      </div>

      {/* 과목 — 각 시험 과목 버튼 아래에 그 묶음의 과목 칩 */}
      <div className={SECTION}>
        <label className={LABEL}>과목</label>
        <div className={`grid gap-2 items-start ${groups.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {groups.map((g) => {
            const all = g.subjects.every((s) => subjects.includes(s))
            const some = g.subjects.some((s) => subjects.includes(s))
            return (
              <div key={g.label} className="space-y-2">
                <button
                  onClick={() => toggleGroup(g.subjects)}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    all
                      ? 'bg-primary text-primary-foreground border-primary'
                      : some
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  {g.label}
                </button>
                <FilterChips options={g.subjects} selected={subjects} onChange={changeSubjects} centered />
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
          available={kindOptions.map((k) => KIND_LABEL[k])}
        />
      </div>

      {/* 모의고사 회차 — '모의고사'를 고른 동안에만 보인다 */}
      {kinds.includes('모의') && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>모의고사 회차 (복수 선택)</label>
            <button onClick={() => setMonths(allMonthsSelected ? [] : monthOptions)} className={smallBtn(allMonthsSelected)}>
              전체
            </button>
          </div>
          <FilterChips options={[...EXAM_MONTH_OPTIONS]} selected={months} onChange={setMonths} available={monthOptions} />
        </div>
      )}

      {/* 연도 — '유사' 문항은 연도가 없어 연도를 고르면 빠진다 */}
      {yearOptions.length > 0 && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>연도 (복수 선택)</label>
            <div className="flex gap-1.5">
              {[1, 3, 5].map((n) => (
                <button key={n} onClick={() => setYears(yearOptions.slice(0, n))} className={smallBtn(false)}>
                  최근 {n}개년
                </button>
              ))}
              <button onClick={() => setYears(allYearsSelected ? [] : yearOptions)} className={smallBtn(allYearsSelected)}>
                전체
              </button>
            </div>
          </div>
          <FilterChips options={yearOptions} selected={years} onChange={setYears} />
        </div>
      )}

      {/* 범위 — 과목마다 단원 줄. 고른 과목에서 아무것도 안 고르면 그 과목 전체 */}
      {unitRows.length > 0 && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <label className={LABEL}>범위 (복수 선택)</label>
            <button onClick={() => setUnits([])} className={smallBtn(units.length === 0)}>
              전체
            </button>
          </div>
          <div className="space-y-2">
            {unitRows.map((row) => (
              <div key={row.subject} className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium">{row.subject}</p>
                <FilterChips
                  options={row.options.map((o) => o.label)}
                  selected={row.options.filter((o) => units.includes(o.key)).map((o) => o.label)}
                  onChange={(labels) =>
                    setUnits((prev) => [
                      ...prev.filter((u) => !u.startsWith(`${row.subject}|`)),
                      ...row.options.filter((o) => labels.includes(o.label)).map((o) => o.key),
                    ])
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* 문항 수 — 랜덤 출제. 필터 결과보다 많은 수는 고를 수 없다 */}
      {random && (
        <div className={SECTION}>
          <label className={LABEL}>문항 수</label>
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
                {n}문항
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 문항 목록 — 직접 선택 */}
      {!random && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <label className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted text-xs text-foreground cursor-pointer">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={filtered.length === 0} className="accent-primary" />
            <span className="font-medium">전체 선택</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {chosenInList.length} / {filtered.length}문항
            </span>
          </label>
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">조건에 맞는 문항이 없습니다</p>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto divide-y divide-border">
              {filtered.map((it) => (
                <li key={it.p.id}>
                  <label className="flex items-start gap-2 px-4 py-2 cursor-pointer hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={picked.has(it.p.id)}
                      onChange={() => togglePick(it.p.id)}
                      className="mt-0.5 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-foreground">{it.card.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {it.kind === '유사' ? '유사' : examShort(it.p.kind, it.p.exam)} · {[it.p.qno, it.p.sub].filter(Boolean).join(' ')} ·{' '}
                        {it.card.subject} · {it.card.id}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-xs font-semibold text-primary">{it.p.points}점</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 타이머 — 목표 시간은 고른 문항 배점 합 × 0.6분을 제안한다. 시간이 지나도 자동 제출하지 않는다 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useTimer}
              onChange={(e) => setUseTimer(e.target.checked)}
              className="accent-[oklch(0.65_0.2_290)] w-4 h-4"
            />
            <span className="text-sm text-foreground">타이머 사용{targetMinutes !== null && ` (${targetMinutes}분)`}</span>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            목표
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={minutesText}
              disabled={!useTimer}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="w-16 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground disabled:opacity-40"
            />
            분
          </label>
        </div>
        {useTimer && (
          <p className="text-xs text-muted-foreground">
            {customMinutes !== null
              ? '직접 정한 목표 시간입니다'
              : scoredPoints > 0
                ? `고른 문항 배점 ${scoredPoints}점 × 0.6분`
                : '문항을 고르면 배점에 맞춰 목표 시간을 제안합니다'}
            {unscored > 0 && ` · 배점이 없는 문항 ${unscored}개는 계산에서 뺐습니다`}
          </p>
        )}
      </div>

      {/* 결과 */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          필터 결과: <span className="text-foreground font-medium">{filtered.length}문항</span>
        </span>
        {random && filtered.length < count && filtered.length > 0 && (
          <span className="text-yellow-400 text-xs">전체 {filtered.length}문항만 출제</span>
        )}
      </div>

      {startError && <p className="text-xs text-red-400">{startError}</p>}
      <button
        onClick={start}
        disabled={startCount === 0 || loading}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {filtered.length === 0
          ? '조건에 맞는 문항이 없습니다'
          : startCount === 0
            ? '풀 문항을 골라 주세요'
            : `CBT 시작 — ${startCount}문항`}
      </button>
    </div>
  )
}
