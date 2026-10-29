'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type MissKind, type MissPeriod, type MissSort } from '@/lib/caseStudy/misses'
import {
  DEFAULT_MISS_FILTER, MISS_KIND_LABEL, applyMissFilter, missDate, missProblems, sortMissProblems,
} from '@/lib/caseStudy/missView'
import { FilterChips } from '@/components/filter-chips'
import {
  KIND_CLS, MissProblemCard, StarToggle, VERDICT, findProblem, loadMissData, useCaseStars, type MissData,
} from '@/components/case-study/case-miss-shared'

/**
 * 사례형 오답노트 — 제출한 풀이의 조문 점검·AI 점검에서 한 번이라도 빠진 항목을 문항 단위로 모아 보여 준다.
 * 문항을 열면 모범답안에서 안 쓴 부분을 표시한다. 읽기 전용(찜만 따로 저장): AI 를 부르지 않는다.
 * 탭을 처음 열 때와 '새로고침'을 누를 때만 읽는다
 */

// 칩 글자 → 값. 과목 칩은 선택형 오답노트와 같은 7개·같은 문구이고, 카드의 과목 값(민소·형소)으로 바꿔 거른다
const SUBJECT_OF: Record<string, string> = {
  민법: '민법', 민사소송법: '민소', 상법: '상법', 형법: '형법', 형사소송법: '형소', 헌법: '헌법', 행정법: '행정법',
}
const SUBJECT_CHIPS = Object.keys(SUBJECT_OF)
const KIND_OF: Record<string, MissKind> = { 조문: 'statute', '판례 취지': 'case', 결론: 'res' }
const KIND_CHIPS = Object.keys(KIND_OF)
const SORT_OF: Record<string, MissSort> = { '많이 틀린 순': 'count', '최근 빠진 순': 'recent' }
const SORT_CHIPS = Object.keys(SORT_OF)
const PERIOD_OF: Record<string, MissPeriod> = { '7일': 7, '30일': 30, 전체: 'all' }
const PERIOD_CHIPS = Object.keys(PERIOD_OF)
const PILL = 'min-h-8 rounded-lg border px-3 text-xs transition-colors'

export function CaseMisses({ onOpenCard }: { onOpenCard: (cardId: string, problemId: string) => void }) {
  const [data, setData] = useState<MissData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [subjects, setSubjects] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [sortChip, setSortChip] = useState(SORT_CHIPS[0])
  const [periodChip, setPeriodChip] = useState('전체')
  const [openId, setOpenId] = useState<string | null>(null)
  const { store: stars } = useCaseStars()

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    stars?.load(true)
    loadMissData()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [stars])
  useEffect(reload, [reload])

  const items = useMemo(() => data?.result.items ?? [], [data])
  const allProblems = useMemo(() => missProblems(items), [items])
  // 종류·기간은 applyMissFilter(filterMisses), 과목은 복수 선택이라 고른 과목 목록으로 거른다.
  // 걸린 항목이 하나라도 있는 문항만 남고, 문항의 개수·틀린 횟수는 걸린 항목으로 센다
  const shown = useMemo(() => {
    const f = { ...DEFAULT_MISS_FILTER, kinds: kinds.map((k) => KIND_OF[k]), period: PERIOD_OF[periodChip] }
    const picked = new Set(subjects.map((s) => SUBJECT_OF[s]))
    const hit = applyMissFilter(items, f, {}).filter((x) => picked.size === 0 || picked.has(x.subject))
    // applyMissFilter 는 항목을 정렬해 돌려준다 — 문항 안 항목 순서는 원래(카드) 순서로 되돌린다
    const order = new Map(items.map((x, i) => [x, i]))
    return sortMissProblems(missProblems(hit.sort((a, b) => order.get(a)! - order.get(b)!)), SORT_OF[sortChip])
  }, [items, subjects, kinds, periodChip, sortChip])

  const opened = openId && data ? findProblem(data.cards, openId) : null
  const openedProblem = allProblems.find((x) => x.problemId === openId)
  if (opened && openedProblem) {
    return (
      <div className="space-y-4">
        <button onClick={() => setOpenId(null)} className="min-h-8 text-xs text-muted-foreground hover:text-foreground">← 오답노트 목록</button>
        <MissProblemCard
          card={opened.card}
          p={opened.p}
          items={openedProblem.items}
          wrongCount={openedProblem.wrongCount}
          stars={stars}
          onOpenCard={() => onOpenCard(opened.card.id, opened.p.id)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">
          {data ? `안 쓴 항목 ${items.length}개 · 최근 ✓ ${data.result.recentOk}개` : '오답노트'}
        </p>
        <button onClick={reload} disabled={loading} className={`${PILL} ml-auto border-border text-muted-foreground disabled:opacity-40`}>
          새로고침
        </button>
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
            {shown.length}문항 표시 (전체 {allProblems.length}문항)
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
            <div className="space-y-2">
              {shown.map((m) => {
                const missing = m.items.filter((x) => !x.recentOk && x.lastVerdict === 'missing').length
                const partial = m.open - missing
                return (
                  <div
                    key={m.problemId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenId(m.problemId)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenId(m.problemId)}
                    className="bg-card border border-border rounded-xl p-4 cursor-pointer transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{m.subject}</span>
                          <span className="text-xs text-muted-foreground">{m.problemLabel}</span>
                        </div>
                        <p className="break-keep text-sm text-foreground">{m.cardTitle}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="text-foreground">안 쓴 항목 {m.items.length}개</span>
                          <span className="text-muted-foreground">틀린 횟수 {m.wrongCount}번</span>
                          {m.open === 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">최근 ✓</span>
                          ) : (
                            <span className="font-semibold">
                              {missing > 0 && <span className={VERDICT.missing.cls}>✕ {missing}</span>}
                              {missing > 0 && partial > 0 && ' '}
                              {partial > 0 && <span className={VERDICT.partial.cls}>△ {partial}</span>}
                              {m.recentOk > 0 && <span className="ml-1 font-normal text-emerald-600 dark:text-emerald-400">최근 ✓ {m.recentOk}</span>}
                            </span>
                          )}
                          {m.kinds.map((k) => (
                            <span key={k} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${KIND_CLS[k]}`}>{MISS_KIND_LABEL[k]}</span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground tabular-nums">{missDate(m.lastMissedAt)}</p>
                      </div>
                      <StarToggle store={stars} problemId={m.problemId} cardId={m.cardId} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
