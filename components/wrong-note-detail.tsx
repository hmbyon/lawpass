'use client'

import { useState } from 'react'
import type { WrongNote } from '@/lib/types'
import { resolveErrorCause, CAUSE_LABELS } from '@/lib/types'
import { updateWrongNoteMemo, getRiskLevel, updateWrongNoteMemoInclusion } from '@/lib/store'
import { CauseBadge } from '@/components/cause-badge'
import { StarRating } from '@/components/star-rating'
import { NoteQuestionView } from '@/components/note-question-view'
import { confusedKind } from '@/lib/subChoices'
import { formatAnswer } from '@/lib/answers'
/**
 * 오답 한 문제의 상세 창(지문·선지·보기별 해설·형광펜/펜·AI 분석·메모).
 * 오답노트 탭과 채점 직후의 "오답 분석 결과"가 같은 창을 쓴다 — 두 화면이 달라지지 않게 한 곳에 둔다
 */
interface DetailModalProps {
  note: WrongNote
  onClose: () => void
  onMemoSaved: () => void
  isGeneral: boolean
  /** AI 분석을 시도했다가 실패했을 때 보여 줄 이유(풀이 직후 화면에서만 넘긴다) */
  analysisError?: string
}

export function WrongNoteDetailModal({ note, onClose, onMemoSaved, isGeneral, analysisError }: DetailModalProps) {
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

  function saveMemo() {
    updateWrongNoteMemo(note.id, memo)
    setMemoSaved(true)
    setTimeout(() => setMemoSaved(false), 1500)
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
            {note.flaggedCorrect && note.wrongCount === 0 && (
              <span className="text-xs text-amber-400">🤔 맞혔지만 {note.status}</span>
            )}
                        {getRiskLevel(note) > 0 && <StarRating value={getRiskLevel(note)} />}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* 문제·보기·선지·해설·그림판을 선학습과 같은 모양으로(형광펜·펜 포함). 다른 화면과 같은 컴포넌트다 */}
          <NoteQuestionView note={note} onChanged={onMemoSaved} />

          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            내 답: <span className="text-red-400 font-medium">{formatAnswer(note.userAnswer)}</span>{' '}
            정답: <span className="text-emerald-400 font-medium">{formatAnswer(note.question.answer)}</span>
            {note.status && <span className="ml-2 text-yellow-400">({note.status})</span>}
            {note.confusedWith && note.confusedWith.length > 0 && (
              <span className="ml-2 text-amber-500">
                같이 헷갈린 {confusedKind(note.question, note.confusedWith)} {note.confusedWith.join(' ')}
              </span>
            )}
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
          ) : analysisError ? (
            // 분석을 시도했다가 실패한 경우에만 알린다. 분석이 꺼진 계정은 아무 말도 하지 않는다
            <div className="border-t border-border pt-3 space-y-1">
              <p className="text-xs text-muted-foreground">AI 분석에 실패했습니다.</p>
              <p className="text-xs text-red-400 break-words">이유: {analysisError}</p>
            </div>
          ) : null /* AI 분석이 없는 노트는 아무것도 그리지 않는다 — 일반 사용자는 분석이 꺼져 있다 */}

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

