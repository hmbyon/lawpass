import type { Question, QuestionDrawing } from './types'

/**
 * 문제 목록 두 벌 사이에서 그림(drawing)만 더 나중에 저장한 쪽으로 맞춘다.
 *
 * 문제 목록은 통째로 올리고 통째로 받는다. 그래서 기기 두 대(아이패드·맥)에서 열어 두면, 오래 열려 있던
 * 쪽이 올리는 순간 다른 기기에서 그린 그림이 옛 목록으로 덮여 사라졌다. 그림만은 문제마다 저장한
 * 시각(savedAt)을 비교해 최신인 쪽을 남긴다. 문제 본문 같은 다른 필드는 건드리지 않는다.
 *
 * 그림을 전부 지운 것도 "지웠다"는 기록(strokes 가 빈 drawing)으로 남기므로, 다른 기기의 옛 그림이
 * 되살아나지 않는다. savedAt 이 없는 옛 그림은 0 으로 본다 — 같은 값이면 base 가 이긴다.
 */
function stamp(d: QuestionDrawing | undefined): number {
  return d?.savedAt ?? 0
}

/** base 의 각 문제에 대해, other 에 같은 id 의 더 새로운 그림이 있으면 그걸로 바꾼 새 배열. 바뀐 게 없으면 base 그대로 */
export function mergeDrawings(base: Question[], other: Question[] | null): Question[] {
  if (!other || other.length === 0) return base
  const theirs = new Map<string, QuestionDrawing>()
  for (const q of other) if (q.drawing) theirs.set(q.id, q.drawing)
  if (theirs.size === 0) return base

  let changed = false
  const out = base.map((q) => {
    const t = theirs.get(q.id)
    if (!t) return q
    // 시각이 없는 옛 그림끼리는 비교할 수 없다 — 내게 그림이 없고 저쪽에 있을 때만 받는다
    if (q.drawing ? stamp(t) <= stamp(q.drawing) : false) return q
    changed = true
    return { ...q, drawing: t }
  })
  return changed ? out : base
}
