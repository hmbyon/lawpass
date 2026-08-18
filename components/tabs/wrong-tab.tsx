'use client'

import { useState, useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { deleteWrongNote, saveWrongNotes, updateWrongNoteMemo, getRiskLevel } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { FilterChips } from '@/components/filter-chips'
import { getAppMode } from '@/lib/appMode'
import { loadHighlights, renderHighlighted, saveHighlights } from '@/lib/highlights'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const RISKS = ['★1', '★2', '★3', '★4', '★5']
const SORTS = ['날짜순', '위험도순'] as const

interface DetailModalProps {
  note: WrongNote
  onClose: () => void
  onMemoSaved: () => void
  isGeneral: boolean
}

function DetailModal({ note, onClose, onMemoSaved, isGeneral }: DetailModalProps) {
  const a = note.analysis
  const [memo, setMemo] = useState(note.memo ?? '')
  const [memoSaved, setMemoSaved] = useState(false)
  const [highlights, setHighlights] = useState(() => loadHighlights(note.question.id))

  function saveMemo() {
    updateWrongNoteMemo(note.id, memo)
    setMemoSaved(true)
    setTimeout(() => setMemoSaved(false), 1500)
    onMemoSaved()
  }

  function removeHighlight(id: string) {
    const next = highlights.filter((h) => h.id !== id)
    setHighlights(next)
    saveHighlights(note.question.id, next)
    onMemoSaved()
  }

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
            {!isGeneral && note.dominantCause && <CauseBadge cause={note.dominantCause} />}
            {note.isBookmarked && note.wrongCount === 0 && (
              <span className="text-xs text-yellow-400">📌 북마크</span>
            )}
            {note.wrongCount > 0 && <StarRating value={getRiskLevel(note)} />}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* 문제 지문 */}
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">문제 지문</p>
            <p className="text-foreground leading-relaxed text-xs whitespace-pre-wrap">
              {renderHighlighted(note.question.passage, 'passage', highlights, removeHighlight)}
            </p>
          </div>

          {/* 선지 */}
          <div className="space-y-1">
            {note.question.choices.map((c) => (
              <div key={c.label}>
                <div
                  className={`flex gap-2 p-2 rounded-lg text-xs border ${c.label === note.question.answer
                      ? 'border-emerald-600 bg-emerald-900/20 text-emerald-300'
                      : c.label === note.userAnswer
                        ? 'border-red-600 bg-red-900/20 text-red-300'
                        : 'border-border text-muted-foreground'
                    }`}
                >
                  <span className="font-semibold shrink-0">{c.label}</span>
                  <span className="flex-1">
                    {renderHighlighted(c.text, `choice_${c.label}`, highlights, removeHighlight)}
                  </span>
                  {c.label === note.question.answer && <span className="ml-auto shrink-0">✓ 정답</span>}
                  {c.label === note.userAnswer && c.label !== note.question.answer && <span className="ml-auto shrink-0">✗ 내 답</span>}
                </div>
                {note.choiceMemos?.[c.label] && (
                  <div className="ml-2 mt-0.5 px-2 py-1 bg-yellow-900/20 border-l-2 border-yellow-500/50 rounded-r text-xs text-yellow-300">
                    📌 {note.choiceMemos[c.label]}
                  </div>
                )}
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
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-primary">AI 오답 분석 (최근)</p>
                  {note.wrongCount > 1 && (
                    <span className="text-xs text-muted-foreground">총 {note.wrongCount}회 틀림</span>
                  )}
                </div>
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

              {/* 오답 히스토리 */}
              {note.analysisHistory && note.analysisHistory.length > 1 && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">오답 히스토리</p>
                  {note.analysisHistory.map((h, idx) => (
                    <div key={idx} className="bg-muted rounded-lg p-2.5 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">{idx + 1}회차</p>
                      <div className="flex gap-2 flex-wrap">
                        {h.오답원인.가설A.length > h.오답원인.가설B.length && h.오답원인.가설A.length > h.오답원인.가설C.length && (
                          <span className="text-[10px] text-red-300 bg-red-900/20 px-1.5 py-0.5 rounded">개념부족</span>
                        )}
                        {h.오답원인.가설B.length > h.오답원인.가설A.length && h.오답원인.가설B.length > h.오답원인.가설C.length && (
                          <span className="text-[10px] text-yellow-300 bg-yellow-900/20 px-1.5 py-0.5 rounded">암기혼동</span>
                        )}
                        {h.오답원인.가설C.length >= h.오답원인.가설A.length && h.오답원인.가설C.length >= h.오답원인.가설B.length && (
                          <span className="text-[10px] text-emerald-300 bg-emerald-900/20 px-1.5 py-0.5 rounded">지문오독</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{h.원인상세}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-xs">분석 데이터 없음</p>
          )}

          {/* 내 메모 */}
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">📝 내 메모</p>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="이 문제에 대한 메모를 남겨보세요..."
              rows={3}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <button
              onClick={saveMemo}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-all"
            >
              {memoSaved ? '✓ 저장됨' : '메모 저장'}
            </button>
          </div>
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
  const [appMode] = useState(() => getAppMode())
  const isGeneral = appMode === 'general'

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [generalSubjects, setGeneralSubjects] = useState<string[]>([])
  const [risks, setRisks] = useState<string[]>([])
  const [sort, setSort] = useState<'날짜순' | '위험도순'>('날짜순')
  const [selected, setSelected] = useState<WrongNote | null>(null)

  // 선택삭제 관련 상태
  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const activeSubjects: string[] = isGeneral ? generalSubjects : subjects

  const availableSubjects = useMemo(() => {
    return Array.from(new Set(notes.map((n) => n.question.subject as string))).sort((a, b) => a.localeCompare(b))
  }, [notes])

  const filtered = useMemo(() => {
    let list = [...notes]
    if (activeSubjects.length) list = list.filter((n) => activeSubjects.includes(n.question.subject))
    if (risks.length) {
      const levels = risks.map((r) => Number(r.replace('★', '')))
      list = list.filter((n) => levels.includes(getRiskLevel(n)))
    }
    if (sort === '날짜순') list.sort((a, b) => b.createdAt - a.createdAt)
    else list.sort((a, b) => getRiskLevel(b) - getRiskLevel(a))
    return list
  }, [notes, activeSubjects, risks, sort])

  function del(id: string) {
    deleteWrongNote(id)
    onNotesChanged()
  }

  function delAll() {
    if (!confirm(`오답노트 ${notes.length}개를 모두 삭제할까요?`)) return
    saveWrongNotes([])
    onNotesChanged()
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v)
    setCheckedIds(new Set())
  }

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(filtered.map((n) => n.id)))
    }
  }

  function delSelected() {
    if (checkedIds.size === 0) return
    if (!confirm(`선택한 ${checkedIds.size}개를 삭제할까요?`)) return
    const remaining = notes.filter((n) => !checkedIds.has(n.id))
    saveWrongNotes(remaining)
    setCheckedIds(new Set())
    setSelectMode(false)
    onNotesChanged()
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        {isGeneral ? (
          availableSubjects.length > 0 && (
            <FilterChips options={availableSubjects} selected={generalSubjects} onChange={setGeneralSubjects} />
          )
        ) : (
          <FilterChips options={SUBJECTS} selected={subjects} onChange={setSubjects} />
        )}
        <FilterChips options={RISKS} selected={risks} onChange={setRisks} />
        <div className="flex items-center justify-between">
          <FilterChips options={[...SORTS]} selected={[sort]} onChange={(v) => setSort((v[0] as typeof sort) ?? sort)} single />
          {notes.length > 0 && (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={toggleSelectMode}
                className={`text-xs transition-colors ${selectMode ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {selectMode ? '선택 취소' : '선택 삭제'}
              </button>
              <button onClick={delAll} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                전체 삭제
              </button>
            </div>
          )}
        </div>

        {/* 선택 모드 액션바 */}
        {selectMode && (
          <div className="flex items-center justify-end gap-3 pt-1 border-t border-border">
            <button
              onClick={toggleAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {checkedIds.size === filtered.length ? '전체 해제' : '전체 선택'}
            </button>
            <button
              onClick={delSelected}
              disabled={checkedIds.size === 0}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              선택 삭제 ({checkedIds.size})
            </button>
          </div>
        )}
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground px-1">
        {filtered.length}개 표시 (전체 {notes.length}개)
      </p>

      {/* List */}
      {filtered.length === 0 && risks.length === 0 && activeSubjects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          오답노트가 없습니다. CBT나 선학습 모드에서 문제를 풀어보세요.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          필터 조건에 맞는 오답이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((note) => {
            const listHighlights = loadHighlights(note.question.id)
            return (
              <div
                key={note.id}
                className={`bg-card border rounded-xl p-4 transition-colors ${
                  selectMode
                    ? checkedIds.has(note.id)
                      ? 'border-primary bg-primary/5 cursor-pointer'
                      : 'border-border cursor-pointer hover:border-primary/40'
                    : 'border-border cursor-pointer hover:border-primary/40'
                }`}
                onClick={() => selectMode ? toggleCheck(note.id) : setSelected(note)}
              >
                <div className="flex items-start gap-3">
                  {/* 체크박스 */}
                  {selectMode && (
                    <div className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                      checkedIds.has(note.id)
                        ? 'bg-primary border-primary'
                        : 'border-muted-foreground'
                    }`}>
                      {checkedIds.has(note.id) && (
                        <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground">{note.question.subject}</span>
                      <span className="text-xs text-muted-foreground">{note.question.year}년</span>
                      {!isGeneral && note.dominantCause && <CauseBadge cause={note.dominantCause} />}
                      {note.isBookmarked && note.wrongCount === 0 && (
                        <span className="text-xs text-yellow-400">📌 북마크</span>
                      )}
                      {note.wrongCount > 0 && <StarRating value={getRiskLevel(note)} />}
                    </div>
                    {note.analysis?.핵심개념 && (
                      <p className="text-xs text-muted-foreground">{note.analysis.핵심개념}</p>
                    )}
                    <p className="text-sm text-foreground line-clamp-1">
                      {renderHighlighted(note.question.passage.slice(0, 70), 'passage', listHighlights)}...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(note.createdAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>

                  {/* 선택 모드 아닐 때만 개별 삭제 버튼 표시 */}
                  {!selectMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); del(note.id) }}
                      className="text-muted-foreground hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <DetailModal
          note={selected}
          onClose={() => setSelected(null)}
          onMemoSaved={onNotesChanged}
          isGeneral={isGeneral}
        />
      )}
    </div>
  )
}