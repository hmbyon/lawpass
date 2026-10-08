import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 그림(획 배열)의 되돌리기 기록. 그림판과 임시 그리기가 함께 쓴다.
 *
 * 획 배열이 실제로 바뀔 때마다 바뀌기 전의 배열을 쌓아 둔다(최대 MAX 개). 그래서 획 하나를 그은 것, 지우개로 지운 것,
 * 전체 지우기를 누른 것이 모두 한 걸음씩 되돌려진다. 내용이 그대로인 채 새 배열만 만들어진 경우(다시 그리기)는 건너뛴다.
 * 획 지우개로 한 번 쓸고 지나가면 획이 여러 번에 나눠 빠지는데, 0.7초 안에 이어진 '빠짐'은 한 걸음으로 묶는다.
 *
 * resetKey 가 바뀌면(다른 문제로 넘어감) 기록을 비운다 — 다른 문제의 그림으로 되돌려지면 안 된다.
 */
const MAX = 50
const MERGE_REMOVE_MS = 700

export function useStrokeHistory<T>(strokes: T[], setStrokes: (next: T[]) => void, resetKey: string) {
  const history = useRef<T[][]>([])
  const last = useRef<T[]>(strokes)
  const keyRef = useRef(resetKey)
  const skipNext = useRef(false)
  const lastKind = useRef<'add' | 'remove' | 'other'>('other')
  const lastAt = useRef(0)
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey
      history.current = []
      last.current = strokes
      lastKind.current = 'other'
      setCount(0)
      return
    }
    const prev = last.current
    last.current = strokes
    // 되돌리기 자신이 바꾼 것은 기록하지 않는다
    if (skipNext.current) {
      skipNext.current = false
      return
    }
    if (prev === strokes) return
    if (prev.length === strokes.length && prev.every((s, i) => s === strokes[i])) return

    const kind = strokes.length < prev.length ? 'remove' : 'add'
    const now = Date.now()
    const merge = kind === 'remove' && lastKind.current === 'remove' && now - lastAt.current < MERGE_REMOVE_MS
    if (!merge) {
      history.current.push(prev)
      if (history.current.length > MAX) history.current.shift()
    }
    lastKind.current = kind
    lastAt.current = now
    setCount(history.current.length)
  }, [strokes, resetKey])

  const undo = useCallback(() => {
    const snapshot = history.current.pop()
    if (!snapshot) return
    skipNext.current = true
    last.current = snapshot
    lastKind.current = 'other'
    setStrokes(snapshot)
    setCount(history.current.length)
  }, [setStrokes])

  return { canUndo: count > 0, undo }
}
