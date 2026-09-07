import React from 'react'

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'orange' | 'red' | 'gray'

// 'fill' = 배경 칠하기(기존 형광펜), 'underline' = 밑줄만,
// 'strike' = 취소선, 'circle' = 동그라미, 'cross' = X표시
// 옛 데이터에는 이 필드가 없으므로 undefined는 'fill'로 취급한다
export type HighlightStyle = 'fill' | 'underline' | 'strike' | 'circle' | 'cross'

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'pink', 'blue', 'purple', 'orange', 'red']

// 선으로 그리는 스타일에서만 회색을 추가로 제공한다 (배경 채우기로는 잘 보이지 않는 색)
export const UNDERLINE_COLORS: HighlightColor[] = [...HIGHLIGHT_COLORS, 'gray']

export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '노랑',
  green: '초록',
  pink: '핑크',
  blue: '파랑',
  purple: '보라',
  orange: '주황',
  red: '빨강',
  gray: '회색',
}

export interface Highlight {
  id: string
  field: string
  start: number
  end: number
  color: HighlightColor
  style?: HighlightStyle // 없으면 'fill' (기존 데이터 호환)
}

export const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/70 dark:bg-yellow-500/40',
  green: 'bg-emerald-300/70 dark:bg-emerald-500/40',
  pink: 'bg-pink-300/70 dark:bg-pink-500/40',
  blue: 'bg-blue-300/70 dark:bg-blue-500/40',
  purple: 'bg-purple-300/70 dark:bg-purple-500/40',
  orange: 'bg-orange-300/70 dark:bg-orange-500/40',
  red: 'bg-red-300/70 dark:bg-red-500/40',
  gray: 'bg-gray-300/70 dark:bg-gray-500/40',
}

// 밑줄 모드: <mark>의 브라우저 기본 배경을 없애고 아래 테두리만 남긴다.
// text-decoration 대신 border를 쓰는 이유는 지우개 hover의 line-through/decoration과 충돌하지 않기 위해서다
export const HIGHLIGHT_UNDERLINE_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-transparent border-b-2 border-yellow-500 dark:border-yellow-400',
  green: 'bg-transparent border-b-2 border-emerald-500 dark:border-emerald-400',
  pink: 'bg-transparent border-b-2 border-pink-500 dark:border-pink-400',
  blue: 'bg-transparent border-b-2 border-blue-500 dark:border-blue-400',
  purple: 'bg-transparent border-b-2 border-purple-500 dark:border-purple-400',
  orange: 'bg-transparent border-b-2 border-orange-500 dark:border-orange-400',
  red: 'bg-transparent border-b-2 border-red-500 dark:border-red-400',
  gray: 'bg-transparent border-b-2 border-gray-500 dark:border-gray-400',
}

// 취소선: 밑줄과 달리 text-decoration 을 그대로 쓴다. 지우개 hover 가 line-through 를
// 신호로 쓰고 있어 겹치는데, 그건 renderHighlighted 에서 이 스타일만 다른 신호로 바꾼다
export const HIGHLIGHT_STRIKE_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-transparent line-through decoration-2 decoration-yellow-500 dark:decoration-yellow-400',
  green: 'bg-transparent line-through decoration-2 decoration-emerald-500 dark:decoration-emerald-400',
  pink: 'bg-transparent line-through decoration-2 decoration-pink-500 dark:decoration-pink-400',
  blue: 'bg-transparent line-through decoration-2 decoration-blue-500 dark:decoration-blue-400',
  purple: 'bg-transparent line-through decoration-2 decoration-purple-500 dark:decoration-purple-400',
  orange: 'bg-transparent line-through decoration-2 decoration-orange-500 dark:decoration-orange-400',
  red: 'bg-transparent line-through decoration-2 decoration-red-500 dark:decoration-red-400',
  gray: 'bg-transparent line-through decoration-2 decoration-gray-500 dark:decoration-gray-400',
}

// 동그라미: 여러 줄에 걸치면 box-decoration-clone 이 줄마다 온전한 상자를 그린다.
// 그게 없으면 첫 줄 왼쪽과 마지막 줄 오른쪽에만 테두리가 붙어 반쪽짜리가 된다
export const HIGHLIGHT_CIRCLE_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-transparent border-2 border-yellow-500 dark:border-yellow-400',
  green: 'bg-transparent border-2 border-emerald-500 dark:border-emerald-400',
  pink: 'bg-transparent border-2 border-pink-500 dark:border-pink-400',
  blue: 'bg-transparent border-2 border-blue-500 dark:border-blue-400',
  purple: 'bg-transparent border-2 border-purple-500 dark:border-purple-400',
  orange: 'bg-transparent border-2 border-orange-500 dark:border-orange-400',
  red: 'bg-transparent border-2 border-red-500 dark:border-red-400',
  gray: 'bg-transparent border-2 border-gray-500 dark:border-gray-400',
}

// X표시: 대각선 두 줄을 겹쳐 ×를 만든다. 한 줄만 그으면 취소선과 구별되지 않는다.
// 그라디언트는 인라인 조각마다 각각 칠해지므로 여러 줄에 걸치면 줄마다 ×가 하나씩 생긴다 —
// 다만 범위가 길수록 대각선이 완만해져 ×보다 리본에 가까워진다. 한 문장 안에서 쓰는 표시다.
//
// bg-transparent 를 빠뜨리면 안 된다. <mark> 의 브라우저 기본 배경(노랑)이 그대로 비쳐,
// 노란 형광펜을 함께 칠한 것처럼 보인다 — 밑줄·취소선·원이 모두 이것을 달고 있는 이유다.
// 색을 임의 값으로 박는 자리라 Tailwind 팔레트의 500 색상값을 그대로 적는다
export const HIGHLIGHT_CROSS_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#eab308_47%,#eab308_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#eab308_47%,#eab308_53%,transparent_53%)]',
  green: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#10b981_47%,#10b981_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#10b981_47%,#10b981_53%,transparent_53%)]',
  pink: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#ec4899_47%,#ec4899_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#ec4899_47%,#ec4899_53%,transparent_53%)]',
  blue: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#3b82f6_47%,#3b82f6_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#3b82f6_47%,#3b82f6_53%,transparent_53%)]',
  purple: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#a855f7_47%,#a855f7_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#a855f7_47%,#a855f7_53%,transparent_53%)]',
  orange: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#f97316_47%,#f97316_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#f97316_47%,#f97316_53%,transparent_53%)]',
  red: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#ef4444_47%,#ef4444_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#ef4444_47%,#ef4444_53%,transparent_53%)]',
  gray: 'bg-transparent bg-[linear-gradient(to_top_right,transparent_47%,#6b7280_47%,#6b7280_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#6b7280_47%,#6b7280_53%,transparent_53%)]',
}

// 색과 무관한 모양. 여기서 한 번만 정해야 rounded-sm 과 원의 반경이 같은 요소에
// 함께 실려 어느 쪽이 이길지 CSS 순서에 맡기는 일이 없다.
//
// 원은 rounded-full(무한대 반경)이 아니라 50% 다. 무한대 반경은 위아래가 곧고 양끝만
// 둥근 알약이 되는데, 손으로 친 동그라미는 그렇게 생기지 않았다. 50% 는 가로·세로
// 반지름을 각각 절반으로 잡아 상자에 꼭 맞는 타원이 되고, 글자가 길어지면 그만큼
// 납작한 타원으로 저절로 늘어난다.
//
// 여백은 px 이 아니라 em 이다. 지문(text-sm)과 선지 해설(text-xs)의 글자 크기가 달라,
// 고정 픽셀로 두면 작은 글씨에서만 헐렁해진다.
//
// 세로 여백이 타원이 글자를 얼마나 품는지를 정한다. 타원은 네 귀퉁이를 잘라내므로
// 0.15em 이면 글자 윗변의 가운데 60% 만 덮고 양끝이 밖으로 나온다. 0.25em 이면 71% 다.
// 더 키우면 더 품지만 위아래 줄을 침범한다 — 여기가 그 절충점이다
const STYLE_SHAPE: Record<HighlightStyle, string> = {
  fill: 'rounded-sm',
  underline: 'rounded-sm',
  strike: 'rounded-sm',
  circle: 'rounded-[50%] px-[0.5em] py-[0.25em] box-decoration-clone',
  cross: 'rounded-sm',
}

const STYLE_COLOR_CLASSES: Record<HighlightStyle, Record<HighlightColor, string>> = {
  fill: HIGHLIGHT_CLASSES,
  underline: HIGHLIGHT_UNDERLINE_CLASSES,
  strike: HIGHLIGHT_STRIKE_CLASSES,
  circle: HIGHLIGHT_CIRCLE_CLASSES,
  cross: HIGHLIGHT_CROSS_CLASSES,
}

/** 스타일마다 고를 수 있는 색. 선으로 그리는 쪽은 회색도 보인다 */
export const STYLE_COLORS: Record<HighlightStyle, HighlightColor[]> = {
  fill: HIGHLIGHT_COLORS,
  underline: UNDERLINE_COLORS,
  strike: UNDERLINE_COLORS,
  circle: UNDERLINE_COLORS,
  cross: UNDERLINE_COLORS,
}

/** 옛 데이터에는 style 이 없다. 모르는 값이 들어와도 배경 칠하기로 돌린다 */
export function styleOf(style: HighlightStyle | undefined): HighlightStyle {
  return style && style in STYLE_COLOR_CLASSES ? style : 'fill'
}

export function highlightClassName(style: HighlightStyle | undefined, color: HighlightColor): string {
  const s = styleOf(style)
  return `${STYLE_SHAPE[s]} ${STYLE_COLOR_CLASSES[s][color]}`
}

export const HIGHLIGHT_SWATCH_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-400',
  pink: 'bg-pink-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  orange: 'bg-orange-400',
  red: 'bg-red-400',
  gray: 'bg-gray-400',
}

export function highlightsKey(questionId: string) {
  return `lawpass_highlights_${questionId}`
}

export function loadHighlights(questionId: string): Highlight[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(highlightsKey(questionId))
    return raw ? (JSON.parse(raw) as Highlight[]) : []
  } catch {
    return []
  }
}

export function saveHighlights(questionId: string, highlights: Highlight[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(highlightsKey(questionId), JSON.stringify(highlights))
  } catch (e) {
    console.error('[highlights] 저장 실패', e)
  }
}

export function withoutOverlaps(highlights: Highlight[], field: string, start: number, end: number) {
  return highlights.filter((h) => h.field !== field || h.end <= start || h.start >= end)
}

// 🧹 빨간색 지우개 커서 SVG
const ERASER_CURSOR_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m7 21-4-3 8.5-8.5a2.12 2.12 0 0 1 3 0l3.5 3.5a2.12 2.12 0 0 1 0 3L9 21'/><path d='m11 7 3 3'/><path d='m19 21-4 0'/></svg>`

// 원본 PDF에서 밑줄로 강조돼 있던 구간 (text 기준 오프셋)
export interface BoldRange {
  start: number
  end: number
}

// 주어진 구간의 텍스트에 볼드 범위를 적용한다.
// absStart는 이 조각이 전체 text에서 시작하는 위치 (하이라이트로 잘린 조각도 정확히 매핑하기 위함)
function applyBold(
  slice: string,
  absStart: number,
  bolds: BoldRange[],
  keyPrefix: string
): React.ReactNode {
  if (bolds.length === 0 || !slice) return slice
  const absEnd = absStart + slice.length
  const overlapping = bolds
    .filter((b) => b.end > absStart && b.start < absEnd)
    .sort((a, b) => a.start - b.start)
  if (overlapping.length === 0) return slice

  const nodes: React.ReactNode[] = []
  let cursor = absStart
  for (const b of overlapping) {
    const start = Math.max(b.start, absStart)
    const end = Math.min(b.end, absEnd)
    if (start > cursor) nodes.push(slice.slice(cursor - absStart, start - absStart))
    nodes.push(
      <strong key={`${keyPrefix}_b${start}`} className="font-bold">
        {slice.slice(start - absStart, end - absStart)}
      </strong>
    )
    cursor = Math.max(cursor, end)
  }
  if (cursor < absEnd) nodes.push(slice.slice(cursor - absStart))
  return nodes
}

/**
 * 지우개 hover 신호.
 *
 * 기본은 빨간 취소선인데, 이미 취소선이 그어진 스타일(취소선)에는 그어봐야 달라지는 것이
 * 없어 지워질 것이라는 신호가 되지 못한다. 그쪽은 흐려지는 것으로 알린다.
 * X표시는 대각선만 있어 가로줄이 겹쳐도 구별된다 — 기본 신호를 그대로 쓴다
 */
function eraserHoverClass(style: HighlightStyle | undefined): string {
  return styleOf(style) === 'strike'
    ? 'hover:bg-red-500/30 hover:opacity-40'
    : 'hover:bg-red-500/30 hover:line-through hover:decoration-red-500 hover:decoration-2'
}

export function renderHighlighted(
  text: string,
  field: string,
  highlights: Highlight[],
  onRemove?: (id: string) => void,
  bolds: BoldRange[] = []
) {
  const fieldHighlights = highlights
    .filter((h) => h.field === field && h.start < h.end && h.end <= text.length)
    .sort((a, b) => a.start - b.start)

  if (fieldHighlights.length === 0) return applyBold(text, 0, bolds, field)

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const h of fieldHighlights) {
    if (h.start > cursor) nodes.push(applyBold(text.slice(cursor, h.start), cursor, bolds, field))
    nodes.push(
      <mark
        key={h.id}
        onClick={(e) => {
          if (onRemove) {
            e.stopPropagation()
            onRemove(h.id)
          }
        }}
        title={onRemove ? '클릭하면 지워집니다 (지우개)' : undefined}
        style={{
          cursor: onRemove ? `url("${ERASER_CURSOR_SVG}") 4 20, pointer` : 'default',
        }}
        className={`${highlightClassName(h.style, h.color)} transition-all ${
          onRemove ? eraserHoverClass(h.style) : ''
        }`}
      >
        {applyBold(text.slice(h.start, h.end), h.start, bolds, field)}
      </mark>
    )
    cursor = Math.max(cursor, h.end)
  }
  if (cursor < text.length) nodes.push(applyBold(text.slice(cursor), cursor, bolds, field))
  return nodes
}