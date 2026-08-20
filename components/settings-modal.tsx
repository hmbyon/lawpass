'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { logout } from '@/lib/firebaseServices/auth'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'
import { ADMIN_EMAIL } from '@/lib/admin'
import { AdminFeedbackPanel } from '@/components/admin-feedback-panel'
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
}: Props) {
  const [clearing, setClearing] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetInput, setResetInput] = useState('')

  const TARGET_TEXT = '전체 데이터 초기화'
  const isAdmin = userEmail === ADMIN_EMAIL

  function handleLogout() {
    onClose()
    logout()
  }

  function handleOpenResetModal() {
    setResetInput('')
    setShowResetModal(true)
  }

  async function handleConfirmReset() {
    if (resetInput !== TARGET_TEXT) return
    setClearing(true)
    onClearAll()
    try {
      await clearFirebaseSessions(userId)
    } catch (e) {
      console.error('[settings-modal] Firebase 세션 삭제 실패', e)
    } finally {
      setClearing(false)
      setShowResetModal(false)
      setResetInput('')
    }
  }

  return (
    <>
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

          {/* 데이터 초기화 (위험 구역) */}
          <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-red-400">위험 구역</h3>
            <p className="text-xs text-muted-foreground">모든 문제와 오답노트, Firebase에 저장된 임시저장 데이터가 삭제됩니다. 되돌릴 수 없습니다.</p>
            <button
              onClick={handleOpenResetModal}
              disabled={clearing}
              className="text-sm text-red-400 border border-red-400/30 rounded-lg px-4 py-2 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
            >
              {clearing ? '초기화 중...' : '전체 데이터 초기화'}
            </button>
          </div>

          {/* 관리자 모드 */}
          {isAdmin && (
            <div className="bg-muted rounded-xl p-4">
              <AdminFeedbackPanel onWriteFeedback={onWriteFeedback} />
            </div>
          )}
        </div>
      </div>

      {/* Vercel 스타일 2차 확인 입력 모달 */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs"
          onClick={() => setShowResetModal(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-base font-bold text-foreground">전체 데이터 초기화</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                모든 문제, 오답노트, 세션 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">
                확인하시려면 아래에 <span className="font-bold text-red-500 underline">"{TARGET_TEXT}"</span>를 입력하세요.
              </label>
              <input
                type="text"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                placeholder={TARGET_TEXT}
                autoFocus
                className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                disabled={resetInput !== TARGET_TEXT || clearing}
                className="flex-1 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {clearing ? '초기화 중...' : '삭제 진행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}