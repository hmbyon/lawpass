'use client'

interface FilterChipsProps<T extends string> {
  options: T[]
  selected: T[]
  onChange: (selected: T[]) => void
  single?: boolean
  // 실제 데이터가 있는 항목. 넘기면 없는 항목은 흐리게 표시된다 (선택은 여전히 가능)
  available?: T[]
}

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  single = false,
  available,
}: FilterChipsProps<T>) {
  function toggle(opt: T) {
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
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt)
        const hasData = !available || available.includes(opt)
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            title={hasData ? undefined : '해당하는 문제가 아직 없습니다'}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : hasData
                  ? 'bg-primary/10 text-primary border-primary/40 hover:border-primary'
                  : 'bg-muted/50 text-muted-foreground/50 border-border hover:border-primary/30'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
