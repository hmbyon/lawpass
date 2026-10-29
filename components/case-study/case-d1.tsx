'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { problemLabel, sortCards } from '@/lib/caseStudy/group'
import { missProblems, readingProgress, stepReading } from '@/lib/caseStudy/missView'
import type { Card } from '@/lib/caseStudy/types'
import { categoryLabel } from '@/components/case-study/case-index-view'
import {
  MissProblemCard, StarToggle, findProblem, loadMissData, useCaseStars, type MissData,
} from '@/components/case-study/case-miss-shared'

/**
 * 사례형 D-1 암기장 — 오답노트에서 '전날 볼 것'으로 찜한 문항만 모은다(오답노트 필터와 무관).
 *  - 한 장씩 보기: 틀린 횟수 많은 순으로 문항 카드(모범답안 + 안 쓴 부분 표시)를 넘긴다
 *  - 카드 목록: 과목 → 단원별 찜한 문항. 누르면 그 문항 카드를 한 장씩 보기로 연다
 * 읽기 전용(찜 해제만 저장). AI 를 부르지 않는다
 */

type View = 'single' | 'list'
const NAV = 'min-h-10 min-w-20 rounded-lg border border-border px-4 text-sm disabled:opacity-40'

export function CaseD1({ onOpenCard }: { onOpenCard: (cardId: string, problemId: string) => void }) {
  const { store: stars } = useCaseStars()
  const [view, setView] = useState<View>('single')
  const [at, setAt] = useState(0)
  const [data, setData] = useState<MissData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (!stars) throw new Error('로그인한 뒤에 볼 수 있습니다.')
      if (!(await stars.load(true))) throw new Error('찜한 문항을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      setData(await loadMissData(stars.all().map((s) => s.cardId)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [stars])
  useEffect(() => {
    reload()
  }, [reload])

  // 찜한 문항 — 틀린 횟수 많은 순(같으면 먼저 찜한 순). 카드를 찾지 못한 찜은 따로 센다
  const starList = stars?.all() ?? []
  const starKey = starList.map((s) => s.problemId).join(',')
  const { rows, missing } = useMemo(() => {
    if (!data) return { rows: [], missing: 0 }
    const byProblem = new Map(missProblems(data.result.items).map((m) => [m.problemId, m]))
    const rows: { card: Card; p: NonNullable<ReturnType<typeof findProblem>>['p']; wrongCount: number; starredAt: number }[] = []
    let missing = 0
    for (const s of starList) {
      const f = findProblem(data.cards, s.problemId)
      if (!f) {
        missing++
        continue
      }
      rows.push({ ...f, wrongCount: byProblem.get(s.problemId)?.wrongCount ?? 0, starredAt: s.starredAt })
    }
    rows.sort((a, b) => b.wrongCount - a.wrongCount || a.starredAt - b.starredAt)
    return { rows, missing }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, starKey])
  const itemsOf = (pid: string) => data?.result.items.filter((x) => x.problemId === pid) ?? []

  // 카드 목록: 과목 → 단원(분류). 교재 순서
  const groups = useMemo(() => {
    const order = new Map((sortCards(rows.map((r) => r.card)) as unknown as Card[]).map((c, i) => [c.id, i]))
    const sorted = [...rows].sort((a, b) => order.get(a.card.id)! - order.get(b.card.id)!)
    const out: { subject: string; units: { unit: string; rows: typeof rows }[] }[] = []
    for (const r of sorted) {
      let s = out.find((x) => x.subject === r.card.subject)
      if (!s) out.push((s = { subject: r.card.subject, units: [] }))
      const unit = categoryLabel(r.card.category, r.card.subject)
      let u = s.units.find((x) => x.unit === unit)
      if (!u) s.units.push((u = { unit, rows: [] }))
      u.rows.push(r)
    }
    return out
  }, [rows])

  const cur = rows.length ? Math.min(at, rows.length - 1) : 0
  const row = rows[cur]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-foreground">D-1 암기장</h2>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(
            [
              ['single', '📄 한 장씩'],
              ['list', '📇 카드 목록'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`px-4 py-2 transition-colors ${
                view === id ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {view === 'single'
          ? '오답노트에서 전날 볼 것으로 찜한 문항을 틀린 횟수 많은 순으로 한 장씩 넘겨 봐요. 모범답안에서 안 쓴 부분이 표시돼요.'
          : '찜한 문항을 과목·단원별로 모아 봐요. 누르면 그 문항 카드가 열려요.'}
      </p>

      {loading && !data && <p className="py-8 text-center text-xs text-muted-foreground animate-pulse">불러오는 중…</p>}
      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          {error}
          <button onClick={reload} className="min-h-8 px-1 text-primary hover:underline">다시 시도</button>
        </div>
      )}

      {data && !error && (
        rows.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            오답노트에서 전날 볼 문항을 찜해 두세요
            {missing > 0 && <p className="mt-2 text-xs">카드를 찾지 못한 찜 {missing}개</p>}
          </div>
        ) : view === 'single' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-foreground">{readingProgress(cur, rows.length)}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setAt(stepReading(cur, -1, rows.length))} disabled={cur === 0} className={NAV}>이전</button>
                <button onClick={() => setAt(stepReading(cur, 1, rows.length))} disabled={cur === rows.length - 1} className={NAV}>다음</button>
              </div>
            </div>
            <MissProblemCard
              key={row.p.id}
              card={row.card}
              p={row.p}
              items={itemsOf(row.p.id)}
              wrongCount={row.wrongCount}
              stars={stars}
              onOpenCard={() => onOpenCard(row.card.id, row.p.id)}
            />
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.subject} className="space-y-3">
                <h3 className="text-sm font-bold text-foreground">{g.subject}</h3>
                {g.units.map((u) => (
                  <div key={u.unit} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{u.unit}</p>
                    {u.rows.map((r) => (
                      <div
                        key={r.p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setAt(rows.indexOf(r))
                          setView('single')
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          setAt(rows.indexOf(r))
                          setView('single')
                        }}
                        className="flex items-start gap-3 bg-card border border-border rounded-xl p-4 cursor-pointer transition-colors hover:border-primary/40"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-xs text-muted-foreground">{problemLabel(r.p)}</p>
                          <p className="break-keep text-sm text-foreground">{r.card.title}</p>
                          <p className="text-xs text-muted-foreground">틀린 횟수 {r.wrongCount}번 · 안 쓴 항목 {itemsOf(r.p.id).length}개</p>
                        </div>
                        <StarToggle store={stars} problemId={r.p.id} cardId={r.card.id} />
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
            {missing > 0 && <p className="text-xs text-muted-foreground">카드를 찾지 못한 찜 {missing}개</p>}
          </div>
        )
      )}
    </div>
  )
}
