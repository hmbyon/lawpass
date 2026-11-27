'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchAllRecordCards } from '@/lib/firebaseServices/caseStudy'
import { fetchDrillResults } from '@/lib/firebaseServices/recordDrill'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import { cardsWithSubject, type RecordCard } from '@/lib/record/cardStorage'
import { subjectsOfCards, type DrillResults } from '@/lib/record/drillProgress'
import { filterRecordMisses, recordMisses, sortRecordMisses, type MissPeriod, type MissSort, type RecordMiss } from '@/lib/record/missView'
import { missDate } from '@/lib/caseStudy/missView'
import { FilterChips } from '@/components/filter-chips'
import { VERDICT } from '@/components/case-study/case-miss-shared'
import { NoteTable, type TableBlock } from '@/components/record/notes-viewer'

/**
 * 기록형 오답노트 — 문제 풀기에서 한 번이라도 틀림·아쉬움으로 채점한 카드를 모아 보여 준다.
 * 사례형 오답노트(components/case-study/case-misses)와 같은 구조·문구. 읽기 전용이고 새로 저장하지 않는다.
 * 탭을 처음 열 때와 '새로고침'을 누를 때만 읽는다
 */

// 칩 글자 → 값. 정렬·기간은 case-misses.tsx 의 SORT_OF·PERIOD_OF·PILL 과 같다(그쪽은 export 되지 않는다)
const KIND_CHIPS = ['변시', '모의']
const SORT_OF: Record<string, MissSort> = { '많이 틀린 순': 'count', '최근 빠진 순': 'recent' }
const SORT_CHIPS = Object.keys(SORT_OF)
const PERIOD_OF: Record<string, MissPeriod> = { '7일': 7, '30일': 30, 전체: 'all' }
const PERIOD_CHIPS = Object.keys(PERIOD_OF)
const PILL = 'min-h-8 rounded-lg border px-3 text-xs transition-colors'

const cardLabel = (c: RecordCard) => (c.subject ? `${c.subject} · ${c.label}` : c.label)

// 마지막 결과 — 사례형 VERDICT 색과 같은 모양
function LastMark({ m }: { m: RecordMiss }) {
  if (m.recentOk) return <span className="font-semibold text-emerald-600 dark:text-emerald-400">최근 ✓</span>
  return m.last === 'x' ? (
    <span className={`font-semibold ${VERDICT.missing.cls}`}>✕ 틀림</span>
  ) : (
    <span className={`font-semibold ${VERDICT.partial.cls}`}>△ 아쉬움</span>
  )
}

// 정답 표 — 정리본 표(record-note + NoteTable) 그대로
function AnswerTable({ card }: { card: RecordCard }) {
  const block = useMemo<TableBlock>(() => ({ t: 'table', rows: card.rows }), [card])
  return <NoteTable b={block} />
}

export function RecordMisses({ onOpenCard }: { onOpenCard: (cardId: string) => void }) {
  const [cards, setCards] = useState<RecordCard[] | null>(null)
  const [results, setResults] = useState<DrillResults>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [sortChip, setSortChip] = useState(SORT_CHIPS[0])
  const [periodChip, setPeriodChip] = useState('전체')
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    const mode = getAppMode()
    const uid = auth.currentUser?.uid
    Promise.all([fetchAllRecordCards(mode), uid ? fetchDrillResults(uid, mode) : Promise.resolve({} as DrillResults)])
      .then(([docs, res]) => {
        setCards(cardsWithSubject(docs))
        setResults(res)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  const items = useMemo(() => recordMisses(cards ?? [], results), [cards, results])
  const subjectChips = useMemo(() => subjectsOfCards(items.map((m) => m.card)), [items])
  const shown = useMemo(
    () => sortRecordMisses(filterRecordMisses(items, { subjects, kinds, period: PERIOD_OF[periodChip] }), SORT_OF[sortChip]),
    [items, subjects, kinds, periodChip, sortChip]
  )
  const recentOk = items.filter((m) => m.recentOk).length
  const attempts = Object.keys(results).length

  const opened = openId ? items.find((m) => m.card.id === openId) : null
  if (opened) {
    const c = opened.card
    return (
      <div className="space-y-4">
        <button onClick={() => setOpenId(null)} className="min-h-8 text-xs text-muted-foreground hover:text-foreground">← 오답노트 목록</button>
        <article className="case-study space-y-3 rounded-xl border border-border bg-card p-4">
          <header className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">{cardLabel(c)}</p>
              <h3 className="break-keep text-base font-semibold text-foreground">{c.title}</h3>
              <p className="text-xs text-muted-foreground">
                틀린 횟수 {opened.wrongCount}번 · 채점 {opened.tries}번 (틀림 {opened.wrong} · 아쉬움 {opened.meh})
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs">
                <LastMark m={opened} />
                <span className="text-muted-foreground tabular-nums">{missDate(opened.at)}</span>
              </p>
            </div>
          </header>
          {c.parties && <div className="record-note text-sm" dangerouslySetInnerHTML={{ __html: sanitizeNote(c.parties) }} />}
          <div className="border-t border-border pt-2">
            <div className="record-note">
              <AnswerTable card={c} />
              {c.tailH && (
                <div className="pt-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">공통 청구취지(소송비용 등)</p>
                  <div className="text-sm" dangerouslySetInnerHTML={{ __html: sanitizeNote(c.tailH) }} />
                </div>
              )}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <button onClick={() => onOpenCard(c.id)} className="ml-auto min-h-8 text-xs text-primary hover:underline">이 카드 풀어 보기</button>
            </p>
          </div>
        </article>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">
          {cards ? `오답 카드 ${items.length}장 · 최근 ✓ ${recentOk}장` : '오답노트'}
        </p>
        <button onClick={reload} disabled={loading} className={`${PILL} ml-auto border-border text-muted-foreground disabled:opacity-40`}>
          새로고침
        </button>
      </div>

      {loading && !cards && <p className="py-8 text-center text-xs text-muted-foreground animate-pulse">불러오는 중…</p>}
      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          {error}
          <button onClick={reload} className="min-h-8 px-1 text-primary hover:underline">다시 시도</button>
        </div>
      )}

      {cards && (
        <>
          {loading && <p className="text-xs text-muted-foreground animate-pulse">다시 불러오는 중…</p>}

          {/* 필터 — 사례형 오답노트와 같은 카드·칩. 아무것도 안 고르면 전체 */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <FilterChips options={subjectChips} selected={subjects} onChange={setSubjects} />
            <FilterChips options={KIND_CHIPS} selected={kinds} onChange={setKinds} />
            <div className="flex flex-wrap items-center gap-2">
              <FilterChips options={SORT_CHIPS} selected={[sortChip]} onChange={(v) => setSortChip(v[0] ?? sortChip)} single />
              <span className="h-4 w-px bg-border" />
              <FilterChips options={PERIOD_CHIPS} selected={[periodChip]} onChange={(v) => setPeriodChip(v[0] ?? periodChip)} single />
            </div>
          </div>

          <p className="text-xs text-muted-foreground px-1">
            {shown.length}장 표시 (전체 {items.length}장)
          </p>

          {attempts === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              오답노트가 없습니다. 문제 풀기에서 카드를 풀고 채점해 보세요.
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">틀린 카드가 없습니다.</div>
          ) : shown.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">조건에 맞는 항목이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {shown.map((m) => (
                <div
                  key={m.card.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(m.card.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenId(m.card.id)}
                  className="bg-card border border-border rounded-xl p-4 cursor-pointer transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{m.card.subject}</span>
                        <span className="text-xs text-muted-foreground">{m.card.label}</span>
                      </div>
                      <p className="break-keep text-sm text-foreground">{m.card.title}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">틀린 횟수 {m.wrongCount}번</span>
                        <LastMark m={m} />
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">{missDate(m.at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
