'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { fetchAllRecordCards } from '@/lib/firebaseServices/caseStudy'
import { fetchDrillResults, saveDrillResult } from '@/lib/firebaseServices/recordDrill'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import type { RecordCard } from '@/lib/record/cardStorage'
import {
  applyResult, drillStats, examChipsOfCards, filterCards, orderCards,
  type DrillMark, type DrillResults,
} from '@/lib/record/drillProgress'
import { NoteTable, chip, type TableBlock } from '@/components/record/notes-viewer'

const KINDS = ['변시', '모의'] as const
const MARKS: { id: DrillMark; label: string }[] = [
  { id: 'o', label: '맞음' },
  { id: 'h', label: '아쉬움' },
  { id: 'x', label: '틀림' },
]
const btn = 'rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:border-primary/50 disabled:opacity-40'
const primaryBtn = 'rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold disabled:opacity-40'

// 정답 표 — 정리본 열람의 표(NoteTable)를 그대로 쓴다. 블록 객체를 카드마다 고정해 행 높이 맞춤이 매 렌더 다시 돌지 않게 한다
function AnswerTable({ card }: { card: RecordCard }) {
  const block = useMemo<TableBlock>(() => ({ t: 'table', rows: card.rows }), [card])
  return <NoteTable b={block} />
}

// 정리본과 같은 sanitizer 출력만 넣는다
function NoteHtml({ html }: { html: string }) {
  return <div className="record-note text-sm" dangerouslySetInnerHTML={{ __html: sanitizeNote(html ?? '') }} />
}

/**
 * 기록형 문제 풀기 — 민사 기출 청구취지·청구원인 카드. 앞면(당사자·청구 제목) → 직접 써 보기 → 정답 표 → 자가채점.
 * 결과는 카드마다 본인 계정에 저장해, 틀린·아쉬운 카드만 다시 풀 수 있게 한다
 */
export function DrillView({ isAdmin }: { isAdmin: boolean }) {
  const [cards, setCards] = useState<RecordCard[] | undefined>(undefined) // undefined = 불러오는 중
  const [loadError, setLoadError] = useState('')
  const [results, setResults] = useState<DrillResults>({})
  const [saveError, setSaveError] = useState('')

  // 시작 화면 조건
  const [kinds, setKinds] = useState<string[]>([])
  const [exams, setExams] = useState<string[]>([])
  const [wrongOnly, setWrongOnly] = useState(false)
  const [shuffle, setShuffle] = useState(false)

  // 풀이 중인 묶음 (카드 id 순서·위치·정답 펼침·이번 묶음 채점)
  const [session, setSession] = useState<{ ids: string[]; pos: number; revealed: boolean; marks: Record<string, DrillMark> } | null>(null)
  const [text, setText] = useState('')

  const load = useCallback(() => {
    setCards(undefined)
    setLoadError('')
    const mode = getAppMode()
    const uid = auth.currentUser?.uid
    Promise.all([fetchAllRecordCards(mode), uid ? fetchDrillResults(uid, mode) : Promise.resolve({})])
      .then(([docs, res]) => {
        setCards(docs.flatMap((d) => d.cards ?? []))
        setResults(res)
      })
      .catch((e: Error) => setLoadError(e.message || '불러오지 못했습니다'))
  }, [])
  useEffect(load, [load])

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards])
  const examChips = useMemo(() => examChipsOfCards(cards ?? [], kinds), [cards, kinds])
  const chosen = useMemo(
    () => filterCards(cards ?? [], { kinds, exams: exams.filter((e) => examChips.includes(e)), wrongOnly }, results),
    [cards, kinds, exams, examChips, wrongOnly, results]
  )
  const stats = useMemo(() => drillStats(cards ?? [], results), [cards, results])

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }
  function start(list: RecordCard[]) {
    if (list.length === 0) return
    setSession({ ids: orderCards(list, shuffle, Date.now()).map((c) => c.id), pos: 0, revealed: false, marks: {} })
    setText('')
    window.scrollTo({ top: 0 })
  }
  function grade(card: RecordCard, mark: DrillMark) {
    const next = applyResult(results, card.id, mark, Date.now())
    setResults(next)
    setSaveError('')
    const uid = auth.currentUser?.uid
    if (uid) saveDrillResult(uid, getAppMode(), card.id, next[card.id]).catch(() => setSaveError('결과를 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.'))
    setSession((s) => (s ? { ...s, pos: s.pos + 1, revealed: false, marks: { ...s.marks, [card.id]: mark } } : s))
    setText('')
    window.scrollTo({ top: 0 })
  }

  if (loadError) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-2">
        <p>카드를 불러오지 못했습니다 ({loadError})</p>
        <button onClick={load} className="text-primary hover:underline">다시 시도</button>
      </div>
    )
  }
  if (cards === undefined) return <p className="text-xs text-muted-foreground">카드를 불러오는 중…</p>
  if (cards.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground">
        {isAdmin ? '가져오기에서 카드 파일을 올려 주세요' : '준비 중이에요'}
      </div>
    )
  }

  // ── 풀이 화면 ─────────────────────────────────────────────
  if (session) {
    const { ids, pos, revealed, marks } = session
    if (pos >= ids.length) {
      const tally = { o: 0, h: 0, x: 0 }
      for (const m of Object.values(marks)) tally[m]++
      const again = ids.filter((id) => marks[id] === 'h' || marks[id] === 'x').map((id) => byId.get(id)).filter((c): c is RecordCard => !!c)
      return (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">다 풀었어요</p>
          <p className="text-sm text-foreground tabular-nums">
            맞음 {tally.o} · 아쉬움 {tally.h} · 틀림 {tally.x}
          </p>
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={primaryBtn} disabled={again.length === 0} onClick={() => start(again)}>
              틀린 카드만 다시 풀기 ({again.length})
            </button>
            <button className={btn} onClick={() => setSession(null)}>처음으로</button>
          </div>
        </div>
      )
    }
    const card = byId.get(ids[pos])
    if (!card) {
      // 카드가 다시 올라와 id 가 사라진 경우 — 건너뛴다
      return (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2 text-xs text-muted-foreground">
          <p>이 카드를 찾지 못했습니다</p>
          <button className={btn} onClick={() => setSession({ ...session, pos: pos + 1, revealed: false })}>다음</button>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{pos + 1} / {ids.length}</span>
          <span className="px-2 py-0.5 rounded-full border border-border bg-muted">{card.label}</span>
          {card.note && <span className="text-[11px] text-amber-500">{card.note}</span>}
          <button className="ml-auto hover:text-foreground" onClick={() => setSession(null)}>그만 풀기</button>
        </div>

        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          {card.parties && <NoteHtml html={card.parties} />}
          <p className="text-sm font-semibold text-foreground">{card.title}</p>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="청구취지·청구원인을 적어 보세요 (저장되지 않습니다)"
          className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/50"
        />

        {!revealed ? (
          <div className="flex gap-2">
            <button className={btn} disabled={pos === 0} onClick={() => setSession({ ...session, pos: pos - 1, revealed: false })}>
              ← 이전 카드
            </button>
            <button className={`${primaryBtn} flex-1`} onClick={() => setSession({ ...session, revealed: true })}>
              정답 보기
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-xl p-3 record-note">
              <AnswerTable card={card} />
              {card.tailH && (
                <div className="pt-2 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">공통 청구취지(소송비용 등)</p>
                  <NoteHtml html={card.tailH} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btn} disabled={pos === 0} onClick={() => setSession({ ...session, pos: pos - 1, revealed: false })}>
                ← 이전 카드
              </button>
              {MARKS.map((m) => (
                <button
                  key={m.id}
                  className={`${btn} flex-1 ${marks[card.id] === m.id ? 'border-primary text-primary' : ''}`}
                  onClick={() => grade(card, m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          </div>
        )}
      </div>
    )
  }

  // ── 시작 화면 ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground tabular-nums">
        맞음 {stats.o} · 아쉬움 {stats.h} · 틀림 {stats.x} · 안 푼 {stats.none}
      </p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="종류">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => setKinds(toggle(kinds, k))} className={chip(kinds.includes(k))}>
            {k}
          </button>
        ))}
      </div>

      {examChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="회차">
          {examChips.map((k) => (
            <button key={k} type="button" aria-pressed={exams.includes(k)} onClick={() => setExams(toggle(exams, k))} className={chip(exams.includes(k))}>
              {k}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={wrongOnly} onClick={() => setWrongOnly(!wrongOnly)} className={chip(wrongOnly)}>
          틀린·아쉬운 카드만
        </button>
        <button type="button" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)} className={chip(shuffle)}>
          섞어서 풀기
        </button>
      </div>

      <button className={`${primaryBtn} w-full`} disabled={chosen.length === 0} onClick={() => start(chosen)}>
        {chosen.length > 0 ? `카드 ${chosen.length}장 풀기` : '조건에 맞는 카드가 없습니다'}
      </button>
    </div>
  )
}
