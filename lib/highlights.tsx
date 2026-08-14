import React from 'react'

export type HighlightColor = 'yellow' | 'green' | 'pink'

export interface Highlight {
  id: string
  field: string
  start: number
  end: number
  color: HighlightColor
}

export const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/70 dark:bg-yellow-500/40',
  green: 'bg-emerald-300/70 dark:bg-emerald-500/40',
  pink: 'bg-pink-300/70 dark:bg-pink-500/40',
}

export const HIGHLIGHT_SWATCH_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-400',
  pink: 'bg-pink-400',
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

export function renderHighlighted(
  text: string,
  field: string,
  highlights: Highlight[],
  onRemove?: (id: string) => void
) {
  const fieldHighlights = highlights
    .filter((h) => h.field === field && h.start < h.end && h.end <= text.length)
    .sort((a, b) => a.start - b.start)

  if (fieldHighlights.length === 0) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const h of fieldHighlights) {
    if (h.start > cursor) nodes.push(text.slice(cursor, h.start))
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
        className={`${HIGHLIGHT_CLASSES[h.color]} rounded-sm transition-all ${
          onRemove ? 'hover:bg-red-500/30 hover:line-through hover:decoration-red-500 hover:decoration-2' : ''
        }`}
      >
        {text.slice(h.start, h.end)}
      </mark>
    )
    cursor = Math.max(cursor, h.end)
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}