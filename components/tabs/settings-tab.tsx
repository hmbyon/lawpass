'use client'

import { useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { clearFirebaseSessions } from '@/lib/firebaseServices/sync'

interface Props {
  questionCount: number
  wrongNoteCount: number
  userId: string
  onClearAll: () => void
  onLogout: () => void
}

export function SettingsTab({ questionCount, wrongNoteCount, userId, onClearAll, onLogout }: Props) {
  const [clearing, setClearing] = useState(false)

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

      {/* 계정 */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">계정</h2>
        <button
          onClick={onLogout}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          로그아웃
        </button>
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
    </div>
  )
}
