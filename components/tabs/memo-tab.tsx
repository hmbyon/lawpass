'use client'

import { useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { StarRating } from '@/components/star-rating'
import { CauseBadge } from '@/components/cause-badge'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']

export function MemoTab({ notes }: { notes: WrongNote[] }) {
  const grouped = useMemo(() => {
    const high = notes.filter((n) => (n.analysis?.위험도 ?? 0) >= 3)
    const map = new Map<Subject, WrongNote[]>()
    for (const s of SUBJECTS) {
      const items = high.filter((n) => n.question.subject === s)
      if (items.length > 0) map.set(s, items)
    }
    return map
  }, [notes])

  function handlePrint() {
    window.print()
  }

  if (grouped.size === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm max-w-md mx-auto space-y-2">
        <div className="text-4xl">📚</div>
        <p>위험도 ★3 이상 오답이 없습니다.</p>
        <p className="text-xs">CBT나 선학습 모드에서 문제를 풀면 자동으로 생성됩니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between no-print">
        <div>
          <h2 className="text-lg font-bold text-foreground">D-1 암기장</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            위험도 ★3 이상 항목 {Array.from(grouped.values()).flat().length}개
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          🖨️ 인쇄
        </button>
      </div>

      {Array.from(grouped.entries()).map(([subject, items]) => (
        <div key={subject} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold text-primary px-2">{subject}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {items.map((note) => (
            <MemoCard key={note.id} note={note} />
          ))}
        </div>
      ))}
    </div>
  )
}

function MemoCard({ note }: { note: WrongNote }) {
  const a = note.analysis
  if (!a) return null

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3 text-sm break-inside-avoid">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {note.dominantCause && <CauseBadge cause={note.dominantCause} />}
          <StarRating value={a.위험도} />
        </div>
        <span className="text-xs text-muted-foreground">{note.question.year}년 {note.question.examType}</span>
      </div>

      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground font-medium">핵심개념</p>
        <p className="font-semibold text-foreground">{a.핵심개념}</p>
      </div>

      <div className="bg-muted rounded-lg p-3 space-y-0.5">
        <p className="text-xs text-muted-foreground font-medium">관련조문</p>
        <p className="text-foreground text-xs">{a.관련조문}</p>
      </div>

      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground font-medium">개념요약 (3줄)</p>
        <p className="text-foreground leading-relaxed whitespace-pre-line">{a.개념요약}</p>
      </div>

      <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 space-y-0.5">
        <p className="text-xs text-yellow-400 font-medium">⚠ 혼동주의</p>
        <p className="text-foreground text-xs leading-relaxed">{a.혼동주의}</p>
      </div>

      <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-3 space-y-0.5">
        <p className="text-xs text-emerald-400 font-medium">✓ 체크포인트</p>
        <p className="text-foreground text-xs leading-relaxed">{a.체크포인트}</p>
      </div>
    </div>
  )
}
