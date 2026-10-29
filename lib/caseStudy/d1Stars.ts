/**
 * 사례형 D-1 암기장 '전날 볼 것' 찜 — 화면·Firestore 에 의존하지 않는 저장소.
 * 실제 저장은 backend(firebaseServices/caseD1)에 맡긴다. 누르면 화면을 먼저 바꾸고, 저장에 실패하면 되돌린다
 */

export interface CaseStar {
  problemId: string
  cardId: string
  starredAt: number
}

export interface StarBackend {
  list(): Promise<CaseStar[]>
  put(star: CaseStar): Promise<void>
  remove(problemId: string): Promise<void>
}

export type StarStore = ReturnType<typeof createStarStore>

export function createStarStore(backend: StarBackend) {
  let stars = new Map<string, CaseStar>()
  let status: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  let pending: Promise<boolean> | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((f) => f())

  return {
    subscribe(f: () => void) {
      listeners.add(f)
      return () => void listeners.delete(f)
    },
    get status() {
      return status
    },
    has: (problemId: string) => stars.has(problemId),
    all: () => [...stars.values()],
    /** 처음 한 번만 읽는다(force 면 다시). 읽는 중에 또 부르면 그 결과를 같이 기다린다. 실패하면 false */
    load(force = false): Promise<boolean> {
      if (pending) return pending
      if (status === 'ready' && !force) return Promise.resolve(true)
      status = 'loading'
      emit()
      pending = backend
        .list()
        .then((list) => {
          stars = new Map(list.map((s) => [s.problemId, s]))
          status = 'ready'
          return true
        })
        .catch(() => {
          status = 'error'
          return false
        })
        .finally(() => {
          pending = null
          emit()
        })
      return pending
    },
    /** 찜 ↔ 해제. 저장했으면 true, 실패하면 화면을 되돌리고 false */
    async toggle(problemId: string, cardId: string, now = Date.now()): Promise<boolean> {
      const prev = stars.get(problemId)
      const next = new Map(stars)
      if (prev) next.delete(problemId)
      else next.set(problemId, { problemId, cardId, starredAt: now })
      stars = next
      emit()
      try {
        if (prev) await backend.remove(problemId)
        else await backend.put(next.get(problemId)!)
        return true
      } catch {
        const back = new Map(stars)
        if (prev) back.set(problemId, prev)
        else back.delete(problemId)
        stars = back
        emit()
        return false
      }
    },
  }
}
