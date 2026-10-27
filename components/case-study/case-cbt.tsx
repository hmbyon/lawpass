'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CaseIndex, IndexCard, IndexProblem, Problem } from '@/lib/caseStudy/types'
import { getAppMode } from '@/lib/appMode'
import { fetchCaseCard, fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import { answerTarget, mockValue, sortCards } from '@/lib/caseStudy/group'
import { FilterChips } from '@/components/filter-chips'
import { CaseSolve } from '@/components/case-study/case-solve'
import { CaseErrorNotice } from '@/components/case-study/case-study-browse'
import {
  EXAM_SUBJECT, EXAM_SUBJECT_ORDER, categoryLabel, examShort, examSubjectRank, examYear,
} from '@/components/case-study/case-index-view'

// 풀 수 있는 문항 하나. stub 은 답안이 있는 원본 문항(카드)으로 바꿔 한 번만 넣는다
interface Item {
  card: IndexCard
  p: IndexProblem
  kind: string // 색인에는 타입 밖의 '유사'도 온다
  year: string | null
  examSubject: string
}

const KINDS = ['변시', '모의', '유사']
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
      out.push({ card, p: target, kind, year: examYear(kind, target.exam), examSubject: examSubjectOf(card.subject) })
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
 * 사례형 CBT 실전 — 선택형 CBT 실전과 같은 필터(과목 / 시험 유형 / 연도 / 범위)로 문항을 골라 풀이 화면으로 연다.
 * 필터는 아무것도 고르지 않으면 전체다. 선택형 필터(QuizFilter)는 선택형 문항에 묶여 있어 칩(FilterChips)과
 * 같은 마크업으로 같은 모양을 만든다
 */
export function CaseCbt() {
  const mode = getAppMode()
  const [index, setIndex] = useState<CaseIndex | null | undefined>(undefined)
  const [indexError, setIndexError] = useState<unknown>(null)
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [years, setYears] = useState<string[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [solve, setSolve] = useState<{ title: string; problems: Problem[]; notice?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [startError, setStartError] = useState('')
  const cache = useRef(new Map<string, Card | null>())

  useEffect(() => {
    fetchCaseIndex(mode).then(setIndex).catch(setIndexError)
  }, [mode])

  const items = useMemo(() => (index ? buildItems(index) : []), [index])

  // 과목: 시험 과목 묶음(공법·형사법·민사법) 아래에 그 묶음의 카드 과목. 순서는 진도별 과목 순서다
  const groups = useMemo(() => {
    const subjectsInOrder = [...new Set(sortCards(index?.cards ?? []).map((c) => c.subject))]
    const names = [...new Set(subjectsInOrder.map(examSubjectOf))].sort(
      (a, b) => examSubjectRank(a) - examSubjectRank(b) || a.localeCompare(b)
    )
    return names.map((label) => ({ label, subjects: subjectsInOrder.filter((s) => examSubjectOf(s) === label) }))
  }, [index])

  // 범위(단원 = 카드 category): 고른 과목마다 한 줄. 순서는 진도별 목록 그대로, 글자는 과목 접두어를 뗀다
  const unitRows = useMemo(() => {
    const ordered = sortCards(index?.cards ?? [])
    return subjects.map((s) => {
      const cats = [...new Set(ordered.filter((c) => c.subject === s).map((c) => c.category))]
      return { subject: s, options: cats.map((c) => ({ key: unitKey(s, c), label: categoryLabel(c, s) })) }
    })
  }, [index, subjects])

  const kindOptions = useMemo(() => KINDS.filter((k) => items.some((it) => it.kind === k)), [items])
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
          (years.length === 0 || (it.year !== null && years.includes(it.year))) &&
          (units.length === 0 ||
            !units.some((u) => u.startsWith(`${it.card.subject}|`)) || // 이 과목에서 고른 범위가 없으면 그 과목 전체
            units.includes(unitKey(it.card.subject, it.card.category)))
      ),
    [items, subjects, kinds, years, units]
  )
  const chosen = filtered.filter((it) => picked.has(it.p.id))
  const allPicked = filtered.length > 0 && chosen.length === filtered.length

  function changeSubjects(next: string[]) {
    setSubjects(next)
    // 뺀 과목의 범위 선택은 지운다
    setUnits((prev) => prev.filter((u) => next.includes(u.split('|')[0])))
  }

  function toggleGroup(groupSubjects: string[]) {
    const all = groupSubjects.every((s) => subjects.includes(s))
    changeSubjects(all ? subjects.filter((s) => !groupSubjects.includes(s)) : [...new Set([...subjects, ...groupSubjects])])
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
      else
        setSolve({
          title: `CBT 실전 · ${problems.length}문항`,
          problems,
          notice: lost > 0 ? `문항 ${lost}개를 카드에서 찾지 못해 뺐습니다` : undefined,
        })
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

  return (
    <div className="case-study space-y-5 max-w-2xl mx-auto">
      {solve && <CaseSolve title={solve.title} problems={solve.problems} notice={solve.notice} onClose={() => setSolve(null)} />}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <p className="text-xs text-muted-foreground animate-pulse">문항을 불러오는 중…</p>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">CBT 실전 모드</h2>
        <p className="text-sm text-muted-foreground">문항을 골라 실전처럼 답안을 작성합니다. 필터를 고르지 않으면 전체입니다.</p>
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
        <FilterChips options={KINDS} selected={kinds} onChange={setKinds} available={kindOptions} />
      </div>

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

      {/* 범위 — 고른 과목마다 단원 줄. 한 과목에서 아무것도 안 고르면 그 과목 전체 */}
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

      {/* 문항 목록 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <label className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted text-xs text-foreground cursor-pointer">
          <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={filtered.length === 0} className="accent-primary" />
          <span className="font-medium">전체 선택</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {chosen.length} / {filtered.length}문항
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

      {startError && <p className="text-xs text-red-400">{startError}</p>}
      <button
        onClick={start}
        disabled={chosen.length === 0 || loading}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {chosen.length === 0 ? '풀 문항을 골라 주세요' : `${chosen.length}문항 시작`}
      </button>
    </div>
  )
}
