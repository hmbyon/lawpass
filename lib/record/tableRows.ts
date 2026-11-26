/**
 * 정리본 표: 여러 행에 걸친(rowspan) 칸이 있으면 그 칸 높이를 걸친 행들이 균등하게 나눠 갖게 한다.
 * 브라우저마다 남는 높이를 마지막 행에 몰아주기도 해서, 행 높이(tr style.height)를 직접 정한다.
 * 내용이 균등 몫보다 높은 행은 그 내용 높이를 지키고, 나머지 행들이 남은 높이를 나눈다(water-filling).
 * DOM 을 재는 함수라 브라우저에서만 부른다
 */

function px(v: string): number {
  return parseFloat(v) || 0
}

// 셀 내용 높이 = 위·아래 padding + 위·아래 border 절반씩(border-collapse) + 자식 요소 높이 합
function cellContentHeight(cell: HTMLTableCellElement): number {
  const cs = getComputedStyle(cell)
  let h = px(cs.paddingTop) + px(cs.paddingBottom) + (px(cs.borderTopWidth) + px(cs.borderBottomWidth)) / 2
  for (const child of Array.from(cell.children)) h += child.getBoundingClientRect().height
  return h
}

export function equalizeSpanRows(table: HTMLTableElement): void {
  const rows = Array.from(table.rows)
  // 여러 행에 걸친 칸이 없는 표는 손대지 않는다
  if (!rows.some((tr) => Array.from(tr.cells).some((c) => c.rowSpan > 1))) return
  for (const tr of rows) tr.style.height = ''

  const want = new Map<number, number>()
  rows.forEach((tr, r) => {
    for (const cell of Array.from(tr.cells)) {
      if (cell.rowSpan <= 1) continue
      const idx: number[] = []
      for (let k = r; k < Math.min(r + cell.rowSpan, rows.length); k++) idx.push(k)
      if (idx.length < 2) continue
      const total = cell.getBoundingClientRect().height
      // 걸친 각 행의 자연 높이: 그 행의 한 행짜리 셀들 내용 높이 중 최댓값
      const n = idx.map((k) =>
        Math.max(0, ...Array.from(rows[k].cells).filter((c) => c.rowSpan === 1).map(cellContentHeight))
      )
      const h = new Array<number>(idx.length).fill(0)
      const fixed = new Array<boolean>(idx.length).fill(false)
      for (let iter = 0; iter < idx.length; iter++) {
        const free = fixed.reduce((m, f) => m + (f ? 0 : 1), 0)
        if (free === 0) break
        const used = h.reduce((s, v, i) => s + (fixed[i] ? v : 0), 0)
        const share = (total - used) / free
        let changed = false
        n.forEach((v, i) => {
          if (!fixed[i] && v > share) {
            fixed[i] = true
            h[i] = v
            changed = true
          }
        })
        if (!changed) {
          n.forEach((_, i) => {
            if (!fixed[i]) h[i] = share
          })
          break
        }
      }
      // 여러 칸이 같은 행을 요구하면 큰 쪽
      idx.forEach((k, i) => want.set(k, Math.max(want.get(k) ?? 0, h[i])))
    }
  })

  want.forEach((h, k) => {
    rows[k].style.height = `${h}px`
  })
}
