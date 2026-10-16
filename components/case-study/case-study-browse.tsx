'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CaseIndex } from '@/lib/caseStudy/types'
import { getAppMode } from '@/lib/appMode'
import { fetchCaseCard, fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import { sortCards } from '@/lib/caseStudy/group'
import { CaseIndexView, type SeqItem } from '@/components/case-study/case-index-view'
import { CaseCardView } from '@/components/case-study/case-card-view'

export function CaseErrorNotice({ error }: { error: unknown }) {
  // 규칙 배포 전에는 caseStudy 경로가 기본 거부라 조용히 빈 화면이 된다. 이유를 화면에 밝힌다
  const denied = (error as { code?: string } | null)?.code === 'permission-denied'
  return (
    <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3 text-xs text-red-400 space-y-1">
      <p className="font-semibold">{denied ? 'Firestore 규칙 배포 필요' : '불러오지 못했습니다'}</p>
      <p>
        {denied
          ? 'caseStudy 경로 읽기 권한이 없습니다. firestore.rules 의 caseStudy 블록을 배포해야 합니다.'
          : String(error)}
      </p>
    </div>
  )
}

const Loading = () => <p className="text-center text-xs text-muted-foreground py-8 animate-pulse">불러오는 중…</p>

// 답안·목차 — Firestore 를 읽어 표시 컴포넌트에 넘기기만 한다
export function CaseStudyBrowse() {
  const mode = getAppMode()
  // undefined = 불러오는 중, null = 아직 아무것도 올라오지 않음
  const [index, setIndex] = useState<CaseIndex | null | undefined>(undefined)
  const [indexError, setIndexError] = useState<unknown>(null)
  // seq 가 있으면 회차별 목록에서 들어온 것이다 — 카드 위에 '문항 이동'(◀ ▶)을 띄운다
  const [open, setOpen] = useState<{ card: string; problem?: string; seq?: { items: SeqItem[]; at: number } } | null>(null)
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [cardError, setCardError] = useState<unknown>(null)
  const cache = useRef(new Map<string, Card | null>())
  const listScroll = useRef(0)

  useEffect(() => {
    fetchCaseIndex(mode).then(setIndex).catch(setIndexError)
  }, [mode])

  const openCardId = open?.card
  useEffect(() => {
    if (!openCardId) return
    if (cache.current.has(openCardId)) {
      setCard(cache.current.get(openCardId))
      return
    }
    setCard(undefined)
    setCardError(null)
    let alive = true
    fetchCaseCard(mode, openCardId)
      .then((c) => {
        cache.current.set(openCardId, c)
        if (alive) setCard(c)
      })
      .catch((e) => alive && setCardError(e))
    return () => {
      alive = false
    }
  }, [mode, openCardId])

  const ordered = useMemo(() => (index ? sortCards(index.cards) : []), [index])
  const pos = ordered.findIndex((c) => c.id === openCardId)

  function openCard(cardId: string, problemId?: string, seq?: { items: SeqItem[]; at: number }) {
    if (!open) listScroll.current = window.scrollY
    setOpen({ card: cardId, problem: problemId, seq })
  }

  // 카드 안에서 다른 카드로 넘어가도(이전/다음 카드·stub 점프) 회차별 순서는 들고 간다 — ◀ ▶ 가 끊기지 않게
  function jump(cardId: string, problemId?: string) {
    setOpen((o) => ({ card: cardId, problem: problemId, seq: o?.seq }))
  }

  function moveSeq(delta: number) {
    setOpen((o) => {
      if (!o?.seq) return o
      const at = o.seq.at + delta
      const item = o.seq.items[at]
      return item ? { card: item.card, problem: item.problem, seq: { items: o.seq.items, at } } : o
    })
  }

  const seq = open?.seq
  const prevCard = pos > 0 ? () => jump(ordered[pos - 1].id) : undefined
  const nextCard = pos >= 0 && pos < ordered.length - 1 ? () => jump(ordered[pos + 1].id) : undefined
  const prevProblem = seq && seq.at > 0 ? () => moveSeq(-1) : undefined
  const nextProblem = seq && seq.at < seq.items.length - 1 ? () => moveSeq(1) : undefined

  // ← → 키: 회차별에서 들어왔으면 문항, 아니면 카드를 넘긴다. 입력창에 포커스가 있으면 건드리지 않는다
  const keys = useRef<{ prev?: () => void; next?: () => void }>({})
  keys.current = { prev: seq ? prevProblem : prevCard, next: seq ? nextProblem : nextCard }
  const isOpen = !!open
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      const fn = e.key === 'ArrowLeft' ? keys.current.prev : e.key === 'ArrowRight' ? keys.current.next : undefined
      if (!fn) return
      e.preventDefault()
      fn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  function back() {
    setOpen(null)
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }))
  }

  if (indexError) return <div className="case-study"><CaseErrorNotice error={indexError} /></div>
  if (index === undefined) return <Loading />
  if (index === null || index.cards.length === 0) {
    return <p className="text-center text-xs text-muted-foreground py-8">아직 올라온 사례형 카드가 없습니다</p>
  }

  return (
    <div className="case-study">
      {/* 목록은 카드를 여는 동안에도 마운트해 둔다 — 돌아왔을 때 검색어·필터가 그대로다 */}
      <div className={open ? 'hidden' : undefined}>
        <CaseIndexView index={index} onOpen={openCard} />
      </div>
      {open &&
        (cardError ? (
          <div className="space-y-3">
            <button onClick={back} className="text-xs text-muted-foreground hover:text-foreground">← 목록으로</button>
            <CaseErrorNotice error={cardError} />
          </div>
        ) : card === undefined ? (
          <Loading />
        ) : card === null ? (
          <div className="space-y-3">
            <button onClick={back} className="text-xs text-muted-foreground hover:text-foreground">← 목록으로</button>
            <p className="text-center text-xs text-muted-foreground py-8">카드 {open.card} 가 아직 올라오지 않았습니다</p>
          </div>
        ) : (
          <CaseCardView
            card={card}
            focusProblemId={open.problem}
            onBack={back}
            onPrev={prevCard}
            onNext={nextCard}
            onJump={jump}
            seqNav={
              seq && {
                label: seq.items[seq.at].label,
                nextLabel: seq.items[seq.at + 1]?.label,
                pos: seq.at + 1,
                total: seq.items.length,
                onPrev: prevProblem,
                onNext: nextProblem,
              }
            }
          />
        ))}
    </div>
  )
}
