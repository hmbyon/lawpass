'use client'

import { useState } from 'react'
import { getChoiceMemosFor, saveChoiceMemoFor } from '@/lib/store'

/**
 * 선지·보기별 메모. 선학습(study-tab)과 같은 저장소(getChoiceMemosFor / saveChoiceMemoFor)를 쓰므로
 * 어느 화면에서 쓰든 같은 메모가 보인다. 오답노트와 따로 저장돼서, 메모만 써도 오답노트에 항목이 생기지 않는다.
 * 키는 선지 번호(①~⑤)나 보기 라벨(ㄱㄴㄷ)이다.
 */
export function useChoiceMemos(questionId: string) {
  const [memos, setMemos] = useState<Record<string, string>>(() => getChoiceMemosFor(questionId))
  const [openLabel, setOpenLabel] = useState<string | null>(null)
  const [text, setText] = useState('')

  function toggle(label: string) {
    if (openLabel === label) {
      setOpenLabel(null)
      setText('')
    } else {
      setOpenLabel(label)
      setText(memos[label] ?? '')
    }
  }
  function close() {
    setOpenLabel(null)
    setText('')
  }
  function save(label: string, memo: string) {
    saveChoiceMemoFor(questionId, label, memo)
    setMemos((prev) => {
      const next = { ...prev }
      if (memo.trim()) next[label] = memo
      else delete next[label]
      return next
    })
    close()
  }
  return { memos, openLabel, text, setText, toggle, close, save }
}

export type ChoiceMemoState = ReturnType<typeof useChoiceMemos>

/** 선지·보기 줄 옆에 두는 🖊️(메모 없음) / 📌(메모 있음) 버튼. 줄 전체를 누르는 동작과 겹치지 않게 전파를 막는다 */
export function ChoiceMemoButton({ label, m, className = '' }: { label: string; m: ChoiceMemoState; className?: string }) {
  const has = Boolean(m.memos[label])
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        m.toggle(label)
      }}
      aria-label={has ? '메모 보기·고치기' : '메모 쓰기'}
      title={has ? '메모 보기·고치기' : '이 항목에 메모'}
      className={`shrink-0 text-xs px-1 py-0.5 rounded transition-colors ${
        has ? 'text-yellow-500 hover:text-yellow-400' : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
    >
      {has ? '📌' : '🖊️'}
    </button>
  )
}

/** 저장된 메모를 보여 주거나(닫혀 있을 때), 열려 있으면 입력칸을 보여 준다 */
export function ChoiceMemoPanel({ label, m, className = '' }: { label: string; m: ChoiceMemoState; className?: string }) {
  const memo = m.memos[label]
  const isOpen = m.openLabel === label
  return (
    <>
      {memo && !isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`px-2 py-1 bg-yellow-100 text-yellow-900 border-l-2 border-yellow-500/50 rounded-r text-xs dark:bg-yellow-900/20 dark:text-yellow-300 ${className}`}
        >
          📌 {memo}
        </div>
      )}
      {isOpen && (
        <div onClick={(e) => e.stopPropagation()} className={`space-y-1.5 ${className}`}>
          <textarea
            value={m.text}
            onChange={(e) => m.setText(e.target.value)}
            placeholder="이 항목에서 유의할 점을 메모하세요..."
            rows={2}
            autoFocus
            className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={m.close} className="text-xs text-muted-foreground hover:text-foreground">
              취소
            </button>
            {memo && (
              <button type="button" onClick={() => m.save(label, '')} className="text-xs text-red-400 hover:text-red-300">
                삭제
              </button>
            )}
            <button
              type="button"
              onClick={() => m.save(label, m.text)}
              className="text-xs text-primary font-medium hover:opacity-80"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </>
  )
}
