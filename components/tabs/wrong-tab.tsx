'use client'

import { useState, useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { deleteWrongNote, saveWrongNotes } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { FilterChips } from '@/components/filter-chips'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const RISKS = ['★1', '★2', '★3', '★4', '★5']
const SORTS = ['날짜순', '위험도순'] as const

interface DetailModalProps {
  note: WrongNote
  onClose: () => void
}

function DetailModal({ note, onClose }: DetailModalProps) {
  const a = note.analysis
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">{note.question.subject}</span>
            {note.dominantCause && <CauseBadge cause={note.dominantCause} />}
            {a && <StarRating value={a.위험도} />}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* 문제 지문 */}
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">문제 지문</p>
            <p className="text-foreground leading-relaxed text-xs whitespace-pre-wrap">{note.question.passage}</p>
          </div>

          {/* 선지 */}
          <div className="space-y-1">
            {note.question.choices.map((c) => (
              <div
                key={c.label}
                className={`flex gap-2 p-2 rounded-lg text-xs border ${c.label === note.question.answer
                    ? 'border-emerald-600 bg-emerald-900/20 text-emerald-300'
                    : c.label === note.userAnswer
                      ? 'border-red-600 bg-red-900/20 text-red-300'
                      : 'border-border text-muted-foreground'
                  }`}
              >
                <span className="font-semibold shrink-0">{c.label}</span>
                <span>{c.text}</span>
                {c.label === note.question.answer && <span className="ml-auto shrink-0">✓ 정답</span>}
                {c.label === note.userAnswer && c.label !== note.question.answer && <span className="ml-auto shrink-0">✗ 내 답</span>}
              </div>
            ))}
          </div>

          {/* 해설 */}
          {note.question.explanation && (
            <div className="bg-muted rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
              <p className="text-foreground text-xs leading-relaxed">{note.question.explanation}</p>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            내 답: <span className="text-red-400 font-medium">{note.userAnswer}</span>{' '}
            정답: <span className="text-emerald-400 font-medium">{note.question.answer}</span>
            {note.status && <span className="ml-2 text-yellow-400">({note.status})</span>}
          </div>

          {/* AI 분석 */}
          {a ? (
            <>
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold text-primary mb-2">AI 오답 분석</p>
              </div>
              <Section label="핵심개념" value={a.핵심개념} />
              <Section label="관련조문" value={a.관련조문} />
              <Section label="오답원인 상세" value={a.원인상세} />
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1">오답 가설</p>
                <div className="space-y-1">
                  <p className="text-xs"><span className="text-red-300">가설A(개념부족):</span> {a.오답원인.가설A}</p>
                  <p className="text-xs"><span className="text-yellow-300">가설B(암기혼동):</span> {a.오답원인.가설B}</p>
                  <p className="text-xs"><span className="text-emerald-300">가설C(지문오독):</span> {a.오답원인.가설C}</p>
                  {a.오답원인.선학습적용실패 && (
                    <p className="text-xs"><span className="text-purple-300">선학습실패:</span> {a.오답원인.선학습적용실패}</p>
                  )}
                </div>
              </div>
              <Section label="개념요약" value={a.개념요약} />
              <Section label="혼동주의" value={a.혼동주의} />
              <Section label="D-1 체크포인트" value={a.체크포인트} />
            </>
          ) : (
            <p className="text-muted-foreground text-xs">분석 데이터 없음</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
      <p className="text-foreground leading-relaxed">{value}</p>
    </div>
  )
}

export function WrongTab({
  notes,
  onNotesChanged,
}: {
  notes: WrongNote[]
  onNotesChanged: () => void
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [risks, setRisks] = useState<string[]>([])
  const [sort, setSort] = useState<'날짜순' | '위험도순'>('날짜순')
  const [selected, setSelected] = useState<WrongNote | null>(null)

  const filtered = useMemo(() => {
    let list = [...notes]
    if (subjects.length) list = list.filter((n) => subjects.includes(n.question.subject))
    if (risks.length) {
      const levels = risks.map((r) => Number(r.replace('★', '')))
      list = list.filter((n) => {
        const risk = n.analysis?.위험도
        return risk !== undefined && risk !== null && levels.includes(Number(risk))
      })
    }
    if (sort === '날짜순') list.sort((a, b) => b.createdAt - a.createdAt)
    else list.sort((a, b) => (b.analysis?.위험도 ?? 0) - (a.analysis?.위험도 ?? 0))
    return list
  }, [notes, subjects, risks, sort])

  function del(id: string) {
    deleteWrongNote(id)
    onNotesChanged()
  }

  function delAll() {
    if (!confirm(`오답노트 ${notes.length}개를 모두 삭제할까요?`)) return
    saveWrongNotes([])
    onNotesChanged()
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <FilterChips options={SUBJECTS} selected={subjects} onChange={setSubjects} />
        <FilterChips options={RISKS} selected={risks} onChange={setRisks} />
        <div className="flex items-center justify-between">
          <FilterChips options={[...SORTS]} selected={[sort]} onChange={(v) => setSort((v[0] as typeof sort) ?? sort)} single />
          {notes.length > 0 && (
            <button onClick={delAll} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              전체 삭제
            </button>
          )}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground px-1">
        {filtered.length}개 표시 (전체 {notes.length}개)
      </p>

      {/* List */}
      {filtered.length === 0 && risks.length === 0 && subjects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          오답노트가 없습니다. CBT나 선학습 모드에서 문제를 풀어보세요.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          필터 조건에 맞는 오답이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((note) => (
            <div
              key={note.id}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelected(note)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground">{note.question.subject}</span>
                    <span className="text-xs text-muted-foreground">{note.question.year}년</span>
                    {note.dominantCause && <CauseBadge cause={note.dominantCause} />}
                    {note.analysis && <StarRating value={note.analysis.위험도} />}
                  </div>
                  {note.analysis?.핵심개념 && (
                    <p className="text-xs text-muted-foreground">{note.analysis.핵심개념}</p>
                  )}
                  <p className="text-sm text-foreground line-clamp-1">
                    {note.question.passage.slice(0, 70)}...
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(note.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); del(note.id) }}
                  className="text-muted-foreground hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <DetailModal note={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}