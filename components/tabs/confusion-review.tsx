'use client'

import { useMemo, useState } from 'react'
import type { Subject, WrongNote } from '@/lib/types'
import { FilterChips } from '@/components/filter-chips'
import { WrongNoteDetailModal } from '@/components/wrong-note-detail'
import { confusionPoints, type ConfusionPoint } from '@/lib/confusionPoints'
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

  const entries = useMemo<Entry[]>(
    () => notes.map((note) => ({ note, points: confusionPoints(note) })).filter((e) => e.points.length > 0),
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
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
        >
          🖨️ 인쇄
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 no-print">
        <FilterChips options={subjectOrder} selected={filterSubjects} onChange={setFilterSubjects} available={availableSubjects} />
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
                <button
                  key={note.id}
                  onClick={() => setOpenId(note.id)}
                  className="w-full text-left bg-card border border-border rounded-xl px-3 py-2.5 space-y-1.5 hover:bg-muted/30 transition-colors break-inside-avoid"
                >
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
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
