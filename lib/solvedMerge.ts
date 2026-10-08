/**
 * 푼 문제 기록(문제 id → 채점된 횟수)의 기기 간 합치기.
 *
 * 횟수는 늘기만 하므로 문제마다 큰 쪽을 남긴다. 두 기기에서 따로 풀었다면 합계보다 작게 잡히지만,
 * '풀어봤는가'를 세는 용도에서는 0 이 아닌 것만 맞으면 되고, 덧셈으로 합치면 같은 기록을 두 번
 * 받을 때마다 부풀어 오른다 — 그쪽이 더 위험하다.
 */
export interface SolvedRecord {
  id: string
  count: number
}

export type SolvedMap = Record<string, number>

export function solvedToRecords(map: SolvedMap): SolvedRecord[] {
  return Object.entries(map)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count }))
}

/** fromRemote: 원격이 더 커서 로컬에 반영할 것, toRemote: 원격에 올릴 것이 있는지 */
export function mergeSolved(
  local: SolvedMap,
  remote: SolvedRecord[] | null
): { merged: SolvedRecord[]; fromRemote: SolvedRecord[]; toRemote: boolean } {
  const byId = new Map<string, number>(Object.entries(local).filter(([, c]) => c > 0))
  const fromRemote: SolvedRecord[] = []
  const remoteCount = new Map<string, number>()
  for (const r of remote ?? []) {
    if (!r || typeof r.id !== 'string' || !(r.count > 0)) continue
    remoteCount.set(r.id, r.count)
    const mine = byId.get(r.id) ?? 0
    if (r.count > mine) {
      byId.set(r.id, r.count)
      fromRemote.push(r)
    }
  }
  let toRemote = remote === null
  for (const [id, count] of byId) {
    if (count > (remoteCount.get(id) ?? 0)) toRemote = true
  }
  const merged = [...byId].map(([id, count]) => ({ id, count }))
  return { merged, fromRemote, toRemote }
}

/** 문제 하나를 몇 번 풀었는가. 오답노트의 횟수(옛 기록)와 이 기록 중 큰 쪽 */
export function solvedCountOf(id: string, solved: SolvedMap, noteTotal: number | undefined): number {
  return Math.max(solved[id] ?? 0, noteTotal ?? 0)
}
