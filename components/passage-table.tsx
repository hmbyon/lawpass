'use client'

import type { TableBlock } from '@/lib/types'
import type { Highlight } from '@/lib/highlights'
import { renderHighlighted } from '@/lib/highlights'

interface PassageTableProps {
  tables: TableBlock[]
  // 형광펜 관련 props는 선택적이다. 넘기지 않으면(CBT 모드) 평문으로만 렌더된다
  fieldPrefix?: string
  highlights?: Highlight[]
  onRemoveHighlight?: (id: string) => void
  registerRef?: (key: string, el: HTMLElement | null) => void
}

// 지문 안의 표/서식을 원본 레이아웃에 가깝게 보여준다.
// 픽셀 단위 재현이 아니라 칸·행 구분이 눈에 들어오는 수준을 목표로 한다
export function PassageTable({
  tables,
  fieldPrefix = 'ptable',
  highlights,
  onRemoveHighlight,
  registerRef,
}: PassageTableProps) {
  if (tables.length === 0) return null

  return (
    <div className="space-y-2">
      {tables.map((table, ti) => (
        <div key={ti} className="border border-border rounded-lg overflow-hidden">
          {table.title && (
            <div className="bg-muted px-2 py-1 text-[11px] font-semibold text-foreground border-b border-border">
              {table.title}
            </div>
          )}
          {table.rows.map((row, ri) => (
            <div key={ri} className={`flex ${ri > 0 ? 'border-t border-border' : ''}`}>
              {row.cells.map((cell, ci) => {
                const key = `${fieldPrefix}_${ti}_${ri}_${ci}`
                return (
                  <div
                    key={ci}
                    ref={(el) => registerRef?.(key, el)}
                    className={`flex-1 min-w-0 px-2 py-1.5 text-xs text-foreground leading-relaxed whitespace-pre-wrap break-words select-text ${
                      ci > 0 ? 'border-l border-border' : ''
                    }`}
                  >
                    {highlights
                      ? renderHighlighted(cell, key, highlights, onRemoveHighlight)
                      : cell}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
