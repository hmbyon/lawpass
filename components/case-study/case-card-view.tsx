'use client'

import { useEffect, useMemo } from 'react'
import type { Block, Card, Problem } from '@/lib/caseStudy/types'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'

interface Props {
  card: Card
  focusProblemId?: string
  onBack: () => void
  onPrev?: () => void
  onNext?: () => void
  onJump: (cardId: string, problemId?: string) => void
}

// 문항 id 에 '#' 이 들어 있어 그대로 DOM id 로 쓰되 querySelector 대신 getElementById 로 찾는다
const anchorId = (problemId: string) => `case-p-${problemId}`

const INDENT: Record<string, string> = { l2: 'pl-3', l3: 'pl-6' }

function SafeHtml({ html, className }: { html: string; className?: string }) {
  // sanitizer 를 거친 문자열만 innerHTML 로 넣는다 (mark·u·b·br 외에는 남지 않는다)
  const clean = useMemo(() => sanitizeCaseHtml(html), [html])
  return <span className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}

function AnswerBlock({ b }: { b: Block }) {
  const indent = b.lv ? INDENT[b.lv] : ''
  const pts = b.pts && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{b.pts}</span>
  if (b.t === 'h1') {
    return (
      <h4 className={`mt-4 first:mt-0 text-sm font-bold text-foreground ${indent}`}>
        <SafeHtml html={b.html} />
        {pts}
      </h4>
    )
  }
  if (b.t === 'h2') {
    return (
      <h5 className={`mt-2.5 text-[13px] font-semibold text-foreground ${indent}`}>
        <SafeHtml html={b.html} />
        {pts}
      </h5>
    )
  }
  return (
    <p className={`mt-1 text-[13px] leading-relaxed text-foreground/90 ${indent}`}>
      <SafeHtml html={b.html} />
    </p>
  )
}

function ProblemSection({ p, onJump }: { p: Problem; onJump: Props['onJump'] }) {
  const sub = [p.qno, p.sub].filter(Boolean).join(' ')
  return (
    <section id={anchorId(p.id)} className="scroll-mt-28 bg-card border border-border rounded-xl overflow-hidden">
      <header className="flex items-baseline gap-2 px-4 py-2.5 bg-muted border-b border-border">
        <span className="text-sm font-semibold text-foreground">{p.examLabel || sub}</span>
        {p.examLabel && sub && !p.examLabel.includes(p.qno) && <span className="text-xs text-muted-foreground">{sub}</span>}
        <span className="ml-auto shrink-0 text-xs font-semibold text-primary">{p.points}점</span>
      </header>
      <div className="px-4 py-3 space-y-3">
        {p.stubFor ? (
          <button
            onClick={() => onJump(p.stubFor!.card, p.stubFor!.problem)}
            className="w-full text-left text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2 hover:text-primary hover:border-primary/60 transition-colors"
          >
            답안은 카드 {p.stubFor.card} 에 있습니다 →
          </button>
        ) : (
          <>
            {p.brief && p.brief.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-foreground/90">
                {p.brief.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            {p.question && (
              <>
                {p.question.paragraphs.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">문제 원문</summary>
                    <div className="mt-2 space-y-1.5 text-foreground/90 leading-relaxed">
                      {p.question.paragraphs.map((s, i) => <p key={i}>{s}</p>)}
                    </div>
                  </details>
                )}
                {p.question.ask && (
                  <p className="text-[13px] font-medium text-foreground border-l-2 border-primary pl-2.5">{p.question.ask}</p>
                )}
              </>
            )}
            {p.answer && (
              <div className="pt-2 border-t border-border">
                {p.answer.blocks.map((b, i) => <AnswerBlock key={i} b={b} />)}
                {p.answer.source && <p className="mt-3 text-[10px] text-muted-foreground">{p.answer.source}</p>}
              </div>
            )}
          </>
        )}
        {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
      </div>
    </section>
  )
}

export function CaseCardView({ card, focusProblemId, onBack, onPrev, onNext, onJump }: Props) {
  useEffect(() => {
    if (focusProblemId) document.getElementById(anchorId(focusProblemId))?.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [card.id, focusProblemId])

  const navBtn = 'text-xs text-muted-foreground border border-border rounded-lg px-2.5 py-1 hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const nav = (
    <div className="flex items-center gap-2">
      <button onClick={onBack} className={navBtn}>← 목록으로</button>
      <div className="ml-auto flex gap-2">
        <button onClick={onPrev} disabled={!onPrev} className={navBtn}>이전 카드</button>
        <button onClick={onNext} disabled={!onNext} className={navBtn}>다음 카드</button>
      </div>
    </div>
  )

  return (
    <article className="space-y-4">
      {nav}
      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">
          {card.id} · {card.subject} · {card.category} · {card.chapter}
          {card.pages && ` · ${card.pages}`}
        </p>
        <h1 className="text-lg font-bold text-foreground">{card.title}</h1>
        {card.meta && <p className="text-xs text-muted-foreground">{card.meta}</p>}
      </div>
      {card.problems.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {card.problems.map((p) => (
            <button
              key={p.id}
              onClick={() => document.getElementById(anchorId(p.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`text-[11px] rounded-md px-1.5 py-0.5 border hover:border-primary/60 hover:text-primary transition-colors ${
                p.stubFor ? 'border-dashed border-border text-muted-foreground' : 'border-border bg-muted text-foreground'
              }`}
            >
              {p.examLabel || [p.qno, p.sub].filter(Boolean).join(' ')} · {p.points}점
            </button>
          ))}
        </div>
      )}
      {card.problems.map((p) => <ProblemSection key={p.id} p={p} onJump={onJump} />)}
      {card.notes.length > 0 && (
        <section className="bg-card border border-border rounded-xl px-4 py-3">
          <h2 className="text-xs font-semibold text-foreground mb-1.5">채점·출제 메모</h2>
          <ul className="list-disc pl-4 space-y-0.5 text-xs text-foreground/90">
            {card.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </section>
      )}
      {card.source && <p className="text-[10px] text-muted-foreground">출처: {card.source}</p>}
      {nav}
    </article>
  )
}
