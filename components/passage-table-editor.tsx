'use client'

import { useMemo, useRef, useState } from 'react'
import type { TableBlock } from '@/lib/types'
import { loadHighlights } from '@/lib/highlights'
import {
  type EditGrid,
  type Selection,
  canMerge,
  canSplit,
  deleteCols,
  deleteRows,
  emptyGrid,
  gridFromTable,
  gridToTable,
  insertCol,
  insertRow,
  mergeCells,
  rectAt,
  selectionBetween,
  setCellText,
  splitCell,
} from '@/lib/tableGrid'

/**
 * 지문 표 편집기 (검토 화면 전용).
 *
 * 편집 중에는 저장 모양(행별 칸 목록 + span)을 직접 만지지 않는다. lib/tableGrid 의 EditGrid —
 * 격자를 빈틈 없이 나눈 직사각형 목록 — 으로 다루고, 저장할 때만 되돌린다. 병합·분리·행열
 * 추가 삭제가 모두 그 불변식을 지키는 순수 함수라, 이 컴포넌트는 선택과 버튼만 맡는다.
 *
 * 저장 전까지는 아무것도 바뀌지 않는다. 취소하면 연 순간의 표 그대로다
 */

interface Props {
  questionId: string
  tables: TableBlock[] | undefined
  onSave: (tables: TableBlock[]) => void
  onCancel: () => void
}

const button =
  'px-2 py-0.5 border border-border text-muted-foreground rounded text-[11px] hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

export function PassageTableEditor({ questionId, tables, onSave, onCancel }: Props) {
  const [grids, setGrids] = useState<EditGrid[]>(() => (tables ?? []).map(gridFromTable))
  const [active, setActive] = useState(0)
  const [sel, setSel] = useState<Selection | null>(null)
  const anchor = useRef<{ r: number; c: number } | null>(null)
  const dragging = useRef(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // 선학습 화면에서 표 칸에 칠한 형광펜은 '행·칸 자리'로 저장돼 있다. 병합·분리나 행열 변경으로
  // 칸의 자리가 바뀌면 그 형광펜이 다른 칸에 붙거나 사라진다. 이 기기에 칠해 둔 것만 셀 수 있다
  const marked = useMemo(
    () => loadHighlights(questionId).filter((h) => h.field.startsWith('ptable_')).length,
    [questionId]
  )

  const grid = grids[active] as EditGrid | undefined

  function update(fn: (g: EditGrid) => EditGrid) {
    setGrids((prev) => prev.map((g, i) => (i === active ? fn(g) : g)))
  }

  function pick(r: number, c: number, extend: boolean) {
    if (!grid) return
    if (!extend || !anchor.current) anchor.current = { r, c }
    setSel(selectionBetween(grid, anchor.current, { r, c }))
  }

  // 마우스·터치·펜 모두 같은 길로 받는다. 끌기 중에는 손가락 밑의 칸을 좌표로 찾는다 —
  // 터치는 누른 요소에 포인터가 붙잡혀 옆 칸의 enter 이벤트가 오지 않는다
  function cellUnder(e: React.PointerEvent): { r: number; c: number } | null {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('td[data-r]')
    if (!el) return null
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) }
  }

  // ── 선택에서 파생되는 것들 ──
  const touched = grid && sel ? grid.rects.filter((x) => x.r <= sel.r2 && x.r + x.rowspan - 1 >= sel.r1 && x.c <= sel.c2 && x.c + x.colspan - 1 >= sel.c1) : []
  const single = touched.length === 1 ? touched[0] : null
  const mergeCheck = grid && sel ? canMerge(grid, sel) : null
  const splitCheck = grid && sel ? canSplit(grid, sel) : null
  const rowsInSel = sel ? sel.r2 - sel.r1 + 1 : 0
  const colsInSel = sel ? sel.c2 - sel.c1 + 1 : 0

  const isSelected = (r: number, c: number) => !!sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2

  function addTable() {
    setGrids((prev) => [...prev, emptyGrid(1, 1)])
    setActive(grids.length)
    setSel(null)
  }

  function removeTable() {
    setGrids((prev) => prev.filter((_, i) => i !== active))
    setActive((i) => Math.max(0, i - 1))
    setSel(null)
  }

  return (
    <div className="space-y-2 rounded border border-primary/30 bg-card p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] font-medium text-foreground">표 편집</p>
        {grids.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setActive(i)
              setSel(null)
            }}
            className={`${button} ${i === active ? 'border-primary/50 text-primary' : ''}`}
          >
            표 {i + 1}
          </button>
        ))}
        <button type="button" onClick={addTable} className={button}>
          {grids.length === 0 ? '새 표 만들기' : '+ 표 추가'}
        </button>
        {grid && (
          <button type="button" onClick={removeTable} className={`${button} border-red-400/40 text-red-400 hover:bg-red-400/10`}>
            이 표 빼기
          </button>
        )}
      </div>

      {grid ? (
        <>
          <input
            value={grid.title}
            onChange={(e) => update((g) => ({ ...g, title: e.target.value }))}
            placeholder="표 제목 (예: 공로(公路)) — 비우면 제목 없이"
            className="w-full rounded border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
          />

          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={button} onClick={() => { update((g) => insertRow(g, sel ? sel.r2 + 1 : g.rows)); setSel(null) }}>
              행 추가{sel ? ' (선택 아래)' : ''}
            </button>
            <button
              type="button"
              className={button}
              disabled={!sel || rowsInSel >= grid.rows}
              title={!sel ? '지울 행을 고르세요' : rowsInSel >= grid.rows ? '행을 모두 지울 수는 없습니다' : undefined}
              onClick={() => { if (sel) update((g) => deleteRows(g, sel.r1, sel.r2)); setSel(null) }}
            >
              행 삭제
            </button>
            <button type="button" className={button} onClick={() => { update((g) => insertCol(g, sel ? sel.c2 + 1 : g.cols)); setSel(null) }}>
              열 추가{sel ? ' (선택 오른쪽)' : ''}
            </button>
            <button
              type="button"
              className={button}
              disabled={!sel || colsInSel >= grid.cols}
              title={!sel ? '지울 열을 고르세요' : colsInSel >= grid.cols ? '열을 모두 지울 수는 없습니다' : undefined}
              onClick={() => { if (sel) update((g) => deleteCols(g, sel.c1, sel.c2)); setSel(null) }}
            >
              열 삭제
            </button>
            <button
              type="button"
              className={button}
              disabled={!mergeCheck?.ok}
              onClick={() => {
                if (!sel) return
                update((g) => mergeCells(g, sel))
                anchor.current = { r: sel.r1, c: sel.c1 }
              }}
            >
              병합
            </button>
            <button
              type="button"
              className={button}
              disabled={!splitCheck?.ok}
              onClick={() => {
                if (!sel) return
                update((g) => splitCell(g, sel))
                setSel({ r1: sel.r1, c1: sel.c1, r2: sel.r1, c2: sel.c1 })
              }}
            >
              분리
            </button>
            <span className="text-[11px] text-muted-foreground">
              {grid.rows}행 × {grid.cols}열
            </span>
          </div>

          {/* 두 칸 이상 골랐는데 병합이 안 되면 그 이유를 적는다. 버튼만 흐려서는 왜인지 모른다 */}
          {sel && touched.length > 1 && mergeCheck && !mergeCheck.ok && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">병합할 수 없습니다 — {mergeCheck.reason}</p>
          )}

          <table
            className="w-full table-fixed border-collapse select-none touch-none"
            onPointerMove={(e) => {
              if (!dragging.current) return
              const hit = cellUnder(e)
              if (hit) pick(hit.r, hit.c, true)
            }}
            onPointerUp={() => { dragging.current = false }}
            onPointerCancel={() => { dragging.current = false }}
          >
            <tbody>
              {Array.from({ length: grid.rows }, (_, r) => (
                <tr key={r}>
                  {grid.rects
                    .filter((x) => x.r === r)
                    .map((x) => (
                      <td
                        key={`${x.r}_${x.c}`}
                        data-r={x.r}
                        data-c={x.c}
                        rowSpan={x.rowspan > 1 ? x.rowspan : undefined}
                        colSpan={x.colspan > 1 ? x.colspan : undefined}
                        onPointerDown={(e) => {
                          e.preventDefault()
                          dragging.current = true
                          pick(x.r, x.c, e.shiftKey)
                        }}
                        onDoubleClick={() => textRef.current?.focus()}
                        className={`h-8 cursor-pointer border border-border px-1.5 py-1 align-top text-xs whitespace-pre-wrap break-words ${
                          isSelected(x.r, x.c) ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted/60'
                        }`}
                      >
                        {x.text}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-0.5">
            <p className="text-[11px] text-muted-foreground">
              {single
                ? `선택한 칸 내용 (${single.r + 1}행 ${single.c + 1}열${single.rowspan > 1 || single.colspan > 1 ? ` · ${single.rowspan}×${single.colspan} 병합` : ''})`
                : '칸 하나를 고르면 내용을 고칠 수 있습니다. 끌거나 Shift+클릭으로 여러 칸을 고릅니다'}
            </p>
            <textarea
              ref={textRef}
              value={single ? rectAt(grid, single.r, single.c)?.text ?? '' : ''}
              disabled={!single}
              onChange={(e) => single && update((g) => setCellText(g, single.r, single.c, e.target.value))}
              rows={2}
              className="w-full rounded border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50"
            />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">표가 없습니다. &apos;새 표 만들기&apos;로 빈 1×1 표부터 시작하세요</p>
      )}

      <p className="text-[11px] text-amber-600 dark:text-amber-400">
        ⚠ 칸을 병합·분리하거나 행·열을 바꾸면, 선학습 화면에서 표에 칠해 둔 형광펜 위치가 어긋날 수 있습니다
        {marked > 0 ? ` — 이 기기에만 ${marked}개가 칠해져 있습니다` : ''}. 다른 기기의 형광펜은 여기서 알 수 없습니다
      </p>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSave(grids.map(gridToTable))}
          className="px-2 py-0.5 border border-primary/40 text-primary rounded text-[11px] hover:bg-primary/10 transition-colors"
        >
          저장
        </button>
        <button type="button" onClick={onCancel} className={button}>
          취소
        </button>
        {grids.length === 0 && (tables?.length ?? 0) > 0 && (
          <span className="text-[11px] text-muted-foreground">표를 모두 뺀 채 저장하면 표가 지워집니다</span>
        )}
      </div>
    </div>
  )
}
