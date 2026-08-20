'use client'

import { useState, useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { saveWrongNotes, updateWrongNoteMemo, updateWrongNoteAnalysis, updateWrongNoteHiddenFields, getRiskLevel, isInMemoList } from '@/lib/store'
import { StarRating } from '@/components/star-rating'
import { CauseBadge } from '@/components/cause-badge'
import { FilterChips } from '@/components/filter-chips'
import { SORT_OPTIONS, sortNotes, type SortOption } from '@/lib/noteSort'
import { getAppMode } from '@/lib/appMode'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const RISKS = ['★1', '★2', '★3', '★4', '★5']

export function MemoTab({
  notes,
  onNotesChanged,
}: {
  notes: WrongNote[]
  onNotesChanged: () => void
}) {
  const [appMode] = useState(() => getAppMode())
  const isGeneral = appMode === 'general'

  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [filterSubjects, setFilterSubjects] = useState<Subject[]>([])
  const [filterGeneralSubjects, setFilterGeneralSubjects] = useState<string[]>([])
  const [filterRisks, setFilterRisks] = useState<string[]>([])
  const [sort, setSort] = useState<SortOption>('날짜순')

  const highNotes = useMemo(() => {
    return notes.filter(isInMemoList)
  }, [notes])

  const activeFilterSubjects: string[] = isGeneral ? filterGeneralSubjects : filterSubjects

  const availableSubjects = useMemo(() => {
    return Array.from(new Set(highNotes.map((n) => n.question.subject as string))).sort((a, b) => a.localeCompare(b))
  }, [highNotes])

  const filtered = useMemo(() => {
    const list = highNotes.filter((n) => {
      if (activeFilterSubjects.length && !activeFilterSubjects.includes(n.question.subject)) return false
      if (filterRisks.length) {
        const levels = filterRisks.map((r) => Number(r.replace('★', '')))
        const risk = n.analysis?.위험도
        if (risk === undefined || risk === null || !levels.includes(Number(risk))) return false
      }
      return true
    })
    return sortNotes(list, sort)
  }, [highNotes, activeFilterSubjects, filterRisks, sort])

  const grouped = useMemo(() => {
    const map = new Map<string, WrongNote[]>()
    const subjectKeys = isGeneral ? availableSubjects : SUBJECTS
    for (const s of subjectKeys) {
      const items = filtered.filter((n) => n.question.subject === s)
      if (items.length > 0) map.set(s, items)
    }
    return map
  }, [filtered, isGeneral, availableSubjects])

  function handlePrint() {
    window.print()
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

  function delAll() {
    if (!confirm(`암기장 항목 ${highNotes.length}개를 모두 삭제할까요?`)) return
    const remaining = notes.filter((n) => !isInMemoList(n))
    saveWrongNotes(remaining)
    setCheckedIds(new Set())
    setSelectMode(false)
    onNotesChanged()
  }

  if (highNotes.length === 0) {
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
      {/* 헤더 */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h2 className="text-lg font-bold text-foreground">D-1 암기장</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            위험도 ★3 이상 항목 {highNotes.length}개
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          🖨️ 인쇄
        </button>
      </div>

      {/* 필터 + 삭제 컨트롤 */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 no-print">
        {isGeneral ? (
          availableSubjects.length > 0 && (
            <FilterChips options={availableSubjects} selected={filterGeneralSubjects} onChange={setFilterGeneralSubjects} />
          )
        ) : (
          <FilterChips options={SUBJECTS} selected={filterSubjects} onChange={setFilterSubjects} />
        )}
        <FilterChips options={RISKS} selected={filterRisks} onChange={setFilterRisks} />
        <FilterChips
          options={[...SORT_OPTIONS]}
          selected={[sort]}
          onChange={(v) => setSort((v[0] as SortOption) ?? sort)}
          single
        />
        <div className="flex items-center justify-end gap-3 pt-1 border-t border-border">
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

        {selectMode && (
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
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

      {/* 카운트 */}
      <p className="text-xs text-muted-foreground px-1">
        {filtered.length}개 표시 (전체 {highNotes.length}개)
      </p>

      {/* 카드 목록 */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          필터 조건에 맞는 항목이 없습니다.
        </div>
      ) : (
        Array.from(grouped.entries()).map(([subject, items]) => (
          <div key={subject} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold text-primary px-2">{subject}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {items.map((note) => (
              <div
                key={note.id}
                className={`transition-colors rounded-xl ${
                  selectMode
                    ? checkedIds.has(note.id)
                      ? 'ring-2 ring-primary cursor-pointer'
                      : 'cursor-pointer opacity-70 hover:opacity-100'
                    : ''
                }`}
                onClick={() => selectMode && toggleCheck(note.id)}
              >
                {selectMode && (
                  <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                    <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                      checkedIds.has(note.id) ? 'bg-primary border-primary' : 'border-muted-foreground'
                    }`}>
                      {checkedIds.has(note.id) && (
                        <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">선택</span>
                  </div>
                )}
                <MemoCard note={note} onMemoSaved={onNotesChanged} isGeneral={isGeneral} />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function EditableField({
  value,
  onSave,
  onDelete,
  label,
  multiline = false,
  className = '',
}: {
  value: string
  onSave: (v: string) => void
  onDelete?: () => void
  label: string
  multiline?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function save() {
    onSave(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="space-y-1">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
            className="w-full bg-input border border-primary rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none resize-none"
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="w-full bg-input border border-primary rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none"
          />
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setDraft(value); setEditing(false) }} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
          <button onClick={save} className="text-xs text-primary font-medium hover:opacity-80">저장</button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-1">
      <div
        className={`flex-1 cursor-pointer rounded px-1 -mx-1 hover:bg-white/5 transition-colors ${className}`}
        onClick={() => { setDraft(value); setEditing(true) }}
        title={`${label} 수정`}
      >
        <span className="group-hover:opacity-70 transition-opacity">{value}</span>
        <span className="ml-1 opacity-0 group-hover:opacity-40 text-[10px] transition-opacity">✏️</span>
      </div>
      {onDelete && (
        <button
          onClick={() => { if (confirm(`${label}을 삭제할까요?`)) onDelete() }}
          className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-red-400 text-xs leading-none mt-0.5 shrink-0 transition-opacity"
          title={`${label} 삭제`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function MemoCard({ note, onMemoSaved, isGeneral }: { note: WrongNote; onMemoSaved: () => void; isGeneral: boolean }) {
  const a = note.analysis
  const [memo, setMemo] = useState(note.memo ?? '')
  const [memoSaved, setMemoSaved] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set(note.hiddenFields ?? []))

  function saveMemo() {
    updateWrongNoteMemo(note.id, memo)
    setMemoSaved(true)
    setTimeout(() => setMemoSaved(false), 1500)
    onMemoSaved()
  }

  function saveField(patch: Partial<import('@/lib/types').ErrorAnalysis>) {
    updateWrongNoteAnalysis(note.id, patch)
    onMemoSaved()
  }

  function hideField(field: string) {
    if (!confirm(`'${field}' 칸을 삭제할까요? 복구하려면 '숨긴 칸 보기'를 누르세요.`)) return
    const next = new Set(hidden)
    next.add(field)
    setHidden(next)
    updateWrongNoteHiddenFields(note.id, Array.from(next))
  }

  function restoreField(field: string) {
    const next = new Set(hidden)
    next.delete(field)
    setHidden(next)
    updateWrongNoteHiddenFields(note.id, Array.from(next))
    onMemoSaved()
  }

  if (!a) return null

  const FIELDS = ['핵심개념', '관련조문', '개념요약', '혼동주의', '체크포인트']
  const hiddenList = FIELDS.filter((f) => hidden.has(f))

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3 text-sm break-inside-avoid">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {note.isBookmarked && note.wrongCount === 0 && (
            <span className="text-xs text-yellow-400">📌 북마크</span>
          )}
          {!isGeneral && note.dominantCause && <CauseBadge cause={note.dominantCause} />}
          {note.wrongCount > 0 && <StarRating value={getRiskLevel(note)} />}
        </div>
        <span className="text-xs text-muted-foreground">{note.question.year}년 {note.question.examType}</span>
      </div>

      {!hidden.has('핵심개념') && (
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium">핵심개념</p>
          <EditableField value={a.핵심개념} onSave={(v) => saveField({ 핵심개념: v })} onDelete={() => hideField('핵심개념')} label="핵심개념" className="font-semibold text-foreground" />
        </div>
      )}

      {!hidden.has('관련조문') && (
        <div className="bg-muted rounded-lg p-3 space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium">관련조문</p>
          <EditableField value={a.관련조문} onSave={(v) => saveField({ 관련조문: v })} onDelete={() => hideField('관련조문')} label="관련조문" className="text-foreground text-xs" multiline />
        </div>
      )}

      {!hidden.has('개념요약') && (
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium">개념요약 (3줄)</p>
          <EditableField value={a.개념요약} onSave={(v) => saveField({ 개념요약: v })} onDelete={() => hideField('개념요약')} label="개념요약" className="text-foreground leading-relaxed whitespace-pre-line" multiline />
        </div>
      )}

      {!hidden.has('혼동주의') && (
        <div className="bg-yellow-500/5 border border-yellow-500/40 rounded-lg p-3 space-y-0.5">
          <p className="text-xs text-yellow-800 font-medium dark:text-yellow-400">⚠ 혼동주의</p>
          <EditableField value={a.혼동주의} onSave={(v) => saveField({ 혼동주의: v })} onDelete={() => hideField('혼동주의')} label="혼동주의" className="text-foreground text-xs leading-relaxed" multiline />
        </div>
      )}

      {!hidden.has('체크포인트') && (
        <div className="bg-emerald-500/5 border border-emerald-500/40 rounded-lg p-3 space-y-0.5">
          <p className="text-xs text-emerald-800 font-medium dark:text-emerald-400">✓ 체크포인트</p>
          <EditableField value={a.체크포인트} onSave={(v) => saveField({ 체크포인트: v })} onDelete={() => hideField('체크포인트')} label="체크포인트" className="text-foreground text-xs leading-relaxed" multiline />
        </div>
      )}

      {hiddenList.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hiddenList.map((f) => (
            <button key={f} onClick={() => restoreField(f)} className="text-[10px] text-muted-foreground border border-border rounded-full px-2 py-0.5 hover:text-foreground hover:border-foreground transition-colors">
              + {f}
            </button>
          ))}
        </div>
      )}

      {/* 내 메모 */}
      <div className="border-t border-border pt-2 no-print space-y-2">
        {note.memo && !memoOpen && (
          <div className="bg-blue-100 border border-blue-400/60 rounded-lg p-3 space-y-1 dark:bg-blue-900/20 dark:border-blue-700/30">
            <div className="flex items-center justify-between">
              <p className="text-xs text-blue-800 font-medium dark:text-blue-400">📝 내 메모</p>
              <button onClick={() => setMemoOpen(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">수정</button>
            </div>
            <p className="text-xs text-foreground whitespace-pre-wrap">{note.memo}</p>
          </div>
        )}
        {!note.memo && !memoOpen && (
          <button onClick={() => setMemoOpen(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            📝 메모 추가 <span>▼</span>
          </button>
        )}
        {memoOpen && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">📝 내 메모</p>
              <button onClick={() => setMemoOpen(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">닫기 ▲</button>
            </div>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="이 항목에 대한 메모를 남겨보세요..."
              rows={3}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <button onClick={saveMemo} className="w-full py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-all">
              {memoSaved ? '✓ 저장됨' : '메모 저장'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
