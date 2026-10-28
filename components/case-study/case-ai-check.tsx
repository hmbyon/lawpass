'use client'

import { useEffect, useRef, useState } from 'react'
import type { Problem } from '@/lib/caseStudy/types'
import { auth } from '@/lib/firebase'
import { getGeminiKey } from '@/lib/geminiKey'
import { isAiCheckStale, runAiCheck, type AiCheckItem, type AiCheckRecord, type AiVerdict } from '@/lib/caseStudy/aiCheck'
import { aiSummary, finalVerdict, setUserVerdict } from '@/lib/caseStudy/aiCheckView'

/**
 * 사례형 AI 점검(판례 취지·결론) 화면 조각 — 제출 후 모범답안(case-statute-answer)에 붙는다.
 * Gemini 는 'AI 점검' 버튼을 눌렀을 때만 부른다(마운트·제출 때 자동으로 부르지 않는다)
 */

const VERDICT: Record<AiVerdict, { sym: string; cls: string }> = {
  담김: { sym: '✓', cls: 'bg-emerald-500' },
  부분: { sym: '△', cls: 'bg-amber-400' },
  누락: { sym: '✕', cls: 'bg-red-500' },
  확인불가: { sym: '?', cls: 'bg-zinc-400' },
}
// 조문 점(원형)과 가르려고 둥근 사각형 + '판'/'결' 글자. 보이는 점은 작아도 누르는 자리는 34px(before 로 사방 10px 넓힌다)
const AI_DOT_BASE =
  "relative ml-0.5 inline-flex h-3.5 cursor-pointer select-none items-center gap-px rounded-[3px] px-0.5 align-middle text-[9px] font-bold leading-none text-white before:absolute before:-inset-2.5 before:content-['']"
const AI_DOT_MANUAL = 'outline outline-2 outline-offset-1 outline-foreground'
const KIND_CHAR = { case: '판', res: '결' }
const KIND_WORD = { case: '판례 취지', res: '결론' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 점 html. 클릭은 모범답안 상자가 data-ai 로 받는다 */
export function aiDotsHtml(keys: string[] | undefined, items: AiCheckItem[], record: AiCheckRecord | undefined): string {
  if (!keys || !record) return ''
  return keys
    .map((key) => {
      const r = record.items[key]
      const it = items.find((x) => x.key === key)
      if (!r || !it) return ''
      const v = finalVerdict(r)
      const title = `AI ${KIND_WORD[it.kind]} · ${v}${r.userVerdict ? ' (직접 고침)' : ''} — 눌러서 자세히`
      return `<button type="button" data-ai="${esc(key)}" title="${esc(title)}" aria-label="${esc(title)}" class="${AI_DOT_BASE} ${VERDICT[v].cls}${r.userVerdict ? ` ${AI_DOT_MANUAL}` : ''}">${KIND_CHAR[it.kind]}${VERDICT[v].sym}</button>`
    })
    .join('')
}

const BTN = 'text-xs border border-border rounded-lg px-2.5 py-1 transition-colors hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed'

/** 맨 위 AI 점검 줄: 버튼·안내·진행·오류·요약 */
export function AiCheckPanel({
  p, texts, clean, items, record, onChange, missingOnly, onMissingOnly,
}: {
  p: Problem
  texts: string[]
  clean: string[] // sanitize 를 거친 모범답안 블록 html — 항목 키가 화면 블록과 맞게 같은 것을 넘긴다
  items: AiCheckItem[]
  record?: AiCheckRecord
  onChange: (next: AiCheckRecord) => Promise<boolean>
  missingOnly: boolean
  onMissingOnly: (v: boolean) => void
}) {
  const uid = auth.currentUser?.uid ?? ''
  const hasKey = !!uid && !!getGeminiKey(uid)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ctl = useRef<AbortController | null>(null)
  // 화면을 닫으면 진행 중인 요청을 멈춘다
  useEffect(() => () => ctl.current?.abort(), [])

  async function run() {
    if (running || !uid) return
    setConfirming(false)
    setError('')
    setSaveFailed(false)
    setRunning(true)
    const c = new AbortController()
    ctl.current = c
    const r = await runAiCheck({ uid, problem: p, answers: texts, blockHtmls: clean, signal: c.signal })
    ctl.current = null
    setRunning(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    setSaveFailed(!(await onChange(r.record)))
  }

  if (items.length === 0) return null
  const stale = record ? isAiCheckStale(record, texts) : false
  const sum = record ? aiSummary(items, record) : null

  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">AI 점검</span>
        {running ? (
          <>
            <button disabled className={BTN}>점검 중…</button>
            <button onClick={() => ctl.current?.abort()} className={`${BTN} text-muted-foreground`}>취소</button>
          </>
        ) : confirming ? (
          <>
            <span className="text-amber-500">직접 고친 값이 초기화됩니다</span>
            <button onClick={run} className={BTN}>다시 점검</button>
            <button onClick={() => setConfirming(false)} className={`${BTN} text-muted-foreground`}>취소</button>
          </>
        ) : (
          <button
            onClick={() => (record ? setConfirming(true) : run())}
            disabled={!hasKey}
            className={BTN}
          >
            {record ? '다시 점검' : 'AI 점검'}
          </button>
        )}
        {record && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-foreground">
            <input type="checkbox" checked={missingOnly} onChange={(e) => onMissingOnly(e.target.checked)} className="accent-primary" />
            AI 빠진 것만 보기
          </label>
        )}
      </div>
      {!hasKey ? (
        <p className="text-muted-foreground">설정에서 Gemini API 키를 먼저 저장하세요</p>
      ) : (
        !record && <p className="text-muted-foreground">누르면 이 문항의 문제·내 답안·모범답안 문장이 Google Gemini로 전송됩니다.</p>
      )}
      {error && (
        <p className="flex flex-wrap items-center gap-2 text-red-400">
          {error}
          {hasKey && !running && (
            <button onClick={() => (record ? setConfirming(true) : run())} className="text-primary hover:underline">
              다시 시도
            </button>
          )}
        </p>
      )}
      {saveFailed && <p className="text-red-400">저장하지 못했습니다</p>}
      {record && stale && <p className="text-amber-500">점검한 뒤 내 답안이 바뀌었습니다. 지난 결과입니다 — 다시 점검하세요</p>}
      {record && sum && (
        <p className="text-foreground">
          판례 취지 담김 {sum.case.ok}/{sum.case.total} · 결론 담김 {sum.res.ok}/{sum.res.total} · 확인불가 {sum.unknown}
          <span className="ml-2 text-[10px] text-muted-foreground">
            {new Date(record.checkedAt).toLocaleString('ko-KR')} · {record.model}
          </span>
        </p>
      )}
    </div>
  )
}

/** 점을 누르면 여는 말풍선 — 판정·note·근거 문장, 직접 바꾸기와 되돌리기 */
export function AiPopover({
  at, itemKey, items, record, onChange, onClose,
}: {
  at: DOMRect
  itemKey: string
  items: AiCheckItem[]
  record: AiCheckRecord
  onChange: (next: AiCheckRecord) => Promise<boolean>
  onClose: () => void
}) {
  const r = record.items[itemKey]
  const it = items.find((x) => x.key === itemKey)
  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!r || !it) return null
  const v = finalVerdict(r)
  const W = 288
  const left = Math.max(8, Math.min(at.left, window.innerWidth - W - 8))
  const below = at.bottom + 8 + 220 < window.innerHeight
  const style = below ? { left, top: at.bottom + 6, width: W } : { left, bottom: window.innerHeight - at.top + 6, width: W }

  async function pick(next?: AiVerdict) {
    setSaveFailed(!(await onChange(setUserVerdict(record, itemKey, next))))
  }

  return (
    <>
      {/* 바깥을 누르면 닫는다 */}
      <button type="button" aria-label="닫기" onClick={onClose} className="fixed inset-0 z-[60] cursor-default" />
      <div role="dialog" style={style} className="fixed z-[61] space-y-2 rounded-xl border border-border bg-card p-3 text-xs shadow-xl">
        <div className="flex items-center gap-2">
          <span className={`rounded-[3px] px-1 py-0.5 text-[10px] font-bold text-white ${VERDICT[v].cls}`}>
            {KIND_CHAR[it.kind]}{VERDICT[v].sym}
          </span>
          <span className="font-semibold text-foreground">{KIND_WORD[it.kind]} · {v}</span>
          {r.userVerdict && <span className="text-muted-foreground">(직접 고침 · AI: {r.verdict})</span>}
          <button onClick={onClose} aria-label="닫기" className="ml-auto text-base leading-none text-muted-foreground hover:text-foreground">×</button>
        </div>
        {r.note && <p className="text-foreground/90">{r.note}</p>}
        {r.evidence && (
          <blockquote className="border-l-2 border-primary pl-2 text-muted-foreground">{r.evidence}</blockquote>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {(['담김', '부분', '누락'] as const).map((x) => (
            <button
              key={x}
              onClick={() => pick(x)}
              className={`min-h-8 rounded-lg border px-2.5 ${v === x ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {VERDICT[x].sym} {x}
            </button>
          ))}
          {r.userVerdict && (
            <button onClick={() => pick(undefined)} className="min-h-8 px-1 text-primary hover:underline">
              자동 판정으로 되돌리기
            </button>
          )}
        </div>
        {saveFailed && <p className="text-red-400">저장하지 못했습니다</p>}
      </div>
    </>
  )
}
