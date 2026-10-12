'use client'

import { useCallback, useMemo, useState } from 'react'
import type { WrongNote } from '@/lib/types'
import { SUBJECT_UNITS } from '@/lib/units'
import { FilterChips } from '@/components/filter-chips'

export const NO_UNIT = '단원 미지정'

const keyOf = (subject: string, unit: string) => `${subject}|${unit}`
const unitOf = (note: WrongNote) => note.question.unit?.trim() || NO_UNIT

/**
 * 오답노트·D-1 암기장 카드 목록용 범위(단원) 필터.
 * 과목 칩을 눌러 고른 과목마다 단원 칩이 나오고, 단원을 하나라도 켜면 그 단원 문제만 보인다
 * (아무것도 안 켜면 그 과목은 전부). 단원은 과목별 키로 저장해 형소·민소의 '증거'처럼 이름이 같아도 안 섞인다.
 * 단원 목록은 사용자가 가진 노트에서 뽑는다 — 문제가 없는 단원을 켜서 0건이 되는 일이 없다
 */
export function useUnitFilter(notes: WrongNote[], subjects: string[]) {
  const [picked, setPicked] = useState<string[]>([])

  const options = useMemo(
    () =>
      subjects.map((subject) => {
        const found = new Set(notes.filter((n) => n.question.subject === subject).map(unitOf))
        const order = SUBJECT_UNITS[subject as keyof typeof SUBJECT_UNITS] ?? []
        const rank = (u: string) => {
          if (u === NO_UNIT) return 9999
          const i = order.findIndex((o) => o.replace(/\s+/g, '') === u.replace(/\s+/g, ''))
          return i < 0 ? 5000 : i
        }
        const units = Array.from(found).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'))
        return { subject, units }
      }),
    [notes, subjects]
  )

  // 과목을 바꿔 보이지 않게 된 단원 선택은 걸러낸다(남아 있으면 다른 과목 문제가 모두 가려진다)
  const effective = useMemo(() => {
    const valid = new Set(options.flatMap((o) => o.units.map((u) => keyOf(o.subject, u))))
    return picked.filter((k) => valid.has(k))
  }, [picked, options])

  const match = useCallback(
    (note: WrongNote): boolean => {
      if (effective.length === 0) return true
      const subject = note.question.subject
      // 이 과목에서 단원을 하나도 안 켰으면 그 과목은 전부 통과
      if (!effective.some((k) => k.startsWith(`${subject}|`))) return true
      return effective.includes(keyOf(subject, unitOf(note)))
    },
    [effective]
  )

  return { options, picked: effective, setPicked, match }
}

export function UnitFilter({ filter }: { filter: ReturnType<typeof useUnitFilter> }) {
  const { options, picked, setPicked } = filter
  const rows = options.filter((o) => o.units.length > 0)
  if (rows.length === 0) return null
  return (
    <div className="space-y-2 pt-1 border-t border-border">
      <p className="text-[10px] text-muted-foreground">범위(단원) — 누른 단원만 보여요</p>
      {rows.map(({ subject, units }) => (
        <div key={subject} className="space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium">{subject}</p>
          <FilterChips
            options={units}
            selected={units.filter((u) => picked.includes(keyOf(subject, u)))}
            onChange={(next) =>
              setPicked([
                ...picked.filter((k) => !k.startsWith(`${subject}|`)),
                ...next.map((u) => keyOf(subject, u)),
              ])
            }
          />
        </div>
      ))}
    </div>
  )
}
