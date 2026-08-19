'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { logout } from '@/lib/firebaseServices/auth'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'
import { getAllFeedback, setFeedbackRead, setFeedbackReply } from '@/lib/firebaseServices/feedback'
import { ADMIN_EMAIL } from '@/lib/admin'
import type { Feedback } from '@/lib/types'
import type { AppMode } from '@/lib/appMode'

const MODE_FILTERS: { id: 'all' | AppMode; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'law', label: '⚖️ LawPass' },
  { id: 'general', label: '📚 ExamPass' },
]

interface Props {
  questionCount: number
  wrongNoteCount: number
  userId: string
  userEmail: string | null
  onClearAll: () => void
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  onClose: () => void
}

export function SettingsModal({
  questionCount,
  wrongNoteCount,
  userId,
  userEmail,
  onClearAll,
  mode,
  onModeChange,
  onClose,
}: Props) {
  const [clearing, setClearing] = useState(false)

  const isAdmin = userEmail === ADMIN_EMAIL
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [hasLoadedFeedback, setHasLoadedFeedback] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [replyOpen, setReplyOpen] = useState<string | null>(null)   // 답글 입력창이 열린 피드백 id
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [modeFilter, setModeFilter] = useState<'all' | AppMode>('all')

  function handleLogout() {
    onClose()
    logout()
  }

  async function handleClearAllClick() {
    if (!confirm('모든 데이터(문제은행 + 오답노트 + Firebase 임시저장)를 초기화할까요? 되돌릴 수 없습니다.')) return
    setClearing(true)
    onClearAll()
    try {
      await clearFirebaseSessions(userId)
    } catch (e) {
      console.error('[settings-modal] Firebase 세션 삭제 실패', e)
    } finally {
      setClearing(false)
    }
  }

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

  const filteredFeedback = feedbackList.filter(
    (f) => modeFilter === 'all' || (f.mode ?? 'law') === modeFilter
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">⚙️ 설정</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {/* 화면 모드 */}
        <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">화면 모드</h3>
          <ThemeToggle />
        </div>

        {/* 앱 모드 */}
        <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">앱 모드</h3>
          <p className="text-xs text-muted-foreground">LawPass ↔ ExamPass 전환</p>
          <div className="flex gap-2">
            <button
              onClick={() => onModeChange('law')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border flex flex-col items-center gap-0.5 ${
                mode === 'law'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              <span>⚖️ LawPass</span>
              <span className="text-xs font-normal opacity-80">변호사시험</span>
            </button>
            <button
              onClick={() => onModeChange('general')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border flex flex-col items-center gap-0.5 ${
                mode === 'general'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              <span>📚 ExamPass</span>
              <span className="text-xs font-normal opacity-80">일반수험</span>
            </button>
          </div>
        </div>

        {/* 학습 현황 */}
        <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">학습 현황</h3>
          <div className="flex flex-col gap-0.5 text-sm text-muted-foreground w-24">
            <div className="flex justify-between">
              <span>문제</span>
              <span className="tabular-nums">{questionCount}개</span>
            </div>
            <div className="flex justify-between">
              <span>오답</span>
              <span className="tabular-nums">{wrongNoteCount}개</span>
            </div>
          </div>
        </div>

        {/* 로그아웃 */}
        <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">계정</h3>
          {userEmail && <p className="text-xs text-muted-foreground truncate">{userEmail}</p>}
          <button
            onClick={handleLogout}
            className="text-sm text-red-400 border border-red-400/30 rounded-lg px-4 py-2 hover:bg-red-400/10 transition-colors text-left"
          >
            로그아웃
          </button>
        </div>

        {/* 데이터 초기화 */}
        <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-red-400">위험 구역</h3>
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
          <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">🔧 관리자 모드</h3>
              <button
                onClick={loadFeedback}
                disabled={loadingAdmin}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                {loadingAdmin ? '불러오는 중...' : '새로고침'}
              </button>
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
        )}
      </div>
    </div>
  )
}
