'use client'

import { AdminFeedbackPanel } from '@/components/admin-feedback-panel'

interface Props {
  onWriteFeedback: () => void
  onUnreadChange: () => void
  onClose: () => void
}

// 헤더 피드백 버튼(관리자)에서 여는 전용 모달. 설정 화면과 분리돼 있다
export function AdminFeedbackModal({ onWriteFeedback, onUnreadChange, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h2 className="text-sm font-semibold text-foreground">🔧 피드백 관리자 모드</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <AdminFeedbackPanel autoLoad onWriteFeedback={onWriteFeedback} onUnreadChange={onUnreadChange} />
        </div>
      </div>
    </div>
  )
}
