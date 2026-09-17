'use client'

import type { TableBlock } from '@/lib/types'
import type { Highlight } from '@/lib/highlights'
import { renderHighlighted } from '@/lib/highlights'
import { layoutTable } from '@/lib/tableGrid'

interface PassageTableProps {
  tables: TableBlock[]
  // 형광펜 관련 props는 선택적이다. 넘기지 않으면(CBT 모드) 평문으로만 렌더된다
  fieldPrefix?: string
  highlights?: Highlight[]
  onRemoveHighlight?: (id: string) => void
  registerRef?: (key: string, el: HTMLElement | null) => void
}

// 지문 안의 표/서식을 원본 레이아웃에 가깝게 보여준다.
// 픽셀 단위 재현이 아니라 칸·행 구분이 눈에 들어오는 수준을 목표로 한다.
//
// 표를 그리는 곳은 이 컴포넌트 하나다 (검토 화면·선학습·CBT 가 모두 이것을 쓴다).
// 칸의 자리는 lib/tableGrid 의 layoutTable 이 정한다 — 병합(rowspan·colspan)으로 가려진 자리를
// 건너뛰는 규칙과, 문자열만 있는 옛 표의 행별 폭 나누기가 거기 한 곳에 있다
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
      {tables.map((table, ti) => {
        const layout = layoutTable(table)
        return (
          <div key={ti} className="border border-border rounded-lg overflow-hidden">
            {table.title && (
              <div
                className={`bg-muted px-2 py-1 text-[11px] font-semibold text-foreground ${
                  layout.rows > 0 ? 'border-b border-border' : ''
                }`}
              >
                {table.title}
              </div>
            )}
            {layout.rows > 0 && (
              // table-fixed 로 열 폭을 고르게 둔다. 옛 표는 열 수를 행 칸 수의 공배수로 잡으므로
              // 각 행이 예전(flex-1)처럼 폭을 고르게 나눈 모양 그대로 나온다
              <table className="w-full table-fixed border-collapse">
                <tbody>
                  {Array.from({ length: layout.rows }, (_, r) => (
                    <tr key={r}>
                      {layout.cells
                        .filter((cell) => cell.r === r)
                        .map((cell) => {
                          // 형광펜 키는 저장 배열의 자리로 만든다. 옛 표에서 예전과 같은 키가 나와
                          // 이미 칠해 둔 형광펜이 그대로 붙는다. 빈틈을 메운 칸은 칠할 대상이 아니다
                          const key = cell.source ? `${fieldPrefix}_${ti}_${cell.source.ri}_${cell.source.ci}` : null
                          return (
                            <td
                              key={`${cell.r}_${cell.c}`}
                              rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                              colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                              ref={key ? (el) => registerRef?.(key, el) : undefined}
                              className={`h-7 px-2 py-1.5 align-top text-xs text-foreground leading-relaxed whitespace-pre-wrap break-words select-text ${
                                cell.r > 0 ? 'border-t border-border' : ''
                              } ${cell.c > 0 ? 'border-l border-border' : ''}`}
                            >
                              {key && highlights
                                ? renderHighlighted(cell.text, key, highlights, onRemoveHighlight)
                                : cell.text}
                            </td>
                          )
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
