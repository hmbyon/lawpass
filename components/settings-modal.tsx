'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { logout } from '@/lib/firebaseServices/auth'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'
import { ADMIN_EMAIL } from '@/lib/admin'
import { AdminFeedbackPanel } from '@/components/admin-feedback-panel'
import { MyFeedbackSection } from '@/components/my-feedback-section'
import type { AppMode } from '@/lib/appMode'

interface Props {
  questionCount: number
  wrongNoteCount: number
  userId: string
  userEmail: string | null
  onClearAll: () => void
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  onClose: () => void
  onWriteFeedback?: () => void    // 관리자도 피드백을 남길 수 있게 하는 통로
  onRepliesRead?: () => void      // 내 피드백 답글을 읽음 처리한 뒤 헤더 알림 갱신
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
  onWriteFeedback,
  onRepliesRead,
}: Props) {
  const [clearing, setClearing] = useState(false)

  const isAdmin = userEmail === ADMIN_EMAIL

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

        {/* 내 피드백 (관리자 여부와 무관하게 표시) */}
        <MyFeedbackSection userId={userId} onRepliesRead={onRepliesRead} />

        {/* 관리자 모드 */}
        {isAdmin && (
          <div className="bg-muted rounded-xl p-4">
            <AdminFeedbackPanel onWriteFeedback={onWriteFeedback} />
          </div>
        )}
      </div>
    </div>
  )
}
