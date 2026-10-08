'use client'

import { useMemo, useState } from 'react'
import type { Subject, WrongNote } from '@/lib/types'
import { FilterChips } from '@/components/filter-chips'
import { WrongNoteDetailModal } from '@/components/wrong-note-detail'
import { confusionPoints, type ConfusionPoint } from '@/lib/confusionPoints'
import { dismissConfusion } from '@/lib/store'
import { resolveSubChoices } from '@/lib/subChoices'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const NO_UNIT = '단원 미지정'

interface Entry {
  note: WrongNote
  points: ConfusionPoint[]
}

function stemOf(note: WrongNote): string {
  const q = note.question
  const text = resolveSubChoices(q)?.stem ?? q.passage
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * D-1 암기장의 "헷갈린 곳 모아보기".
 * 내가 헷갈림/찍음으로 짚었거나 채점에서 갈린 보기·선지만 과목 → 단원별로 한 줄씩 모은다.
 * 한 줄을 누르면 오답노트와 같은 상세 창(문제 전체·해설·내 표시)이 뜬다
 */
export function ConfusionReview({
  notes,
  onNotesChanged,
  isGeneral,
}: {
  notes: WrongNote[]
  onNotesChanged: () => void
  isGeneral: boolean
}) {
  const [filterSubjects, setFilterSubjects] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const entries = useMemo<Entry[]>(
    () =>
      notes
        .filter((n) => !n.confusionDismissed)
        .map((note) => ({ note, points: confusionPoints(note) }))
        .filter((e) => e.points.length > 0),
    [notes]
  )
  const availableSubjects = useMemo(
    () => Array.from(new Set(entries.map((e) => e.note.question.subject as string))),
    [entries]
  )
  const subjectOrder: string[] = isGeneral ? [...availableSubjects].sort((a, b) => a.localeCompare(b)) : SUBJECTS

  // 과목 → 단원 → 문제(연도 최신순, 같은 해는 번호순)
  const grouped = useMemo(() => {
    const out: { subject: string; units: { unit: string; items: Entry[] }[] }[] = []
    for (const subject of subjectOrder) {
      if (filterSubjects.length && !filterSubjects.includes(subject)) continue
      const inSubject = entries.filter((e) => e.note.question.subject === subject)
      if (inSubject.length === 0) continue
      const byUnit = new Map<string, Entry[]>()
      for (const e of inSubject) {
        const unit = e.note.question.unit?.trim() || NO_UNIT
        byUnit.set(unit, [...(byUnit.get(unit) ?? []), e])
      }
      const units = Array.from(byUnit.entries())
        .sort(([a], [b]) => (a === NO_UNIT ? 1 : b === NO_UNIT ? -1 : a.localeCompare(b, 'ko')))
        .map(([unit, items]) => ({
          unit,
          items: [...items].sort((x, y) => y.note.question.year - x.note.question.year || x.note.question.no - y.note.question.no),
        }))
      out.push({ subject, units })
    }
    return out
  }, [entries, filterSubjects, subjectOrder])

  const shown = grouped.flatMap((g) => g.units.flatMap((u) => u.items))
  const shownPoints = shown.reduce((n, e) => n + e.points.length, 0)
  const openNote = notes.find((n) => n.id === openId) ?? null

  // 지워도 오답노트의 문제는 남는다 — 이 목록에서만 가린다
  function removeFromList(ids: string[], what: string) {
    if (ids.length === 0) return
    if (!confirm(`${what}을(를) 헷갈린 곳 목록에서 지울까요?\n오답노트의 문제와 분석·메모는 그대로 남고, 다시 틀리거나 헷갈림으로 표시하면 목록에 다시 올라와요.`)) return
    dismissConfusion(ids)
    setCheckedIds(new Set())
    setSelectMode(false)
    onNotesChanged()
  }
  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm max-w-md mx-auto space-y-2">
        <div className="text-4xl">🤔</div>
        <p>아직 모아 볼 헷갈린 곳이 없어요.</p>
        <p className="text-xs">풀면서 헷갈림/찍음으로 표시하거나, 틀린 문제에서 내 답과 정답이 갈린 보기·선지가 여기 모여요.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <p className="text-xs text-muted-foreground px-1">
          헷갈린 곳 {shownPoints}개 · 문제 {shown.length}개
        </p>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          🖨️ 인쇄
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 no-print">
        <FilterChips options={subjectOrder} selected={filterSubjects} onChange={setFilterSubjects} available={availableSubjects} />
        <div className="flex items-center justify-end gap-3 pt-3 mt-3 border-t border-border">
          <button
            onClick={() => {
              setSelectMode((v) => !v)
              setCheckedIds(new Set())
            }}
            className={`text-xs whitespace-nowrap transition-colors ${selectMode ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {selectMode ? '선택 취소' : '선택 삭제'}
          </button>
          <button
            onClick={() => removeFromList(shown.map((e) => e.note.id), `표시 중인 ${shown.length}문제`)}
            className="text-xs whitespace-nowrap text-red-400 hover:text-red-300 transition-colors"
          >
            전체 삭제
          </button>
        </div>
        {selectMode && (
          <div className="flex items-center justify-end gap-3 pt-2 mt-2 border-t border-border">
            <button
              onClick={() => setCheckedIds(checkedIds.size === shown.length ? new Set() : new Set(shown.map((e) => e.note.id)))}
              className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors"
            >
              {checkedIds.size === shown.length ? '전체 해제' : '전체 선택'}
            </button>
            <button
              onClick={() => removeFromList(Array.from(checkedIds), `선택한 ${checkedIds.size}문제`)}
              disabled={checkedIds.size === 0}
              className="text-xs whitespace-nowrap text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              선택 삭제 ({checkedIds.size})
            </button>
          </div>
        )}
      </div>

      {grouped.map(({ subject, units }) => (
        <section key={subject} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold text-primary px-2">{subject}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {units.map(({ unit, items }) => (
            <div key={unit} className="space-y-1.5">
              <p className="text-xs font-semibold text-foreground px-1">
                {unit} <span className="font-normal text-muted-foreground">· {items.length}문제</span>
              </p>
              {items.map(({ note, points }) => (
                <div key={note.id} className="relative break-inside-avoid">
                <button
                  onClick={() => (selectMode ? toggleChecked(note.id) : setOpenId(note.id))}
                  className={`w-full text-left bg-card border rounded-xl px-3 py-2.5 space-y-1.5 hover:bg-muted/30 transition-colors ${
                    selectMode && checkedIds.has(note.id) ? 'border-primary ring-2 ring-primary' : 'border-border'
                  } ${selectMode && !checkedIds.has(note.id) ? 'opacity-70 hover:opacity-100' : ''}`}
                >
                  <p className="text-[11px] text-muted-foreground line-clamp-1 pr-6">
                    {selectMode && <span className="mr-1">{checkedIds.has(note.id) ? '☑' : '☐'}</span>}
                    {note.question.year > 0 ? `${note.question.year}년 ` : ''}
                    {stemOf(note)}
                  </p>
                  {points.map((p) => (
                    <div key={p.key} className="flex gap-2 items-start text-xs">
                      <span className="font-semibold text-primary shrink-0">{p.label}{p.kind === '보기' ? '.' : ''}</span>
                      <span className="flex-1 min-w-0 text-foreground leading-relaxed line-clamp-2">{p.text}</span>
                      <span className="shrink-0 flex flex-col items-end gap-0.5 text-[11px]">
                        {p.diff && <span className="font-medium text-red-600 dark:text-red-400">✗ 갈림</span>}
                        {p.confused && (
                          <span className="text-amber-600 dark:text-amber-400">{note.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </button>
                {/* 오른쪽 위 ✕: 이 문제만 목록에서 지운다(오답노트는 그대로) */}
                {!selectMode && (
                  <button
                    onClick={() => removeFromList([note.id], '이 문제')}
                    aria-label="헷갈린 곳 목록에서 지우기"
                    title="목록에서 지우기 (오답노트는 그대로)"
                    className="no-print absolute top-1.5 right-2 text-muted-foreground hover:text-foreground text-base leading-none px-1"
                  >
                    ×
                  </button>
                )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}

      {shown.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">선택한 과목에는 헷갈린 곳이 없어요.</div>
      )}

      {openNote && (
        <WrongNoteDetailModal note={openNote} onClose={() => setOpenId(null)} onMemoSaved={onNotesChanged} isGeneral={isGeneral} />
      )}
    </div>
  )
}
