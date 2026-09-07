/**
 * 획 하나를 통째로 지우기 위한 맞힘 판정.
 *
 * 임시 그리기(DrawLayer)와 그림판(drawing-pad)은 좌표를 담는 모양이 다르다 — 한쪽은
 * 화면 픽셀의 {x, y} 배열이고, 다른 쪽은 폭 대비 비율을 편 [x0, y0, x1, y1, …] 이다.
 * 그래서 배열을 받지 않고 '몇 번째 점이 어디인지'만 물어, 양쪽이 같은 판정을 쓴다.
 *
 * 점까지의 거리가 아니라 **선분까지의 거리**를 잰다. 점만 보면 빠르게 그은 직선처럼
 * 점이 드문 획에서 한가운데를 눌러도 안 지워진다 — 정작 제일 지우고 싶은 자리다
 */

export function distanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  // 길이가 없는 선분(톡 찍은 자국)은 그 점까지의 거리다
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/** 그 자리가 이 획 위인가. count 는 점의 개수, at(i) 는 i 번째 점 */
export function hitsStroke(
  count: number,
  at: (i: number) => readonly [number, number],
  x: number,
  y: number,
  threshold: number
): boolean {
  if (count <= 0) return false
  if (count === 1) {
    const [ax, ay] = at(0)
    return Math.hypot(x - ax, y - ay) <= threshold
  }
  for (let i = 1; i < count; i++) {
    const [ax, ay] = at(i - 1)
    const [bx, by] = at(i)
    if (distanceToSegment(x, y, ax, ay, bx, by) <= threshold) return true
  }
  return false
}
