'use client'

import { useState } from 'react'
import { submitFeedback } from '@/lib/firebaseServices/feedback'
import { MyFeedbackSection } from '@/components/my-feedback-section'
import type { FeedbackType } from '@/lib/types'
import type { AppMode } from '@/lib/appMode'

const FEEDBACK_TYPES: FeedbackType[] = ['버그 신고', '기능 건의', '기타']

interface Props {
  userId: string
  userEmail: string | null
  mode: AppMode
  onClose: () => void
  onRepliesRead?: () => void // 답글을 읽음 처리한 뒤 헤더 알림 갱신
}

export function FeedbackModal({ userId, userEmail, mode, onClose, onRepliesRead }: Props) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('버그 신고')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      await submitFeedback(userId, userEmail, feedbackType, content.trim(), mode)
      setContent('')
      setSubmitted(true)
    } catch (e) {
      console.error('[feedback-modal] 피드백 제출 실패', e)
      alert('피드백 제출에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">💬 피드백 보내기</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">피드백 유형</label>
          <div className="flex gap-2">
            {FEEDBACK_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setFeedbackType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border ${
                  feedbackType === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">내용</label>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setSubmitted(false)
            }}
            placeholder="버그 내용이나 건의사항을 자유롭게 작성해주세요."
            rows={4}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? '제출 중...' : '제출'}
        </button>

        {submitted && (
          <div className="bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/40 rounded-lg p-3 text-sm">
            <p className="text-emerald-700 dark:text-emerald-300 font-medium">피드백이 제출되었습니다. 감사합니다!</p>
          </div>
        )}

        {/* 내가 남긴 피드백과 관리자 답글. 알림 카운트와 무관하게 항상 여기서 볼 수 있다 */}
        <MyFeedbackSection userId={userId} onRepliesRead={onRepliesRead} />
      </div>
    </div>
  )
}
