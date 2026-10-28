'use client'

import { useMemo, useState } from 'react'
import type { Problem } from '@/lib/caseStudy/types'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'
import {
  answerRefs, insertAfterLawMarks, judgeStatutes, modelStatutes, nextStatus, statuteLabel,
  type StatuteCheckRecord, type StatuteStatus,
} from '@/lib/caseStudy/statuteCheck'

// 모범답안 블록의 들여쓰기 — case-card-view 의 AnswerBlock 과 같다
const INDENT: Record<string, string> = { l2: 'pl-3', l3: 'pl-6' }

// 색만으로 가르지 않게 기호도 넣는다. 직접 고친 점은 테두리로 가른다
const DOT: Record<StatuteStatus, { sym: string; word: string; cls: string }> = {
  ok: { sym: '✓', word: '썼음', cls: 'bg-emerald-500' },
  partial: { sym: '△', word: '부분', cls: 'bg-amber-400' },
  missing: { sym: '✕', word: '없음', cls: 'bg-red-500' },
}
const DOT_BASE =
  'ml-0.5 inline-flex h-3.5 w-3.5 cursor-pointer select-none items-center justify-center rounded-full align-middle text-[9px] font-bold leading-none text-white'
const DOT_MANUAL = 'outline outline-2 outline-offset-1 outline-foreground'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 제출 후 모범답안 + 조문 점검. 조문 표시(mark.law) 뒤마다 상태 점(✓ 썼음 / △ 부분 / ✕ 없음)을 달고,
 * 제목마다 '조문 3/5', 맨 위에 문항 요약과 '빠진 조문만 보기'를 둔다.
 * 점을 누르면 썼음 → 부분 → 없음 순으로 직접 고친다. 자동 판정과 같은 값으로 돌아오면 직접 고친 표시가 풀린다.
 * 자동 판정은 늘 내 답안에서 다시 계산하고, 직접 고친 값만 기록(record.manual)에서 읽는다
 */
export function CaseStatuteAnswer({
  p, texts, record, onChange,
}: {
  p: Problem
  texts: string[] // 이 문항의 내 답안 칸들
  record?: StatuteCheckRecord
  onChange: (next: StatuteCheckRecord) => void
}) {
  const [missingOnly, setMissingOnly] = useState(false)
  const blocks = p.answer?.blocks ?? []
  const clean = useMemo(() => blocks.map((b) => sanitizeCaseHtml(b.html)), [blocks])
  const model = useMemo(() => modelStatutes(clean), [clean])
  const auto = useMemo(() => judgeStatutes(model.items, answerRefs(texts)), [model, texts])
  const manual = record?.manual ?? {}
  const status = (key: string): StatuteStatus => manual[key] ?? auto[key] ?? 'missing'

  // 제목마다 그 아래(다음 같은 단계 이상의 제목 전까지) 블록 범위
  const sectionEnd = blocks.map((b, i) => {
    if (b.t !== 'h1' && b.t !== 'h2') return i + 1
    let j = i + 1
    while (j < blocks.length && !(blocks[j].t === 'h1' || (b.t === 'h2' && blocks[j].t === 'h2'))) j++
    return j
  })
  const keysIn = (from: number, to: number) => [...new Set(model.marks.slice(from, to).flat(2))]

  const counts = { ok: 0, partial: 0, missing: 0 }
  for (const { key } of model.items) counts[status(key)]++
  const manualCount = Object.keys(manual).filter((k) => k in auto).length

  function cycle(key: string) {
    const next = nextStatus(status(key))
    const m = { ...manual }
    if (next === auto[key]) delete m[key]
    else m[key] = next
    onChange({ auto, manual: m })
  }

  const labelOf = new Map(model.items.map((x) => [x.key, statuteLabel(x.ref)]))
  const dots = (keys: string[]) =>
    keys
      .map((key) => {
        const s = status(key)
        const d = DOT[s]
        const mine = key in manual
        const title = `${labelOf.get(key) ?? ''} · ${d.word}${mine ? ' (직접 고침)' : ''} — 눌러서 바꾸기`
        return `<button type="button" data-statute="${esc(key)}" title="${esc(title)}" aria-label="${esc(title)}" class="${DOT_BASE} ${d.cls}${mine ? ` ${DOT_MANUAL}` : ''}">${d.sym}</button>`
      })
      .join('')

  if (blocks.length === 0) return <p className="text-xs text-muted-foreground">모범답안이 없습니다</p>

  return (
    <div>
      {model.items.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs">
          <span className="font-semibold text-foreground">조문 점검</span>
          <span className="text-emerald-500">✓ 썼음 {counts.ok}</span>
          <span className="text-amber-500">△ 부분 {counts.partial}</span>
          <span className="text-red-400">✕ 없음 {counts.missing}</span>
          {manualCount > 0 && (
            <button onClick={() => onChange({ auto, manual: {} })} className="text-primary hover:underline">
              직접 고친 {manualCount}개 되돌리기
            </button>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-foreground">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} className="accent-primary" />
            빠진 조문만 보기
          </label>
        </div>
      ) : (
        <p className="mb-3 text-[11px] text-muted-foreground">이 모범답안에는 점검할 조문 표시가 없습니다</p>
      )}

      {/* 점은 html 안에 넣고 여기서 한 번에 받는다(조문 표시 자체에는 아무 동작도 걸지 않는다) */}
      <div
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-statute]')
          if (el?.dataset.statute) cycle(el.dataset.statute)
        }}
      >
        {blocks.map((b, i) => {
          const sectionKeys = keysIn(i, sectionEnd[i])
          if (missingOnly && !sectionKeys.some((k) => status(k) === 'missing')) return null
          const html = insertAfterLawMarks(clean[i], (li) => dots(model.marks[i][li] ?? []))
          const body = <span dangerouslySetInnerHTML={{ __html: html }} />
          const indent = b.lv ? INDENT[b.lv] : ''
          const pts = b.pts && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{b.pts}</span>
          const summary = sectionKeys.length > 0 && (
            <span className="ml-1.5 text-[10px] font-normal tabular-nums text-muted-foreground">
              조문 {sectionKeys.filter((k) => status(k) === 'ok').length}/{sectionKeys.length}
            </span>
          )
          if (b.t === 'h1') {
            return (
              <h4 key={i} className={`mt-4 first:mt-0 text-sm font-bold text-foreground ${indent}`}>
                {body}
                {pts}
                {summary}
              </h4>
            )
          }
          if (b.t === 'h2') {
            return (
              <h5 key={i} className={`mt-2.5 text-[13px] font-semibold text-foreground ${indent}`}>
                {body}
                {pts}
                {summary}
              </h5>
            )
          }
          return (
            <p key={i} className={`mt-1 text-[13px] leading-relaxed text-foreground/90 ${indent}`}>
              {body}
            </p>
          )
        })}
        {missingOnly && counts.missing === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">빠진 조문이 없습니다</p>
        )}
      </div>
      {p.answer?.source && <p className="mt-3 text-[10px] text-muted-foreground">{p.answer.source}</p>}
    </div>
  )
}
