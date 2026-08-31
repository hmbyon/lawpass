'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { logout } from '@/lib/firebaseServices/auth'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'
import { ADMIN_EMAIL } from '@/lib/admin'
import { AdminFeedbackPanel } from '@/components/admin-feedback-panel'
import { AdminPoolPanel } from '@/components/admin-pool-panel'
import { SharedPoolList } from '@/components/shared-pool-list'
import type { AppMode } from '@/lib/appMode'
import { db } from '@/lib/firebase'
import { collection, doc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore'

interface Props {
  questionCount: number
  // 공유받은 문제. 내 문제와 합쳐 세지 않고 따로 보여준다
  poolQuestionCount?: number
  wrongNoteCount: number
  userId: string
  userEmail: string | null
  onClearAll: () => void
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  onClose: () => void
  onWriteFeedback?: () => void
}

export function SettingsModal({
  questionCount,
  poolQuestionCount = 0,
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

    try {
      // 1. Firebase Firestore 클라우드 DB 상의 모든 문제/오답/세션 데이터 완전 삭제
      if (userId && db) {
        const modes = ['law', 'general']
        const subKeys = ['questions', 'wrongNotes', 'studySessions', 'quizSession']

        for (const m of modes) {
          // (1) users/{userId}/{mode} 컬렉션 내부 문서 일괄 삭제 (questions, wrongNotes 등)
          try {
            const modeColRef = collection(db, 'users', userId, m)
            const snapshot = await getDocs(modeColRef)
            if (!snapshot.empty) {
              const batch = writeBatch(db)
              snapshot.docs.forEach((docSnap) => {
                batch.delete(docSnap.ref)
              })
              await batch.commit()
            }
          } catch (err) {
            console.error(`[Firebase Delete Mode Error] ${m}:`, err)
          }

          // (2) 단일 문서 형태인 경우 개별 deleteDoc 실행
          for (const sub of subKeys) {
            try {
              await deleteDoc(doc(db, 'users', userId, m, sub))
            } catch (err) {}
          }

          // (3) users/{userId}/{mode}_questions 형태 컬렉션인 경우 대응
          for (const sub of subKeys) {
            try {
              const altColRef = collection(db, 'users', userId, `${m}_${sub}`)
              const altSnap = await getDocs(altColRef)
              if (!altSnap.empty) {
                const batch = writeBatch(db)
                altSnap.docs.forEach((docSnap) => {
                  batch.delete(docSnap.ref)
                })
                await batch.commit()
              }
            } catch (err) {}
          }
        }
      }

      // 2. Firebase 세션 초기화
      if (userId) {
        await clearFirebaseSessions(userId)
      }

      // 3. 로컬 스토리지에 남아있는 lawpass 관련 모든 키 삭제
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('lawpass')) {
          localStorage.removeItem(key)
        }
      })

      // 4. React State 초기화
      onClearAll()

      setShowResetModal(false)
      setResetInput('')

      // 5. 새로고침으로 완벽 리셋 반영
      window.location.reload()
    } catch (e) {
      console.error('[settings-modal] 전체 데이터 초기화 실패', e)
      alert('초기화 도중 오류가 발생했습니다.')
    } finally {
      setClearing(false)
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
              {poolQuestionCount > 0 && (
                <div className="flex justify-between">
                  <span>공유</span>
                  <span className="tabular-nums">{poolQuestionCount}개</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>오답</span>
                <span className="tabular-nums">{wrongNoteCount}개</span>
              </div>
            </div>
          </div>

          {/* 공유받은 문제집 — 받을 것이 없는 사람에게는 스스로 아무것도 그리지 않으므로
              여기서 감싸지 않는다 (빈 카드가 남지 않게) */}
          <SharedPoolList userId={userId} />

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

          {/* 위험 구역 */}
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
              <AdminPoolPanel ownerUid={userId} />
            </div>
          )}

          {isAdmin && (
            <div className="bg-muted rounded-xl p-4">
              <AdminFeedbackPanel onWriteFeedback={onWriteFeedback} />
            </div>
          )}
        </div>
      </div>

      {/* 2차 확인 문구 입력 팝업 모달 */}
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
                모든 문제, 오답노트, 세션 데이터가 서버에서 완전히 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
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
                {clearing ? '초기화 중...' : '서버까지 전체 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}