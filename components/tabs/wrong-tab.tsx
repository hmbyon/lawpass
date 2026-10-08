'use client'

import { useState, useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { deleteWrongNote, saveWrongNotes, getRiskLevel } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { FilterChips } from '@/components/filter-chips'
import { SORT_OPTIONS, sortNotes, type SortOption } from '@/lib/noteSort'
import { getAppMode } from '@/lib/appMode'
import { loadHighlights, renderHighlighted } from '@/lib/highlights'
import { WrongNoteDetailModal } from '@/components/wrong-note-detail'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const RISKS = ['★1', '★2', '★3', '★4', '★5']

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
  const [sort, setSort] = useState<SortOption>('날짜순')
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
    return sortNotes(list, sort)
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
          <FilterChips options={[...SORT_OPTIONS]} selected={[sort]} onChange={(v) => setSort((v[0] as SortOption) ?? sort)} single />
          {/* shrink-0: 필터 칩과 폭을 다투다 눌리면 한글이 글자 단위로 쪼개진다("선택 삭"/"제")
              whitespace-nowrap: 각 버튼 문구를 한 덩어리로 유지 */}
          {notes.length > 0 && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <button
                onClick={toggleSelectMode}
                className={`text-xs whitespace-nowrap transition-colors ${selectMode ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {selectMode ? '선택 취소' : '선택 삭제'}
              </button>
              <button onClick={delAll} className="text-xs whitespace-nowrap text-red-400 hover:text-red-300 transition-colors">
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
              className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors"
            >
              {checkedIds.size === filtered.length ? '전체 해제' : '전체 선택'}
            </button>
            <button
              onClick={delSelected}
              disabled={checkedIds.size === 0}
              className="text-xs whitespace-nowrap text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                      {note.flaggedCorrect && note.wrongCount === 0 && (
                        <span className="text-xs text-amber-400">🤔 맞혔지만 {note.status}</span>
                      )}
                      {getRiskLevel(note) > 0 && <StarRating value={getRiskLevel(note)} />}
                    </div>
                    {note.analysis?.핵심개념 && (
                      <p className="text-xs text-muted-foreground">{note.analysis.핵심개념}</p>
                    )}
                    <p className="text-sm text-foreground line-clamp-1">
                      {renderHighlighted(note.question.passage.slice(0, 70), 'passage', listHighlights)}...
                    </p>
                    {note.confusedWith && note.confusedWith.length > 0 && (
                      <p className="text-xs text-amber-500">
                        {note.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'} {note.confusedWith.join(' ')}
                      </p>
                    )}
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
        <WrongNoteDetailModal
          note={selected}
          onClose={() => setSelected(null)}
          onMemoSaved={onNotesChanged}
          isGeneral={isGeneral}
        />
      )}
    </div>
  )
}