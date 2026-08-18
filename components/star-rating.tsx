'use client'

export function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  // undefined/문자열/범위 밖 값이 들어와도 별이 통째로 비어 보이지 않도록 정규화
  const filled = Math.min(max, Math.max(0, Math.round(Number(value) || 0)))
  return (
    <span className="text-yellow-400 text-sm" aria-label={`위험도 ${filled}/${max}`}>
      {Array.from({ length: max }, (_, i) =>
        i < filled ? '★' : '☆'
      ).join('')}
    </span>
  )
}
