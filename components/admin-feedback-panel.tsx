'use client'

import { useState, useEffect } from 'react'
import { getAllFeedback, setFeedbackRead, setFeedbackReply } from '@/lib/firebaseServices/feedback'
import type { Feedback } from '@/lib/types'
import type { AppMode } from '@/lib/appMode'

const MODE_FILTERS: { id: 'all' | AppMode; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'law', label: '⚖️ LawPass' },
  { id: 'general', label: '📚 ExamPass' },
]

interface Props {
  autoLoad?: boolean            // 열자마자 목록을 불러올지
  onWriteFeedback?: () => void  // 관리자도 피드백을 남길 수 있게 하는 통로
  onUnreadChange?: () => void   // 읽음 상태가 바뀌었음을 상위에 알림
}

// 피드백 조회·읽음 처리·답글 UI. 설정 모달과 전용 모달이 함께 쓴다
export function AdminFeedbackPanel({ autoLoad = false, onWriteFeedback, onUnreadChange }: Props) {
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [hasLoadedFeedback, setHasLoadedFeedback] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [modeFilter, setModeFilter] = useState<'all' | AppMode>('all')

  async function loadFeedback() {
    setLoadingAdmin(true)
    setAdminError('')
    try {
      const list = await getAllFeedback()
      setFeedbackList(list)
      setHasLoadedFeedback(true)
    } catch (e) {
      console.error('[settings-modal] 피드백 목록 조회 실패', e)
      setAdminError('피드백 목록을 불러오지 못했습니다.')
    } finally {
      setLoadingAdmin(false)
    }
  }
  async function handleToggleRead(f: Feedback) {
    const nextRead = !f.isRead
    setFeedbackList((prev) => prev.map((x) => (x.id === f.id ? { ...x, isRead: nextRead } : x)))
    try {
      await setFeedbackRead(f.id, nextRead)
      onUnreadChange?.()
    } catch (e) {
      console.error('[settings-modal] 읽음 상태 변경 실패', e)
      setFeedbackList((prev) => prev.map((x) => (x.id === f.id ? { ...x, isRead: f.isRead } : x)))
    }
  }
  async function handleSaveReply(f: Feedback) {
    setReplySaving(true)
    const reply = replyText.trim()
    try {
      await setFeedbackReply(f.id, reply)
      setFeedbackList((prev) =>
        prev.map((x) =>
          x.id === f.id
            ? { ...x, adminReply: reply || undefined, repliedAt: reply ? Date.now() : undefined }
            : x
        )
      )
      setReplyOpen(null)
      setReplyText('')
    } catch (e) {
      console.error('[settings-modal] 답글 저장 실패', e)
      setAdminError('답글 저장에 실패했습니다.')
    } finally {
      setReplySaving(false)
    }
  }
  // 마운트 직후 1회 자동 로드
  useEffect(() => {
    if (!autoLoad) return
    loadFeedback()
    // loadFeedback은 매 렌더 새로 만들어지므로 의존성에서 제외한다 (1회만 실행)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad])

  const filteredFeedback = feedbackList.filter(
    (f) => modeFilter === 'all' || (f.mode ?? 'law') === modeFilter
  )

  return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">🔧 관리자 모드</h3>
          <div className="flex items-center gap-3">
            {onWriteFeedback && (
              <button
                onClick={onWriteFeedback}
                className="text-xs text-primary hover:opacity-80 transition-opacity"
              >
                ✍️ 피드백 남기기
              </button>
            )}
          <button
            onClick={loadFeedback}
            disabled={loadingAdmin}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            {loadingAdmin ? '불러오는 중...' : '새로고침'}
          </button>
          </div>
        </div>

        <div className="flex gap-2">
          {MODE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setModeFilter(f.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                modeFilter === f.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {adminError && <p className="text-xs text-red-400">{adminError}</p>}
        {!loadingAdmin && !hasLoadedFeedback && !adminError && (
          <p className="text-xs text-muted-foreground">"새로고침"을 눌러 피드백 목록을 불러오세요.</p>
        )}
        {!loadingAdmin && hasLoadedFeedback && filteredFeedback.length === 0 && !adminError && (
          <p className="text-xs text-muted-foreground">
            {feedbackList.length === 0 ? '접수된 피드백이 없습니다.' : '해당 모드의 피드백이 없습니다.'}
          </p>
        )}
        <div className="space-y-2">
          {filteredFeedback.map((f) => {
            const itemMode: AppMode = f.mode ?? 'law'
            return (
              <div key={f.id} className="bg-card rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                      {f.type}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted-foreground/20 text-muted-foreground">
                      {itemMode === 'general' ? '📚 ExamPass' : '⚖️ LawPass'}
                    </span>
                    {!f.isRead && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                        안읽음
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleRead(f)}
                    className="text-xs text-primary border border-primary/30 rounded-lg px-2.5 py-1 hover:bg-primary/10 transition-colors shrink-0"
                  >
                    {f.isRead ? '안읽음으로 표시' : '읽음으로 표시'}
                  </button>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{f.content}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                  <span className="truncate">{f.userEmail ?? f.userId}</span>
                  <span className="shrink-0">{new Date(f.createdAt).toLocaleString('ko-KR')}</span>
                </div>

                {f.adminReply && replyOpen !== f.id && (
                  <div className="border-l-2 border-primary/50 bg-primary/5 rounded-r px-2 py-1.5 space-y-1">
                    <p className="text-[10px] text-primary font-medium">답글</p>
                    <p className="text-xs text-foreground whitespace-pre-wrap break-words">{f.adminReply}</p>
                    {f.repliedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(f.repliedAt).toLocaleString('ko-KR')}
                      </p>
                    )}
                  </div>
                )}

                {replyOpen === f.id ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="답글을 입력하세요..."
                      rows={3}
                      autoFocus
                      className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => { setReplyOpen(null); setReplyText('') }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        취소
                      </button>
                      {f.adminReply && (
                        <button
                          type="button"
                          onClick={() => { setReplyText(''); handleSaveReply(f) }}
                          disabled={replySaving}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                        >
                          답글 삭제
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSaveReply(f)}
                        disabled={replySaving || !replyText.trim()}
                        className="text-xs text-primary font-medium hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {replySaving ? '전송 중...' : '답글 전송'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setReplyOpen(f.id); setReplyText(f.adminReply ?? '') }}
                    className="text-xs text-primary border border-primary/30 rounded-lg px-2.5 py-1 hover:bg-primary/10 transition-colors"
                  >
                    {f.adminReply ? '답글 수정' : '답글 달기'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
  )
}
