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
  // 아무 항목도 명시적으로 고르지 않아 "전체 포함"으로 동작하는 상태.
  // 칩은 전부 선택된 것처럼 보이되 selected 는 비어 있는 그대로다 — 여기서 하나를 누르면
  // 그것만 남는 실제 부분 선택으로 넘어간다 (필터 로직은 손대지 않는다)
  allImplied?: boolean
}

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  single = false,
  available,
  centered = false,
  allImplied = false,
}: FilterChipsProps<T>) {
  function selectable(opt: T) {
    return !available || available.includes(opt)
  }

  function toggle(opt: T) {
    if (!selectable(opt)) return // 데이터 없는 항목은 선택되지 않는다
    // 전체 포함 상태에서 하나를 누르면 "그것만"이다. 더하기로 치면 방금 전까지 전부
    // 포함이던 것이 티 안 나게 하나만 남아, 누른 사람이 뺀 적 없는 것들이 빠진다
    if (allImplied) {
      onChange([opt])
      return
    }
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
        const canSelect = selectable(opt)
        // 데이터가 없는 항목은 전체 포함 상태에서도 회색이다 — 결과에 아무것도 안 보태므로
        const active = selected.includes(opt) || (allImplied && canSelect)
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
