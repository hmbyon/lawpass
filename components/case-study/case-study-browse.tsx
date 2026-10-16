'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CaseIndex } from '@/lib/caseStudy/types'
import { getAppMode } from '@/lib/appMode'
import { fetchCaseCard, fetchCaseIndex } from '@/lib/firebaseServices/caseStudy'
import { sortCards } from '@/lib/caseStudy/group'
import { CaseIndexView } from '@/components/case-study/case-index-view'
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
  const [open, setOpen] = useState<{ card: string; problem?: string } | null>(null)
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

  function openCard(cardId: string, problemId?: string) {
    if (!open) listScroll.current = window.scrollY
    setOpen({ card: cardId, problem: problemId })
  }

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
            onPrev={pos > 0 ? () => openCard(ordered[pos - 1].id) : undefined}
            onNext={pos >= 0 && pos < ordered.length - 1 ? () => openCard(ordered[pos + 1].id) : undefined}
            onJump={openCard}
          />
        ))}
    </div>
  )
}
