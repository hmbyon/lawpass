'use client'

import { useState, useEffect } from 'react'
import { getMyFeedback, markRepliesRead } from '@/lib/firebaseServices/feedback'
import type { Feedback } from '@/lib/types'

interface Props {
  userId: string
  onRepliesRead?: () => void // 답글을 읽음 처리한 뒤 헤더 알림을 갱신하기 위한 콜백
}

// 사용자가 자신이 남긴 피드백과 관리자 답글을 확인하는 섹션.
// 열람하는 순간 답글을 읽음 처리한다
export function MyFeedbackSection({ userId, onRepliesRead }: Props) {
  const [list, setList] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mine = await getMyFeedback(userId)
        if (cancelled) return
        setList(mine)

        const unread = mine.filter((f) => f.adminReply && f.replyReadByUser !== true).map((f) => f.id)
        if (unread.length > 0) {
          await markRepliesRead(unread)
          if (!cancelled) onRepliesRead?.()
        }
      } catch (e) {
        console.error('[my-feedback] 조회 실패', e)
        if (!cancelled) setError('피드백을 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // onRepliesRead는 매 렌더 새로 만들어질 수 있어 의존성에서 제외한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // 남긴 피드백이 없으면 섹션 자체를 숨긴다
  if (!loading && !error && list.length === 0) return null

  return (
    <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">💬 내 피드백</h3>

      {loading && <p className="text-xs text-muted-foreground">불러오는 중...</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-2">
        {list.map((f) => (
          <div key={f.id} className="bg-card rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                {f.type}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(f.createdAt).toLocaleDateString('ko-KR')}
              </span>
            </div>

            <p className="text-sm text-foreground whitespace-pre-wrap break-words">{f.content}</p>

            {f.adminReply ? (
              <div className="border-l-2 border-primary/50 bg-primary/5 rounded-r px-2 py-1.5 space-y-1">
                <p className="text-[10px] text-primary font-medium">관리자 답글</p>
                <p className="text-xs text-foreground whitespace-pre-wrap break-words">{f.adminReply}</p>
                {f.repliedAt && (
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(f.repliedAt).toLocaleString('ko-KR')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">답변 대기 중입니다.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
