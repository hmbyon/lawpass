'use client'

import { useState, useMemo } from 'react'
import type { WrongNote, Subject } from '@/lib/types'
import { resolveErrorCause, CAUSE_LABELS } from '@/lib/types'
import { deleteWrongNote, saveWrongNotes, updateWrongNoteMemo, getRiskLevel , updateWrongNoteMemoInclusion } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { FilterChips } from '@/components/filter-chips'
import { SORT_OPTIONS, sortNotes, type SortOption } from '@/lib/noteSort'
import { getAppMode } from '@/lib/appMode'
import { loadHighlights, renderHighlighted, saveHighlights } from '@/lib/highlights'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const RISKS = ['★1', '★2', '★3', '★4', '★5']

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
  const [inMemoList, setInMemoList] = useState(note.manuallyAddedToMemo ?? false)

  // 북마크(표시 전용 배지)와는 별개 기능이다. 자동 조건과 무관하게 암기장에 넣고 뺀다
  function toggleMemoInclusion() {
    const next = !inMemoList
    setInMemoList(next)
    updateWrongNoteMemoInclusion(note.id, next)
    onMemoSaved()
  }
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
          <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
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
                      ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : c.label === note.userAnswer
                        ? 'border-red-500 bg-red-100 text-red-900 dark:border-red-600 dark:bg-red-900/20 dark:text-red-300'
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
                  <div className="ml-2 mt-0.5 px-2 py-1 bg-yellow-100 text-yellow-900 border-l-2 border-yellow-500/50 rounded-r text-xs dark:bg-yellow-900/20 dark:text-yellow-300">
                    📌 {note.choiceMemos[c.label]}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 해설 */}
          {note.question.explanation && (
            <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
              <p className="text-foreground text-xs leading-relaxed whitespace-pre-wrap break-words">{note.question.explanation}</p>
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
              {/* 학습 흐름: 결론(왜 틀렸나) → 근거(개념·조문·판례) → 암기(요약·주의·체크포인트).
                  카드로 가두지 않고 얇은 구분선으로만 묶어 하나의 리포트처럼 읽히게 한다 */}
              <div className="divide-y divide-border">
                {/* ① 결론 — 왜 틀렸는지 */}
                <div className="space-y-3 pb-4">
                  {(() => {
                    // 신·구 구조를 모두 흡수해 원인 하나만 보여준다
                    const cause = resolveErrorCause(a, note.dominantCause)
                    if (!cause) return null
                    return (
                      <div className="border-l-2 border-primary pl-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[11px] font-semibold text-primary flex items-center gap-1.5">
                            <span aria-hidden>⚠️</span>
                            오답 원인
                          </p>
                          <CauseBadge cause={cause.cause} />
                          {/* 원인명이 배지 라벨과 같으면 같은 말이 두 번 찍히므로, 다를 때만 덧붙인다 */}
                          {cause.원인명 !== CAUSE_LABELS[cause.cause] && (
                            <span className="text-xs font-medium text-foreground">{cause.원인명}</span>
                          )}
                        </div>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                          {cause.상세분석}
                        </p>
                      </div>
                    )
                  })()}
                  <Section icon="🔍" label="오답원인 상세" value={a.원인상세} />
                </div>

                {/* ② 근거 — 무엇을 알아야 했나 */}
                <div className="space-y-3 py-4">
                  <Section icon="🎯" label="핵심개념" value={a.핵심개념} />
                  <Section icon="📖" label="관련조문" value={a.관련조문} />
                  {/* 판례가 없으면 Section이 null을 반환해 항목 자체가 사라진다 */}
                  <Section icon="⚖️" label="관련판례" value={a.관련판례 ?? ''} />
                </div>

                {/* ③ 암기 — 어떻게 기억할까 */}
                <div className="space-y-3 pt-4">
                  <Section icon="📝" label="개념요약" value={a.개념요약} />
                  <Section icon="🔀" label="혼동주의" value={a.혼동주의} />
                  <Section icon="✅" label="D-1 체크포인트" value={a.체크포인트} />
                </div>
              </div>

              {/* 오답 히스토리 */}
              {note.analysisHistory && note.analysisHistory.length > 1 && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">오답 히스토리</p>
                  {note.analysisHistory.map((h, idx) => (
                    <div key={idx} className="bg-muted/40 border border-border/60 rounded-lg p-2.5 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">{idx + 1}회차</p>
                      <div className="flex gap-2 flex-wrap">
                        {(() => {
                          const c = resolveErrorCause(h)
                          return c ? <CauseBadge cause={c.cause} /> : null
                        })()}
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

          {/* D-1 암기장 수동 추가 (상단 📌 북마크 배지와는 다른 기능) */}
          <div className="border-t border-border pt-3">
            <button
              onClick={toggleMemoInclusion}
              className={`w-full py-2 rounded-lg text-xs font-medium border transition-colors ${
                inMemoList
                  ? 'border-primary text-primary bg-primary/10 hover:bg-primary/20'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              }`}
            >
              {inMemoList ? '✓ D-1 암기장에 추가됨 (누르면 제외)' : '📕 D-1 암기장에 추가'}
            </button>
          </div>

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

// 분석 항목. 카드로 가두지 않고 소제목만으로 구분해 하나의 리포트처럼 이어 읽히게 한다.
// 색은 전부 시맨틱 토큰이라 3개 테마 모두 대응된다
function Section({ label, value, icon }: { label: string; value: string; icon?: string }) {
  if (!value?.trim()) return null
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-primary flex items-center gap-1.5">
        {icon && <span aria-hidden>{icon}</span>}
        {label}
      </p>
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">{value}</p>
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