import type { Question } from '@/lib/types'
import { missingSubItems } from '@/lib/subChoices'

/**
 * 지문 밑에 이어 붙이는 ㄱㄴㄷㄹ 보기. passage 에 보기가 안 들어 있는 문제에서만 그려진다
 * (선학습은 자체 렌더러가 있어 쓰지 않는다)
 */
export function SubItemList({ question, small = false }: { question: Question; small?: boolean }) {
  const items = missingSubItems(question)
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5 pl-3 border-l-2 border-border">
      {items.map((it) => (
        <div key={it.label} className={`flex gap-2 items-start ${small ? 'text-xs' : 'text-sm'}`}>
          <span className="font-semibold text-primary shrink-0">{it.label}.</span>
          <span className="text-foreground flex-1 leading-relaxed whitespace-pre-wrap">{it.text}</span>
        </div>
      ))}
    </div>
  )
}
