'use client'

import { useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'
import { submitFeedback, getAllFeedback, setFeedbackRead } from '@/lib/firebaseServices/feedback'
import type { Feedback, FeedbackType } from '@/lib/types'

const ADMIN_EMAIL = 'hmbyon97@gmail.com'
const FEEDBACK_TYPES: FeedbackType[] = ['버그 신고', '기능 건의', '기타']

interface Props {
  questionCount: number
  wrongNoteCount: number
  userId: string
  userEmail: string | null
  onClearAll: () => void
}

export function SettingsTab({ questionCount, wrongNoteCount, userId, userEmail, onClearAll }: Props) {
  const [clearing, setClearing] = useState(false)

  const [feedbackType, setFeedbackType] = useState<FeedbackType>('버그 신고')
  const [feedbackContent, setFeedbackContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const isAdmin = userEmail === ADMIN_EMAIL
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [adminError, setAdminError] = useState('')

  async function handleClearAllClick() {
    if (!confirm('모든 데이터(문제은행 + 오답노트 + Firebase 임시저장)를 초기화할까요? 되돌릴 수 없습니다.')) return
    setClearing(true)
    onClearAll()
    try {
      await clearFirebaseSessions(userId)
    } catch (e) {
      console.error('[settings-tab] Firebase 세션 삭제 실패', e)
    } finally {
      setClearing(false)
    }
  }

  async function handleSubmitFeedback() {
    if (!feedbackContent.trim()) return
    setSubmitting(true)
    setSubmitted(false)
    try {
      await submitFeedback(userId, userEmail, feedbackType, feedbackContent.trim())
      setFeedbackContent('')
      setSubmitted(true)
      if (isAdmin) loadFeedback()
    } catch (e) {
      console.error('[settings-tab] 피드백 제출 실패', e)
      alert('피드백 제출에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  async function loadFeedback() {
    setLoadingAdmin(true)
    setAdminError('')
    try {
      const list = await getAllFeedback()
      setFeedbackList(list)
    } catch (e) {
      console.error('[settings-tab] 피드백 목록 조회 실패', e)
      setAdminError('피드백 목록을 불러오지 못했습니다.')
    } finally {
      setLoadingAdmin(false)
    }
  }

  useEffect(() => {
    if (isAdmin) loadFeedback()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function handleToggleRead(f: Feedback) {
    const nextRead = !f.isRead
    setFeedbackList((prev) => prev.map((x) => (x.id === f.id ? { ...x, isRead: nextRead } : x)))
    try {
      await setFeedbackRead(f.id, nextRead)
    } catch (e) {
      console.error('[settings-tab] 읽음 상태 변경 실패', e)
      setFeedbackList((prev) => prev.map((x) => (x.id === f.id ? { ...x, isRead: f.isRead } : x)))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 테마 */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">화면 모드</h2>
        <ThemeToggle />
      </div>

      {/* 통계 */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">학습 현황</h2>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>문제 {questionCount}개</span>
          <span>오답 {wrongNoteCount}개</span>
        </div>
      </div>

      {/* 피드백 */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">피드백 보내기</h2>
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
            value={feedbackContent}
            onChange={(e) => {
              setFeedbackContent(e.target.value)
              setSubmitted(false)
            }}
            placeholder="버그 내용이나 건의사항을 자유롭게 작성해주세요."
            rows={4}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
        <button
          onClick={handleSubmitFeedback}
          disabled={submitting || !feedbackContent.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? '제출 중...' : '제출'}
        </button>
        {submitted && (
          <div className="bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/40 rounded-lg p-3 text-sm">
            <p className="text-emerald-700 dark:text-emerald-300 font-medium">피드백이 제출되었습니다. 감사합니다!</p>
          </div>
        )}
      </div>

      {/* 데이터 초기화 */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-red-400">위험 구역</h2>
        <p className="text-xs text-muted-foreground">모든 문제와 오답노트, Firebase에 저장된 임시저장 데이터가 삭제됩니다. 되돌릴 수 없습니다.</p>
        <button
          onClick={handleClearAllClick}
          disabled={clearing}
          className="text-sm text-red-400 border border-red-400/30 rounded-lg px-4 py-2 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          {clearing ? '초기화 중...' : '전체 데이터 초기화'}
        </button>
      </div>

      {/* 관리자 모드 */}
      {isAdmin && (
        <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">🔧 관리자 모드</h2>
            <button
              onClick={loadFeedback}
              disabled={loadingAdmin}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              {loadingAdmin ? '불러오는 중...' : '새로고침'}
            </button>
          </div>
          {adminError && <p className="text-xs text-red-400">{adminError}</p>}
          {!loadingAdmin && feedbackList.length === 0 && !adminError && (
            <p className="text-xs text-muted-foreground">접수된 피드백이 없습니다.</p>
          )}
          <div className="space-y-2">
            {feedbackList.map((f) => (
              <div key={f.id} className="bg-muted rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                      {f.type}
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
