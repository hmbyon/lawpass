'use client'

import type { CauseType } from '@/lib/types'

const CONFIG: Record<CauseType, { label: string; cls: string }> = {
  A: { label: '개념부족', cls: 'bg-red-900/60 text-red-300 border border-red-700/50' },
  B: { label: '암기혼동', cls: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/50' },
  C: { label: '지문오독', cls: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50' },
  study: { label: '선학습실패', cls: 'bg-purple-900/60 text-purple-300 border border-purple-700/50' },
}

export function CauseBadge({ cause }: { cause: CauseType }) {
  const { label, cls } = CONFIG[cause]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}
