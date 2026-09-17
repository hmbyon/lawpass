import type { TableBlock, TableCell } from './types'

/**
 * 지문 표(passageTable)의 칸 정규화·배치·편집 연산.
 *
 * 저장 모양은 HTML 표와 같다 — 행마다 '실제로 있는 칸'만 적고, 병합으로 가려진 자리는 비운다.
 * 이 모양은 저장하기엔 좋지만 다루기엔 까다롭다. 2행 1열 자리가 비어 있는 것이 '위 칸에
 * 가려져서'인지 '행이 짧아서'인지는 앞 행들을 다 훑어야 안다. 그래서
 *
 *  - 화면에 그릴 때는 layoutTable 로 격자 위의 자리를 먼저 정하고
 *  - 편집할 때는 EditGrid(격자를 빈틈 없이 나눈 직사각형 목록)로 바꿔 다룬 뒤
 *  - 저장할 때만 다시 행별 칸 목록으로 되돌린다
 *
 * 병합으로 가려진 자리를 건너뛰는 규칙은 layoutTable 한 곳에만 있다. 렌더러와 편집기가
 * 둘 다 이것을 거치므로, 규칙이 틀리면 두 곳이 같이 틀리고 고칠 곳도 하나다
 */

export interface NormalizedCell {
  text: string
  rowspan: number
  colspan: number
}

/** 문자열이면 병합 없는 칸, 객체면 빠진 span 을 1로 채운다. 1보다 작거나 숫자가 아닌 값도 1로 본다 */
export function normalizeCell(cell: TableCell): NormalizedCell {
  if (typeof cell === 'string') return { text: cell, rowspan: 1, colspan: 1 }
  const span = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1)
  return { text: typeof cell?.text === 'string' ? cell.text : '', rowspan: span(cell?.rowspan), colspan: span(cell?.colspan) }
}

// ── 배치 ────────────────────────────────────────────────────────────────

export interface PlacedCell {
  r: number
  c: number
  rowspan: number
  colspan: number
  text: string
  // 저장 배열에서의 자리. 형광펜 키가 이것으로 만들어진다. 빈틈을 메운 칸은 null
  source: { ri: number; ci: number } | null
}

export interface TableLayout {
  rows: number
  cols: number
  cells: PlacedCell[] // 행 → 열 순
}

// 옛 표의 열 수가 이보다 크면 최소공배수 대신 가장 긴 행의 칸 수를 쓴다.
// 5칸 행과 7칸 행이 섞이면 공배수가 35열이 되어 편집기에서 다룰 수 없다
const LEGACY_MAX_COLS = 12

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** 칸 중 하나라도 객체면 편집기가 만든(또는 병합 정보가 있는) 표다 */
export function isGridTable(table: TableBlock): boolean {
  return table.rows.some((row) => row.cells.some((cell) => typeof cell !== 'string'))
}

/**
 * 표의 칸마다 격자 위 자리를 정한다.
 *
 * 문자열만 있는 옛 표는 **행마다 폭을 고르게 나눈다.** 예전 화면이 그렇게 그렸고, 추출기도
 * 그걸 전제로 "1칸(전체폭)/2칸/4칸"을 섞어 낸다(문10 위치관계도: 1행 "공로" 1칸, 2행 A·B·C 3칸).
 * 칸을 곧이곧대로 1×1 로 놓으면 "공로"가 첫 칸에만 들어가 표가 깨진다. 그래서 열 수를 행 칸 수의
 * 최소공배수로 잡고, 각 칸이 그 행 안에서 같은 폭을 차지하도록 colspan 을 계산한다. 모든 행의
 * 칸 수가 같으면 colspan 은 전부 1 — 곧 normalizeCell 이 말하는 '병합 없는 칸'과 같다.
 *
 * 객체 칸이 섞인 표는 HTML 표와 똑같이 놓는다. 위 행의 rowspan 이 차지한 자리를 건너뛰며
 * 왼쪽부터 채우고, 어느 칸도 차지하지 않은 자리는 빈 칸으로 메운다(행이 짧은 경우)
 */
export function layoutTable(table: TableBlock): TableLayout {
  const rowCount = table.rows.length
  if (rowCount === 0) return { rows: 0, cols: 0, cells: [] }

  if (!isGridTable(table)) {
    const lengths = table.rows.map((row) => row.cells.length)
    const nonEmpty = lengths.filter((n) => n > 0)
    let cols = nonEmpty.reduce((acc, n) => (acc * n) / gcd(acc, n), 1)
    if (cols > LEGACY_MAX_COLS) cols = Math.max(1, ...nonEmpty)
    const cells: PlacedCell[] = []
    table.rows.forEach((row, ri) => {
      const n = row.cells.length
      if (n === 0) {
        cells.push({ r: ri, c: 0, rowspan: 1, colspan: cols, text: '', source: null })
        return
      }
      // 나누어떨어지지 않으면(열 수를 줄인 경우) 남는 폭은 마지막 칸이 받는다
      const base = Math.max(1, Math.floor(cols / n))
      let c = 0
      row.cells.forEach((cell, ci) => {
        const colspan = ci === n - 1 ? Math.max(1, cols - c) : base
        cells.push({ r: ri, c, rowspan: 1, colspan, text: normalizeCell(cell).text, source: { ri, ci } })
        c += colspan
      })
    })
    return { rows: rowCount, cols, cells }
  }

  const taken: boolean[][] = Array.from({ length: rowCount }, () => [])
  const placed: PlacedCell[] = []
  table.rows.forEach((row, ri) => {
    let c = 0
    row.cells.forEach((cell, ci) => {
      const n = normalizeCell(cell)
      while (taken[ri][c]) c++
      // 표 밖으로 뻗는 rowspan 은 표 끝에서 자른다 (HTML 도 그렇게 그린다)
      const rowspan = Math.min(n.rowspan, rowCount - ri)
      for (let r = ri; r < ri + rowspan; r++) {
        for (let cc = c; cc < c + n.colspan; cc++) taken[r][cc] = true
      }
      placed.push({ r: ri, c, rowspan, colspan: n.colspan, text: n.text, source: { ri, ci } })
      c += n.colspan
    })
  })
  const cols = Math.max(1, ...taken.map((line) => line.length))
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < cols; c++) {
      if (!taken[r][c]) placed.push({ r, c, rowspan: 1, colspan: 1, text: '', source: null })
    }
  }
  placed.sort((a, b) => a.r - b.r || a.c - b.c)
  return { rows: rowCount, cols, cells: placed }
}

// ── 편집 격자 ───────────────────────────────────────────────────────────

export interface GridRect {
  r: number
  c: number
  rowspan: number
  colspan: number
  text: string
}

/** rows×cols 격자를 빈틈도 겹침도 없이 나눈 직사각형들. 편집 중에는 늘 이 불변식을 지킨다 */
export interface EditGrid {
  title: string
  rows: number
  cols: number
  rects: GridRect[]
}

export interface Selection {
  r1: number
  c1: number
  r2: number
  c2: number
}

const sortRects = (rects: GridRect[]) => [...rects].sort((a, b) => a.r - b.r || a.c - b.c)

export function emptyGrid(rows = 1, cols = 1, title = ''): EditGrid {
  const rects: GridRect[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ r, c, rowspan: 1, colspan: 1, text: '' })
  return { title, rows, cols, rects }
}

export function gridFromTable(table: TableBlock): EditGrid {
  const layout = layoutTable(table)
  if (layout.rows === 0) return emptyGrid(1, 1, table.title ?? '')
  return {
    title: table.title ?? '',
    rows: layout.rows,
    cols: layout.cols,
    rects: layout.cells.map(({ r, c, rowspan, colspan, text }) => ({ r, c, rowspan, colspan, text })),
  }
}

/** 저장 모양으로 되돌린다. 칸은 늘 객체로 적는다 — 정규화가 두 모양을 다 받으므로 되돌릴 이유가 없다 */
export function gridToTable(grid: EditGrid): TableBlock {
  const rows = Array.from({ length: grid.rows }, () => ({ cells: [] as TableCell[] }))
  for (const rect of sortRects(grid.rects)) {
    rows[rect.r].cells.push({ text: rect.text, rowspan: rect.rowspan, colspan: rect.colspan })
  }
  // 제목을 앞에 둔다. 추출기와 이미 저장된 표가 그 순서라, 같은 표가 키 순서만으로 달라 보이지 않게
  const title = grid.title.trim()
  return title ? { title, rows } : { rows }
}

/** 그 자리를 차지한 직사각형 */
export function rectAt(grid: EditGrid, r: number, c: number): GridRect | undefined {
  return grid.rects.find((x) => r >= x.r && r < x.r + x.rowspan && c >= x.c && c < x.c + x.colspan)
}

const inside = (x: GridRect, s: Selection) => x.r >= s.r1 && x.c >= s.c1 && x.r + x.rowspan - 1 <= s.r2 && x.c + x.colspan - 1 <= s.c2
const overlaps = (x: GridRect, s: Selection) => x.r <= s.r2 && x.r + x.rowspan - 1 >= s.r1 && x.c <= s.c2 && x.c + x.colspan - 1 >= s.c1

/** 두 칸을 꼭짓점으로 하는 선택. 병합된 칸을 누르면 그 칸 전체를 포함하도록 넓힌다 */
export function selectionBetween(grid: EditGrid, a: { r: number; c: number }, b: { r: number; c: number }): Selection {
  const ra = rectAt(grid, a.r, a.c)
  const rb = rectAt(grid, b.r, b.c)
  const box = (x: GridRect | undefined, p: { r: number; c: number }) =>
    x ? { r1: x.r, c1: x.c, r2: x.r + x.rowspan - 1, c2: x.c + x.colspan - 1 } : { r1: p.r, c1: p.c, r2: p.r, c2: p.c }
  const A = box(ra, a)
  const B = box(rb, b)
  return { r1: Math.min(A.r1, B.r1), c1: Math.min(A.c1, B.c1), r2: Math.max(A.r2, B.r2), c2: Math.max(A.c2, B.c2) }
}

export type Check = { ok: true } | { ok: false; reason: string }

export function canMerge(grid: EditGrid, s: Selection): Check {
  const touched = grid.rects.filter((x) => overlaps(x, s))
  if (touched.length <= 1) return { ok: false, reason: '두 칸 이상을 골라야 병합할 수 있습니다' }
  // 선택 상자 밖으로 삐져나간 병합 칸이 있으면, 합친 결과가 직사각형이 되지 않는다
  const sticking = touched.find((x) => !inside(x, s))
  if (sticking) {
    return {
      ok: false,
      reason: `이미 병합된 칸(${sticking.r + 1}행 ${sticking.c + 1}열부터)이 선택 범위 밖으로 걸쳐 있어 직사각형이 되지 않습니다 — 그 칸을 모두 포함하도록 고르거나 먼저 분리하세요`,
    }
  }
  return { ok: true }
}

/** 선택한 칸들을 하나로. 적혀 있던 글은 버리지 않고 위→아래, 왼→오 순으로 줄을 바꿔 잇는다 */
export function mergeCells(grid: EditGrid, s: Selection): EditGrid {
  if (!canMerge(grid, s).ok) return grid
  const inSel = sortRects(grid.rects.filter((x) => inside(x, s)))
  const text = inSel.map((x) => x.text).filter((t) => t.trim()).join('\n')
  const merged: GridRect = { r: s.r1, c: s.c1, rowspan: s.r2 - s.r1 + 1, colspan: s.c2 - s.c1 + 1, text }
  return { ...grid, rects: sortRects([...grid.rects.filter((x) => !inside(x, s)), merged]) }
}

export function canSplit(grid: EditGrid, s: Selection): Check {
  const touched = grid.rects.filter((x) => overlaps(x, s))
  if (touched.length !== 1) return { ok: false, reason: '병합된 칸 하나만 골라야 분리할 수 있습니다' }
  const [x] = touched
  if (x.rowspan === 1 && x.colspan === 1) return { ok: false, reason: '병합되지 않은 칸입니다' }
  return { ok: true }
}

/** 병합을 풀어 1×1 칸들로. 글은 왼쪽 위 칸에만 남긴다 */
export function splitCell(grid: EditGrid, s: Selection): EditGrid {
  if (!canSplit(grid, s).ok) return grid
  const x = grid.rects.find((rect) => overlaps(rect, s))!
  const pieces: GridRect[] = []
  for (let r = x.r; r < x.r + x.rowspan; r++) {
    for (let c = x.c; c < x.c + x.colspan; c++) {
      pieces.push({ r, c, rowspan: 1, colspan: 1, text: r === x.r && c === x.c ? x.text : '' })
    }
  }
  return { ...grid, rects: sortRects([...grid.rects.filter((rect) => rect !== x), ...pieces]) }
}

export function setCellText(grid: EditGrid, r: number, c: number, text: string): EditGrid {
  const target = rectAt(grid, r, c)
  if (!target) return grid
  return { ...grid, rects: grid.rects.map((x) => (x === target ? { ...x, text } : x)) }
}

/**
 * at 번째 행 앞에 새 행을 넣는다 (at === rows 면 맨 아래).
 * 병합 칸의 한가운데로 끼어들면 그 병합을 한 행 늘려 모양을 유지하고, 나머지 자리는 빈 칸으로 채운다
 */
export function insertRow(grid: EditGrid, at: number): EditGrid {
  const rects = grid.rects.map((x) => {
    if (x.r >= at) return { ...x, r: x.r + 1 }
    if (x.r < at && x.r + x.rowspan > at) return { ...x, rowspan: x.rowspan + 1 }
    return x
  })
  const next = { ...grid, rows: grid.rows + 1, rects }
  return fillGaps(next)
}

export function insertCol(grid: EditGrid, at: number): EditGrid {
  const rects = grid.rects.map((x) => {
    if (x.c >= at) return { ...x, c: x.c + 1 }
    if (x.c < at && x.c + x.colspan > at) return { ...x, colspan: x.colspan + 1 }
    return x
  })
  const next = { ...grid, cols: grid.cols + 1, rects }
  return fillGaps(next)
}

/** from~to 행을 지운다. 걸쳐 있던 병합 칸은 줄어들고, 통째로 들어 있던 칸은 사라진다. 행이 하나도 안 남게는 못 지운다 */
export function deleteRows(grid: EditGrid, from: number, to: number): EditGrid {
  const n = to - from + 1
  if (n <= 0 || n >= grid.rows) return grid
  const rects: GridRect[] = []
  for (const x of grid.rects) {
    const top = x.r
    const bottom = x.r + x.rowspan - 1
    if (bottom < from) rects.push(x)
    else if (top > to) rects.push({ ...x, r: x.r - n })
    else {
      const kept = x.rowspan - (Math.min(bottom, to) - Math.max(top, from) + 1)
      if (kept > 0) rects.push({ ...x, r: Math.min(top, from), rowspan: kept })
    }
  }
  return { ...grid, rows: grid.rows - n, rects: sortRects(rects) }
}

export function deleteCols(grid: EditGrid, from: number, to: number): EditGrid {
  const n = to - from + 1
  if (n <= 0 || n >= grid.cols) return grid
  const rects: GridRect[] = []
  for (const x of grid.rects) {
    const left = x.c
    const right = x.c + x.colspan - 1
    if (right < from) rects.push(x)
    else if (left > to) rects.push({ ...x, c: x.c - n })
    else {
      const kept = x.colspan - (Math.min(right, to) - Math.max(left, from) + 1)
      if (kept > 0) rects.push({ ...x, c: Math.min(left, from), colspan: kept })
    }
  }
  return { ...grid, cols: grid.cols - n, rects: sortRects(rects) }
}

/** 어느 칸도 차지하지 않은 자리를 빈 1×1 칸으로 채운다 */
function fillGaps(grid: EditGrid): EditGrid {
  const rects = [...grid.rects]
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!rectAt({ ...grid, rects }, r, c)) rects.push({ r, c, rowspan: 1, colspan: 1, text: '' })
    }
  }
  return { ...grid, rects: sortRects(rects) }
}

/** 불변식 검사 — 모든 자리가 정확히 한 칸에 속하는가. 어긋나면 그 이유를 돌려준다 */
export function gridProblem(grid: EditGrid): string | null {
  const owner: number[][] = Array.from({ length: grid.rows }, () => Array(grid.cols).fill(-1))
  for (let i = 0; i < grid.rects.length; i++) {
    const x = grid.rects[i]
    if (x.rowspan < 1 || x.colspan < 1) return `${i}번 칸의 span 이 1보다 작습니다`
    if (x.r < 0 || x.c < 0 || x.r + x.rowspan > grid.rows || x.c + x.colspan > grid.cols) return `${i}번 칸이 격자 밖으로 나갑니다`
    for (let r = x.r; r < x.r + x.rowspan; r++) {
      for (let c = x.c; c < x.c + x.colspan; c++) {
        if (owner[r][c] !== -1) return `${r},${c} 자리를 두 칸이 차지합니다`
        owner[r][c] = i
      }
    }
  }
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (owner[r][c] === -1) return `${r},${c} 자리가 비었습니다`
  return null
}
