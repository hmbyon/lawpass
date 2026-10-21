'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Block, Card, Problem } from '@/lib/caseStudy/types'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'
import { problemLabel } from '@/lib/caseStudy/group'
import { DrawLayer, useDrawBoard, type DrawBoard } from '@/components/quiz/draw-layer'
import { CaseQuestionText } from '@/components/case-study/case-question-text'

interface Props {
  card: Card
  focusProblemId?: string
  onBack: () => void
  onPrev?: () => void
  onNext?: () => void
  onJump: (cardId: string, problemId?: string) => void
  // 판례 화면에서 '카드 보기'로 들어왔을 때만 — 바에 '판례로 돌아가기'를 둔다
  onBackToCases?: () => void
  // 회차별 목록에서 들어왔을 때만 — 같은 회차의 문항을 ◀ ▶ 로 넘긴다
  seqNav?: SeqNav
  // 문항 하나를 풀이 화면으로 연다 (stub·원문 없는 문항에는 버튼이 없다)
  onSolve?: (p: Problem) => void
}

interface SeqNav {
  label: string
  nextLabel?: string
  pos: number
  total: number
  onPrev?: () => void
  onNext?: () => void
}

// 변시·모의 배지 (목록과 같은 색)
const KIND_BADGE: Record<Problem['kind'], string> = {
  변시: 'border-primary/30 bg-primary/10 text-primary',
  모의: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

function KindBadge({ kind }: { kind: Problem['kind'] }) {
  return (
    <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-none border ${KIND_BADGE[kind]}`}>{kind}</span>
  )
}

// 문항 id 에 '#' 이 들어 있어 그대로 DOM id 로 쓰되 querySelector 대신 getElementById 로 찾는다
const anchorId = (problemId: string) => `case-p-${problemId}`

const INDENT: Record<string, string> = { l2: 'pl-3', l3: 'pl-6' }

function SafeHtml({ html, className }: { html: string; className?: string }) {
  // sanitizer 를 거친 문자열만 innerHTML 로 넣는다 (mark·u·b·br 외에는 남지 않는다)
  const clean = useMemo(() => sanitizeCaseHtml(html), [html])
  return <span className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}

// 풀이 화면(case-solve)의 모범답안도 이것으로 그린다
export function AnswerBlock({ b }: { b: Block }) {
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

const navBtn = 'text-xs text-muted-foreground border border-border rounded-lg px-2.5 py-1 hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// 답안을 다 읽은 자리에서 바로 넘어가게 — 고정 바와 같은 이동을 문항 끝에 한 번 더 둔다
function SeqFooter({ seq, onBack }: { seq: SeqNav; onBack: () => void }) {
  if (!seq.onNext) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        <span>이 회차의 마지막 문항입니다</span>
        <span>·</span>
        <button onClick={onBack} className="text-primary hover:underline">목록으로</button>
        {seq.onPrev && (
          <button onClick={seq.onPrev} className={`${navBtn} ml-auto`}>◀ 이전 문항</button>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <button onClick={seq.onPrev} disabled={!seq.onPrev} className={navBtn}>◀ 이전 문항</button>
      <button onClick={seq.onNext} className={navBtn}>다음 문항 ▶</button>
      {seq.nextLabel && <span className="min-w-0 truncate text-xs text-muted-foreground">다음: {seq.nextLabel}</span>}
    </div>
  )
}

function ProblemSection({
  p, active, onJump, seq, onBack, onSolve, board,
}: { p: Problem; active: boolean; onJump: Props['onJump']; seq?: SeqNav; onBack: () => void; onSolve?: Props['onSolve']; board: DrawBoard }) {
  const sub = [p.qno, p.sub].filter(Boolean).join(' ')
  return (
    // 지금 보고 있는 문항은 테두리·좌측 선으로 살짝 띄운다 — 긴 카드에서 어디를 읽던 중인지 보이게
    <section
      id={anchorId(p.id)}
      // 고정 바(탭 줄 + 문항 이동 바) 밑으로 문항 제목이 숨지 않게 그 높이만큼 띄워서 멈춘다
      className={`scroll-mt-[calc(var(--case-sticky-top,0px)+var(--case-seqbar-h,0px)+0.5rem)] bg-card border rounded-xl overflow-hidden transition-colors ${
        active ? 'border-primary/60 ring-1 ring-primary/30 border-l-4 border-l-primary' : 'border-border'
      }`}
    >
      <header className="flex items-baseline gap-2 px-4 py-2.5 bg-muted border-b border-border">
        <KindBadge kind={p.kind} />
        <span className="text-sm font-semibold text-foreground">{p.examLabel || sub}</span>
        {p.examLabel && sub && !p.examLabel.includes(p.qno) && <span className="text-xs text-muted-foreground">{sub}</span>}
        <span className="ml-auto shrink-0 text-xs font-semibold text-primary">{p.points}점</span>
        {onSolve && !p.stubFor && p.question && (
          <button
            onClick={() => onSolve(p)}
            className="shrink-0 self-center rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"
          >
            풀어보기
          </button>
        )}
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
          // 문제 본문·모범답안 위에 선택형과 같은 임시 펜(저장하지 않음)을 겹친다
          <DrawLayer board={board} questionId={p.id} className="space-y-3">
            {p.brief && p.brief.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-foreground/90">
                {p.brief.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            {/* 문제 본문에는 형광펜(사용자별 저장)을 쓴다. 표시 모양은 예전과 같다 */}
            {p.question && <CaseQuestionText p={p} />}
            {p.answer && (
              <div className="pt-2 border-t border-border">
                {p.answer.blocks.map((b, i) => <AnswerBlock key={i} b={b} />)}
                {p.answer.source && <p className="mt-3 text-[10px] text-muted-foreground">{p.answer.source}</p>}
              </div>
            )}
          </DrawLayer>
        )}
        {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
        {active && seq && <SeqFooter seq={seq} onBack={onBack} />}
      </div>
    </section>
  )
}

export function CaseCardView({ card, focusProblemId, onBack, onPrev, onNext, onJump, onBackToCases, seqNav, onSolve }: Props) {
  // 임시 펜 — 카드를 떠나면(이 컴포넌트가 사라지면) 그림도 사라진다. 문항마다 따로 그린다
  const board = useDrawBoard()
  useEffect(() => {
    if (focusProblemId) document.getElementById(anchorId(focusProblemId))?.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [card.id, focusProblemId])

  // 문항 이동 바의 높이를 재서 문항의 scroll-margin 에 더한다 (진도별로 들어오면 바가 없어 0)
  const articleRef = useRef<HTMLElement>(null)
  const seqBarRef = useRef<HTMLDivElement>(null)
  const hasSeq = !!seqNav
  useLayoutEffect(() => {
    const article = articleRef.current
    const bar = seqBarRef.current
    if (!article) return
    if (!bar) {
      article.style.removeProperty('--case-seqbar-h')
      return
    }
    const update = () => article.style.setProperty('--case-seqbar-h', `${bar.offsetHeight}px`)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [hasSeq])

  // 레퍼런스 답안집과 같은 바: [← 목록으로] [‹ 이전 카드] [다음 카드 ›]. 없는 쪽 버튼은 그리지 않는다
  const nav = (
    <div className="flex flex-wrap items-center gap-2">
      {onBackToCases && (
        <button onClick={onBackToCases} className={`${navBtn} border-primary/40 text-primary`}>← 판례로 돌아가기</button>
      )}
      <button onClick={onBack} className={navBtn}>← 목록으로</button>
      {onPrev && <button onClick={onPrev} className={navBtn}>‹ 이전 카드</button>}
      {onNext && <button onClick={onNext} className={navBtn}>다음 카드 ›</button>}
    </div>
  )

  return (
    <article ref={articleRef} className="space-y-4">
      {nav}
      {/* 회차별로 들어왔을 때만. 앱 헤더·탭 줄 바로 밑에 붙어 스크롤해도 늘 보인다 (한 줄로 콤팩트하게) */}
      {seqNav && (
        <div
          ref={seqBarRef}
          className="sticky top-[var(--case-sticky-top,0px)] z-20 -mx-4 px-4 py-1.5 bg-background border-b border-border shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {seqNav.label} <span className="tabular-nums text-muted-foreground">({seqNav.pos}/{seqNav.total})</span>
            </span>
            <button onClick={seqNav.onPrev} disabled={!seqNav.onPrev} title="이전 문항 (←)" className={`${navBtn} shrink-0`}>
              ◀<span className="max-sm:hidden"> 이전 문항</span>
            </button>
            <button onClick={seqNav.onNext} disabled={!seqNav.onNext} title="다음 문항 (→)" className={`${navBtn} shrink-0`}>
              <span className="max-sm:hidden">다음 문항 </span>▶
            </button>
          </div>
        </div>
      )}
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
              className={`inline-flex items-center gap-1 text-[11px] rounded-md px-1.5 py-0.5 border hover:border-primary/60 hover:text-primary transition-colors ${
                p.stubFor ? 'border-dashed border-border text-muted-foreground' : 'border-border bg-muted text-foreground'
              }`}
            >
              <KindBadge kind={p.kind} />
              {problemLabel(p).replace(/^(변시|모의) /, '')} · {p.points}점
            </button>
          ))}
        </div>
      )}
      {card.problems.map((p) => (
        <ProblemSection key={p.id} p={p} active={p.id === focusProblemId} onJump={onJump} seq={seqNav} onBack={onBack} onSolve={onSolve} board={board} />
      ))}
      {card.notes.length > 0 && (
        <section className="bg-card border border-border rounded-xl px-4 py-3">
          <h2 className="text-xs font-semibold text-foreground mb-1.5">채점·출제 메모</h2>
          <ul className="list-disc pl-4 space-y-0.5 text-xs text-foreground/90">
            {card.notes.map((n, i) => <li key={i}><SafeHtml html={n} /></li>)}
          </ul>
        </section>
      )}
      {card.source && <p className="text-[10px] text-muted-foreground">출처: {card.source}</p>}
      {nav}
    </article>
  )
}
