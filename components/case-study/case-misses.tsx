'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchSubmittedCaseAttempts } from '@/lib/firebaseServices/caseAttempts'
import { fetchCaseCard } from '@/lib/firebaseServices/caseStudy'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'
import { aggregateMisses, cardIdsOf, missTree, type MissItem, type MissKind, type MissPeriod, type MissResult, type MissSort } from '@/lib/caseStudy/misses'
import {
  DEFAULT_MISS_FILTER, MISS_KIND_LABEL, applyMissFilter, missDate, missReadingOrder, readingProgress, stepReading,
} from '@/lib/caseStudy/missView'
import type { Card } from '@/lib/caseStudy/types'
import { FilterChips } from '@/components/filter-chips'

/**
 * 사례형 오답노트 — 제출한 풀이의 조문 점검·AI 점검에서 빠진 항목을 모아 보여 준다.
 * 읽기 전용: Firestore 에 쓰지 않고 AI 를 부르지 않는다. 탭을 처음 열 때와 '새로고침'을 누를 때만 읽는다
 */

type Loaded = { result: MissResult; attempts: number; aiUsed: boolean }

// 칩 글자 → 값. 과목 칩은 선택형 오답노트와 같은 7개·같은 문구이고, 카드의 과목 값(민소·형소)으로 바꿔 거른다
const SUBJECT_OF: Record<string, string> = {
  민법: '민법', 민사소송법: '민소', 상법: '상법', 형법: '형법', 형사소송법: '형소', 헌법: '헌법', 행정법: '행정법',
}
const SUBJECT_CHIPS = Object.keys(SUBJECT_OF)
const KIND_OF: Record<string, MissKind> = { 조문: 'statute', '판례 취지': 'case', 결론: 'res' }
const KIND_CHIPS = Object.keys(KIND_OF)
const SORT_OF: Record<string, MissSort> = { '최근 빠진 순': 'recent', '많이 빠진 순': 'count' }
const SORT_CHIPS = Object.keys(SORT_OF)
const PERIOD_OF: Record<string, MissPeriod> = { '7일': 7, '30일': 30, 전체: 'all' }
const PERIOD_CHIPS = Object.keys(PERIOD_OF)
const VERDICT = { missing: { sym: '✕', word: '없음', cls: 'text-red-500' }, partial: { sym: '△', word: '부분', cls: 'text-amber-500' } }
const KIND_CLS: Record<MissKind, string> = {
  statute: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  case: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  res: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}
const PILL = 'min-h-8 rounded-lg border px-3 text-xs transition-colors'

async function load(): Promise<Loaded> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('로그인한 뒤에 볼 수 있습니다.')
  const mode = getAppMode()
  const r = await fetchSubmittedCaseAttempts(uid, mode)
  if (!r.ok) throw new Error(r.message)
  let cards: Card[]
  try {
    cards = (await Promise.all(cardIdsOf(r.attempts).map((id) => fetchCaseCard(mode, id)))).filter((c): c is Card => !!c)
  } catch {
    throw new Error('카드를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
  }
  return {
    result: aggregateMisses(r.attempts, cards, sanitizeCaseHtml),
    attempts: r.attempts.length,
    aiUsed: r.attempts.some((a) => Object.keys(a.aiChecks ?? {}).length > 0),
  }
}

export function CaseMisses({ onOpenCard }: { onOpenCard: (cardId: string, problemId: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [sortChip, setSortChip] = useState(SORT_CHIPS[0])
  const [periodChip, setPeriodChip] = useState('전체')
  const [reading, setReading] = useState<number | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    load()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  const items = useMemo(() => data?.result.items ?? [], [data])
  // 종류·기간·정렬은 applyMissFilter(filterMisses·sortMisses). 과목은 복수 선택이라 여기서 고른 과목 목록으로 거른다
  const shown = useMemo(() => {
    const f = { ...DEFAULT_MISS_FILTER, kinds: kinds.map((k) => KIND_OF[k]), period: PERIOD_OF[periodChip], sort: SORT_OF[sortChip] }
    const picked = new Set(subjects.map((s) => SUBJECT_OF[s]))
    const sorted = applyMissFilter(items, f, {}).filter((x) => picked.size === 0 || picked.has(x.subject))
    return missReadingOrder(sorted)
  }, [items, subjects, kinds, periodChip, sortChip])
  const tree = useMemo(() => missTree(shown), [shown])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">
          {data ? `빠진 항목 ${items.length}개 · 해결 ${data.result.resolved}개` : '오답노트'}
        </p>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setReading(0)} disabled={shown.length === 0} className={`${PILL} border-border text-foreground disabled:opacity-40`}>
            시험 전날 보기
          </button>
          <button onClick={reload} disabled={loading} className={`${PILL} border-border text-muted-foreground disabled:opacity-40`}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data && <p className="py-8 text-center text-xs text-muted-foreground animate-pulse">불러오는 중…</p>}
      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          {error}
          <button onClick={reload} className="min-h-8 px-1 text-primary hover:underline">다시 시도</button>
        </div>
      )}

      {data && (
        <>
          {!data.aiUsed && data.attempts > 0 && (
            <p className="text-xs text-muted-foreground">판례 취지·결론은 제출 후 AI 점검을 돌린 풀이만 반영됩니다.</p>
          )}
          {loading && <p className="text-xs text-muted-foreground animate-pulse">다시 불러오는 중…</p>}

          {/* 필터 — 선택형 오답노트(components/tabs/wrong-tab)와 같은 카드·칩. 아무것도 안 고르면 전체 */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <FilterChips options={SUBJECT_CHIPS} selected={subjects} onChange={setSubjects} />
            <FilterChips options={KIND_CHIPS} selected={kinds} onChange={setKinds} />
            <div className="flex flex-wrap items-center gap-2">
              <FilterChips options={SORT_CHIPS} selected={[sortChip]} onChange={(v) => setSortChip(v[0] ?? sortChip)} single />
              <span className="h-4 w-px bg-border" />
              <FilterChips options={PERIOD_CHIPS} selected={[periodChip]} onChange={(v) => setPeriodChip(v[0] ?? periodChip)} single />
            </div>
          </div>

          <p className="text-xs text-muted-foreground px-1">
            {shown.length}개 표시 (전체 {items.length}개)
          </p>

          {data.attempts === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              오답노트가 없습니다. CBT나 풀어보기 모드에서 문제를 풀고 제출해 보세요.
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">빠진 항목이 없습니다.</div>
          ) : shown.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">조건에 맞는 항목이 없습니다.</div>
          ) : (
            <div className="space-y-5">
              {tree.map((s) => (
                <section key={s.subject} className="space-y-3">
                  <h2 className="text-sm font-bold text-foreground">{s.subject}</h2>
                  {s.cards.map((c) => (
                    <div key={c.cardId} className="space-y-2 rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <h3 className="min-w-0 flex-1 break-keep text-sm font-semibold text-foreground">{c.cardTitle}</h3>
                        <button
                          onClick={() => onOpenCard(c.cardId, c.problems[0].problemId)}
                          className="min-h-8 shrink-0 px-1 text-xs text-primary hover:underline"
                        >
                          카드 보기
                        </button>
                      </div>
                      {c.problems.map((p) => (
                        <div key={p.problemId} className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">{p.problemLabel}</p>
                          <ul className="space-y-2">
                            {p.items.map((x) => <MissRow key={x.key} x={x} />)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {reading !== null && shown.length > 0 && (
        <MissReading items={shown} at={Math.min(reading, shown.length - 1)} onMove={setReading} onClose={() => setReading(null)} />
      )}
    </div>
  )
}

function MissRow({ x }: { x: MissItem }) {
  const v = VERDICT[x.lastVerdict]
  return (
    <li className="space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${KIND_CLS[x.kind]}`}>{MISS_KIND_LABEL[x.kind]}</span>
        <span className={`font-semibold ${v.cls}`}>{v.sym} {v.word}</span>
        <span className="text-muted-foreground">{x.missCount}번 빠짐</span>
        <span className="ml-auto text-muted-foreground tabular-nums">{missDate(x.lastMissedAt)}</span>
      </div>
      <p className="whitespace-pre-line break-words leading-relaxed text-foreground">{x.kind === 'statute' ? x.label : x.text}</p>
      {x.kind !== 'statute' && (
        <details className="group">
          <summary className="min-h-8 cursor-pointer select-none py-1.5 text-primary">내 답안과 비교</summary>
          <div className="space-y-1.5 pt-1">
            {x.evidence ? (
              <blockquote className="whitespace-pre-line break-words border-l-2 border-primary pl-2 text-muted-foreground">{x.evidence}</blockquote>
            ) : (
              <p className="text-muted-foreground">답안에 없음</p>
            )}
            {x.note && <p className="break-words text-foreground/90">AI: {x.note}</p>}
          </div>
        </details>
      )}
    </li>
  )
}

/** 시험 전날 보기 — 한 항목씩 큰 글씨로. 기록은 저장하지 않는다 */
function MissReading({ items, at, onMove, onClose }: { items: MissItem[]; at: number; onMove: (i: number) => void; onClose: () => void }) {
  const x = items[at]
  const move = useCallback((d: number) => onMove(stepReading(at, d, items.length)), [at, items.length, onMove])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, onClose])
  const v = VERDICT[x.lastVerdict]
  const NAV = 'min-h-11 min-w-20 rounded-lg border border-border px-4 text-sm disabled:opacity-40'
  return (
    <div role="dialog" aria-label="시험 전날 보기" className="fixed inset-0 z-[70] flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-sm font-semibold tabular-nums text-foreground">{readingProgress(at, items.length)}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => move(-1)} disabled={at === 0} className={NAV}>이전</button>
          <button onClick={() => move(1)} disabled={at === items.length - 1} className={NAV}>다음</button>
          <button onClick={onClose} className={NAV}>닫기</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          <p className="break-keep text-sm text-muted-foreground">{x.cardTitle} · {x.problemLabel}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded border px-2 py-0.5 font-semibold ${KIND_CLS[x.kind]}`}>{MISS_KIND_LABEL[x.kind]}</span>
            <span className={`font-semibold ${v.cls}`}>{v.sym} {v.word}</span>
            <span className="text-muted-foreground">{x.missCount}번 빠짐</span>
          </div>
          {x.kind === 'statute' && <p className="text-2xl font-bold text-foreground">{x.label}</p>}
          <p className="whitespace-pre-line break-words text-lg leading-relaxed text-foreground">{x.text}</p>
        </div>
      </div>
    </div>
  )
}
