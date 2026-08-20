import type { WrongNote } from '@/lib/types'
import { getRiskLevel } from '@/lib/store'

// 오답노트와 D-1 암기장이 같은 정렬 기준을 쓰도록 한 곳에 모아둔다
export const SORT_OPTIONS = ['날짜순', '출제연도순', '위험도순', '범위순'] as const
export type SortOption = (typeof SORT_OPTIONS)[number]

// 각 기준의 자연스러운 방향으로만 정렬한다 (날짜·연도·위험도는 큰 값 먼저, 범위는 가나다순).
// 동점일 때는 최근 저장 순으로 2차 정렬해 순서가 렌더마다 흔들리지 않게 한다
export function sortNotes(notes: WrongNote[], sort: SortOption): WrongNote[] {
  const byRecent = (a: WrongNote, b: WrongNote) => b.createdAt - a.createdAt
  const list = [...notes]
  switch (sort) {
    case '출제연도순':
      list.sort((a, b) => (b.question.year ?? 0) - (a.question.year ?? 0) || byRecent(a, b))
      break
    case '위험도순':
      list.sort((a, b) => getRiskLevel(b) - getRiskLevel(a) || byRecent(a, b))
      break
    case '범위순': {
      // 단원이 없는 문제는 가나다순에 끼워넣을 자리가 없으므로 맨 뒤로 보낸다
      const unitOf = (n: WrongNote) => n.question.unit?.trim() ?? ''
      list.sort((a, b) => {
        const ua = unitOf(a)
        const ub = unitOf(b)
        if (!ua !== !ub) return ua ? -1 : 1
        return ua.localeCompare(ub, 'ko') || byRecent(a, b)
      })
      break
    }
    default:
      list.sort(byRecent)
  }
  return list
}
