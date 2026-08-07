'use client'

export function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="text-yellow-400 text-sm" aria-label={`위험도 ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) =>
        i < value ? '★' : '☆'
      ).join('')}
    </span>
  )
}
