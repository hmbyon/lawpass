'use client'

interface FilterChipsProps<T extends string> {
  options: T[]
  selected: T[]
  onChange: (selected: T[]) => void
  single?: boolean
}

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  single = false,
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
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
