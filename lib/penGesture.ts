/**
 * 펜슬로 그은 획의 모양을 알아본다 (밑줄 · 동그라미 · X의 한 획).
 *
 * 좌표는 화면 픽셀이다. 손으로 그은 선이라 반듯하지 않으므로 기준을 느슨하게 둔다.
 * 다만 애매하면 null 을 돌려 아무 일도 하지 않는다 — 엉뚱하게 읽는 것이 못 읽는 것보다 나쁘다
 * (읽은 결과는 되돌릴 수 있지만, 그을 때마다 틀리면 쓰지 않게 된다).
 */

export interface P {
  x: number
  y: number
}

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type StrokeKind = 'underline' | 'circle' | 'diag-up' | 'diag-down'

export interface Recognized {
  kind: StrokeKind
  bbox: BBox
  pts: P[]
}

export function bboxOf(pts: P[]): BBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

export function pathLength(pts: P[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** 가까운 점을 솎아 낸다(처음과 끝은 남긴다). 촘촘한 점의 손떨림이 길이·각도를 부풀리지 않게 한다 */
export function decimate(pts: P[], minGap: number): P[] {
  if (pts.length <= 2) return pts
  const out: P[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minGap) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** 방향이 바뀐 각도의 합(라디안, 부호 있음). 한 바퀴 돌면 ±2π 쯤 된다 */
export function totalTurning(pts: P[]): number {
  // 촘촘한 점은 손떨림만큼의 방향 흔들림을 그대로 담아 각도 합을 부풀리거나 서로 상쇄시킨다.
  // 듬성듬성 이어 본 방향이 모양을 더 잘 말해 준다
  const kept = decimate(pts, 5)
  let sum = 0
  for (let i = 2; i < kept.length; i++) {
    const a1 = Math.atan2(kept[i - 1].y - kept[i - 2].y, kept[i - 1].x - kept[i - 2].x)
    const a2 = Math.atan2(kept[i].y - kept[i - 1].y, kept[i].x - kept[i - 1].x)
    let d = a2 - a1
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    sum += d
  }
  return sum
}

/**
 * 한 획이 무엇인지. 알 수 없으면 null.
 *  - underline: 거의 곧은 가로선
 *  - circle: 처음과 끝이 만나는, 한 바퀴쯤 도는 고리
 *  - diag-up / diag-down: X 의 한 획이 될 수 있는 곧은 대각선 (두 획이 모여야 의미가 있다)
 */
export function recognizeStroke(pts: P[]): Recognized | null {
  if (pts.length < 3) return null
  const bbox = bboxOf(pts)
  const w = bbox.x1 - bbox.x0
  const h = bbox.y1 - bbox.y0
  // 길이는 솎은 점으로 잰다. 손떨림이 촘촘한 점마다 쌓여 길이를 부풀리면 곧은 선이 구불거리는 선이 된다
  const smooth = decimate(pts, 5)
  const len = pathLength(smooth)
  // 톡 찍거나 짧게 긋는 것은 표시가 아니다
  if (len < 24) return null
  const first = pts[0]
  const last = pts[pts.length - 1]
  const chord = Math.hypot(last.x - first.x, last.y - first.y)
  const straight = chord / len

  // 밑줄: 곧고, 가로로 길고, 기울기가 작다. 손떨림을 감안해 높이는 폭의 22%(또는 10px)까지 본다
  if (straight >= 0.8 && w >= 24 && h <= Math.max(10, 0.22 * w)) {
    return { kind: 'underline', bbox, pts }
  }

  // 동그라미: 시작과 끝이 가깝고(둘레의 22% 이내), 방향이 한 바퀴 가까이 돈다
  const turning = Math.abs(totalTurning(pts))
  if (chord / len <= 0.22 && turning >= 4.6 && w >= 16 && h >= 14 && w / h <= 7 && h / w <= 4) {
    return { kind: 'circle', bbox, pts }
  }

  // 대각선: 곧고 가로도 세로도 아닌 기울기(약 10°~80°).
  // 글자 줄은 가로로 긴 단어 위에 X 를 치므로 획이 꽤 납작하다(폭 60 에 높이 20 이면 17°).
  // 25° 부터로 잡았을 때는 그런 X 가 통째로 버려졌다. 납작한 대각선 한 획은 짝이 없으면 아무 일도
  // 하지 않으므로(isCross 가 맞은편 획과 만나는지 본다) 문턱을 낮춰도 잘못 칠할 일이 적다
  if (straight >= 0.8 && len >= 20) {
    const dx = last.x - first.x
    const dy = last.y - first.y
    const deg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
    if (deg >= 10 && deg <= 80) {
      // 화면 좌표는 y 가 아래로 늘어난다. 왼쪽 아래에서 오른쪽 위로 가면 up
      const up = dx * dy < 0
      return { kind: up ? 'diag-up' : 'diag-down', bbox, pts }
    }
  }
  return null
}

function segIntersect(a: P, b: P, c: P, d: P): boolean {
  const cross = (o: P, p: P, q: P) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** 양 끝을 비율만큼 늘인 선분. 손으로 그은 X 는 두 획이 딱 만나지 않고 살짝 못 미치기 쉽다 */
function extended(first: P, last: P, ratio: number): [P, P] {
  const dx = last.x - first.x
  const dy = last.y - first.y
  return [
    { x: first.x - dx * ratio, y: first.y - dy * ratio },
    { x: last.x + dx * ratio, y: last.y + dy * ratio },
  ]
}

/** 대각선 두 획이 X 를 이루는지. 기울기가 반대이고, 서로 가로지르거나 거의 만난다 */
export function isCross(a: Recognized, b: Recognized): boolean {
  const dirs = new Set([a.kind, b.kind])
  if (!(dirs.has('diag-up') && dirs.has('diag-down'))) return false
  const [a0, a1] = extended(a.pts[0], a.pts[a.pts.length - 1], 0.2)
  const [b0, b1] = extended(b.pts[0], b.pts[b.pts.length - 1], 0.2)
  if (!segIntersect(a0, a1, b0, b1)) return false
  // 크기가 너무 다르면(한쪽이 훨씬 길면) 같은 X 의 두 획이 아니다
  const la = pathLength(a.pts)
  const lb = pathLength(b.pts)
  return Math.max(la, lb) / Math.min(la, lb) <= 3
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}
