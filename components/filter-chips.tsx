'use client'

interface FilterChipsProps<T extends string> {
  options: T[]
  selected: T[]
  onChange: (selected: T[]) => void
  single?: boolean
  // 실제 데이터가 있는 항목. 넘기면 여기 없는 항목은 선택 자체가 막힌다
  // (선택 = 필터 적용이므로, 데이터 없는 값을 선택하면 결과가 0문제가 된다)
  available?: T[]
  centered?: boolean
}

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  single = false,
  available,
  centered = false,
}: FilterChipsProps<T>) {
  function selectable(opt: T) {
    return !available || available.includes(opt)
  }

  function toggle(opt: T) {
    if (!selectable(opt)) return // 데이터 없는 항목은 선택되지 않는다
    if (single) {
      onChange(selected.includes(opt) ? [] : [opt])
      return
    }
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  return (
    <div className={`flex flex-wrap gap-2 ${centered ? 'justify-center' : ''}`}>
      {options.map((opt) => {
        const active = selected.includes(opt)
        const canSelect = selectable(opt)
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            title={canSelect ? undefined : '해당하는 문제가 아직 없습니다'}
            // 선택됨 = 진한 보라, 그 외에는 모두 회색 (중간 단계 없음)
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : canSelect
                  ? 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  : 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
