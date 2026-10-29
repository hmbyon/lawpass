'use client'

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchSubmittedCaseAttempts } from '@/lib/firebaseServices/caseAttempts'
import { fetchCaseCard } from '@/lib/firebaseServices/caseStudy'
import { caseStarBackend } from '@/lib/firebaseServices/caseD1'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'
import { extractAiItems } from '@/lib/caseStudy/aiCheck'
import { aiDotTargets } from '@/lib/caseStudy/aiCheckView'
import { modelStatutes } from '@/lib/caseStudy/statuteCheck'
import { aggregateMisses, cardIdsOf, type MissItem, type MissKind, type MissResult } from '@/lib/caseStudy/misses'
import { MISS_KIND_LABEL, missDate } from '@/lib/caseStudy/missView'
import { createStarStore, type StarStore } from '@/lib/caseStudy/d1Stars'
import type { Card, Problem } from '@/lib/caseStudy/types'
import { AnswerBlock } from '@/components/case-study/case-card-view'

/**
 * 사례형 오답노트·D-1 암기장이 함께 쓰는 것: 불러오기, '전날 볼 것' 찜, 문항 카드(모범답안 + 안 쓴 부분 표시).
 * 읽기 전용(찜만 따로 저장). AI 를 부르지 않는다
 */

export interface MissData {
  result: MissResult
  attempts: number
  aiUsed: boolean
  cards: Map<string, Card>
}

/** 제출한 시도와 그 문항들의 카드(+ extraCardIds)를 읽어 집계한다. 실패하면 사용자 말 오류를 던진다 */
export async function loadMissData(extraCardIds: string[] = []): Promise<MissData> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('로그인한 뒤에 볼 수 있습니다.')
  const mode = getAppMode()
  const r = await fetchSubmittedCaseAttempts(uid, mode)
  if (!r.ok) throw new Error(r.message)
  let cards: Card[]
  try {
    const ids = [...new Set([...cardIdsOf(r.attempts), ...extraCardIds])]
    cards = (await Promise.all(ids.map((id) => fetchCaseCard(mode, id)))).filter((c): c is Card => !!c)
  } catch {
    throw new Error('카드를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
  }
  return {
    result: aggregateMisses(r.attempts, cards, sanitizeCaseHtml),
    attempts: r.attempts.length,
    aiUsed: r.attempts.some((a) => Object.keys(a.aiChecks ?? {}).length > 0),
    cards: new Map(cards.map((c) => [c.id, c])),
  }
}

export const findProblem = (cards: Map<string, Card>, problemId: string): { card: Card; p: Problem } | null => {
  const card = cards.get(problemId.split('#')[0])
  const p = card?.problems.find((x) => x.id === problemId)
  return card && p ? { card, p } : null
}

// ── 찜 ─────────────────────────────────────────────────────

// 계정·모드마다 저장소 하나를 두 탭(오답노트·D-1 암기장)이 함께 본다 — 한쪽에서 찜하면 다른 쪽도 바로 바뀐다
const stores = new Map<string, StarStore>()
function starStore(): StarStore | null {
  const uid = auth.currentUser?.uid
  if (!uid) return null
  const mode = getAppMode()
  const key = `${uid}|${mode}`
  if (!stores.has(key)) stores.set(key, createStarStore(caseStarBackend(uid, mode)))
  return stores.get(key)!
}

const noop = () => () => {}
export function useCaseStars() {
  const store = useMemo(starStore, [])
  // 저장소는 바뀔 때마다 새 Map 을 만들어 all() 의 길이·상태로 다시 그릴지 가른다
  const version = useSyncExternalStore(
    store?.subscribe ?? noop,
    () => (store ? `${store.status}|${store.all().map((s) => s.problemId).join(',')}` : 'none'),
    () => 'none'
  )
  return { store, version }
}

export function StarToggle({ store, problemId, cardId, size = 'sm' }: { store: StarStore | null; problemId: string; cardId: string; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!store) return null
  const on = store.has(problemId)
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    setFailed(!(await store!.toggle(problemId, cardId)))
    setBusy(false)
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        disabled={store.status !== 'ready'}
        className={`min-h-8 whitespace-nowrap rounded-lg border px-2.5 transition-colors disabled:opacity-40 ${size === 'md' ? 'text-sm' : 'text-xs'} ${
          on ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        {on ? '★' : '☆'} 전날 볼 것
      </button>
      {failed && <span className="text-xs text-red-400">저장하지 못했습니다</span>}
    </span>
  )
}

// ── 문항 카드 ───────────────────────────────────────────────

export const VERDICT = {
  missing: { sym: '✕', word: '없음', cls: 'text-red-500' },
  partial: { sym: '△', word: '부분', cls: 'text-amber-500' },
}
export const KIND_CLS: Record<MissKind, string> = {
  statute: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  case: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  res: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}
// 안 쓴 표시 — 기존 칠(배경)과 겹치지 않게 테두리로. 다크 모드에서도 보이는 밝기
const MARK_MISS = { missing: ['outline', 'outline-2', 'outline-red-500', 'rounded-sm'], partial: ['outline', 'outline-2', 'outline-dashed', 'outline-amber-500', 'rounded-sm'] }

/**
 * 모범답안을 카드 상세와 같은 블록(AnswerBlock)으로 그리고, 최근 판정이 ✕·△ 인 항목의 표시(mark)에 테두리를,
 * 그 블록 왼쪽에 줄을 긋는다. ✓(최근 ✓ 포함)는 표시하지 않는다
 */
function MissAnswer({ p, items }: { p: Problem; items: MissItem[] }) {
  const blocks = useMemo(() => p.answer?.blocks ?? [], [p])
  const clean = useMemo(() => blocks.map((b) => sanitizeCaseHtml(b.html)), [blocks])
  const open = items.filter((x) => !x.recentOk)
  // 블록 → [mark 종류, 그 블록에서 그 종류의 순서, 판정]
  const targets = useMemo(() => {
    const out = new Map<number, { cls: 'law' | 'case' | 'res'; nth: number; v: 'missing' | 'partial' }[]>()
    const add = (bi: number, t: { cls: 'law' | 'case' | 'res'; nth: number; v: 'missing' | 'partial' }) =>
      (out.get(bi) ?? out.set(bi, []).get(bi)!).push(t)
    const model = modelStatutes(clean)
    for (const x of open.filter((i) => i.kind === 'statute')) {
      model.marks.forEach((ms, bi) => ms.forEach((keys, li) => keys.includes(x.key) && add(bi, { cls: 'law', nth: li, v: x.lastVerdict })))
    }
    const ai = open.filter((i) => i.kind !== 'statute')
    const aiItems = extractAiItems(clean).filter((it) => ai.some((x) => x.key === it.key))
    const verdictOf = new Map(ai.map((x) => [x.key, x.lastVerdict]))
    for (const [bi, slots] of Object.entries(aiDotTargets(clean, aiItems))) {
      for (const [slot, keys] of Object.entries(slots)) {
        const [kind, nth] = slot.split(':')
        add(Number(bi), { cls: kind as 'case' | 'res', nth: Number(nth), v: keys.some((k) => verdictOf.get(k) === 'missing') ? 'missing' : 'partial' })
      }
    }
    // 표시를 찾지 못한 판례·결론 항목도 블록 줄은 긋는다
    for (const it of aiItems) if (!out.has(it.block)) out.set(it.block, [])
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, open.map((x) => x.key).join('|')])

  // AnswerBlock 은 sanitize 한 html 을 innerHTML 로 넣는다 — 그린 뒤에 해당 mark 에 테두리 클래스를 단다.
  // ponytail: 길이 0 인 mark 가 끼면 순서가 하나 밀린다(조문·AI 점의 순서 규칙과 같은 한계)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const added: [Element, string[]][] = []
    for (const [bi, ts] of targets) {
      const el = root.querySelector(`[data-miss-block="${bi}"]`)
      for (const t of ts) {
        const m = el?.querySelectorAll(`mark.${t.cls}`)[t.nth]
        if (!m) continue
        m.classList.add(...MARK_MISS[t.v])
        added.push([m, MARK_MISS[t.v]])
      }
    }
    return () => added.forEach(([m, cls]) => m.classList.remove(...cls))
  }, [targets])

  return (
    <div ref={ref} className="case-ans">
      {blocks.map((b, i) => (
        // AnswerBlock 의 큰 제목(h4)은 first:mt-0 이라 감싸면 늘 첫째가 된다 — 위 여백은 감싼 쪽이 대신 진다
        <div
          key={i}
          data-miss-block={i}
          className={`${b.t === 'h1' ? 'mt-4 first:mt-0' : ''} ${targets.has(i) ? 'border-l-2 border-red-500/60 pl-2 -ml-2.5' : ''}`}
        >
          <AnswerBlock b={b} />
        </div>
      ))}
    </div>
  )
}

export function MissItemRow({ x }: { x: MissItem }) {
  const v = VERDICT[x.lastVerdict]
  return (
    <li className="space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${KIND_CLS[x.kind]}`}>{MISS_KIND_LABEL[x.kind]}</span>
        {x.recentOk ? (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">최근 ✓</span>
        ) : (
          <span className={`font-semibold ${v.cls}`}>{v.sym} {v.word}</span>
        )}
        <span className="text-muted-foreground">{x.missCount}번 빠짐</span>
        <span className="ml-auto text-muted-foreground tabular-nums">{missDate(x.lastMissedAt)}</span>
      </div>
      <p className="whitespace-pre-line break-words leading-relaxed text-foreground">{x.kind === 'statute' ? x.label : x.text}</p>
      {x.kind !== 'statute' && (
        <details>
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

/** 문항 카드: 머리(제목·찜) + 물음 + 모범답안(안 쓴 부분 표시) + 안 쓴 항목 목록 */
export function MissProblemCard({
  card, p, items, wrongCount, stars, onOpenCard,
}: {
  card: Card
  p: Problem
  items: MissItem[]
  wrongCount: number
  stars: StarStore | null
  onOpenCard?: () => void
}) {
  return (
    <article className="case-study space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs text-muted-foreground">{card.subject} · {card.title}</p>
          <h3 className="break-keep text-base font-semibold text-foreground">{items[0]?.problemLabel ?? p.id}</h3>
          <p className="text-xs text-muted-foreground">
            틀린 횟수 {wrongCount}번 · 안 쓴 항목 {items.length}개
            {items.some((x) => x.recentOk) && ` (최근 ✓ ${items.filter((x) => x.recentOk).length}개)`}
          </p>
        </div>
        <StarToggle store={stars} problemId={p.id} cardId={card.id} />
      </header>
      {p.question?.ask && <p className="border-l-2 border-primary pl-2.5 text-[13px] font-medium text-foreground">{p.question.ask}</p>}
      <div className="border-t border-border pt-2">
        <MissAnswer p={p} items={items} />
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span><span className="rounded-sm px-1 outline outline-2 outline-red-500">✕</span> 안 씀</span>
          <span><span className="rounded-sm px-1 outline outline-2 outline-dashed outline-amber-500">△</span> 일부만</span>
          {onOpenCard && (
            <button onClick={onOpenCard} className="ml-auto min-h-8 text-xs text-primary hover:underline">카드 전체 보기</button>
          )}
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((x) => <MissItemRow key={x.key} x={x} />)}
      </ul>
    </article>
  )
}
