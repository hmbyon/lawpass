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
  /** 이벤트 시각(ms). 점 순서를 시간 순으로 바로잡는 데 쓴다 */
  t?: number
}

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type StrokeKind = 'underline' | 'circle' | 'diag-up' | 'diag-down' | 'bracket'

/** 글자 사이에 끼우는 괄호 네 가지 */
export type BracketChar = '[' | ']' | '<' | '>'

export interface Recognized {
  kind: StrokeKind
  bbox: BBox
  pts: P[]
  /** 대각선의 양 끝(주축에 점을 내린 가장 먼 두 곳). 점 순서와 무관하다 */
  seg?: [P, P]
  /** kind 가 bracket 일 때 어떤 괄호인지 */
  bracket?: BracketChar
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

interface Axis {
  cx: number
  cy: number
  ux: number
  uy: number
  /** 주축·부축 방향의 표준편차 */
  major: number
  minor: number
  t0: number
  t1: number
}

/**
 * 점들이 퍼진 주된 방향(주성분 분석).
 *
 * 점 순서나 중복에 영향을 받지 않는다. 실제 아이패드에서 같은 획의 길이가 두세 배로 잡힌 적이 있다
 * (폭 185 인 밑줄의 경로 길이가 428) — 점이 앞뒤로 오가면 "길이 대비 처음~끝 거리"로 재는 곧음이 무너진다.
 * 모양을 점의 순서가 아니라 점이 놓인 자리로 보면 그런 획도 곧은 선으로 읽힌다
 */
export function principalAxis(pts: P[]): Axis {
  const n = pts.length
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p.x
    cy += p.y
  }
  cx /= n
  cy /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of pts) {
    const dx = p.x - cx
    const dy = p.y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  sxx /= n
  syy /= n
  sxy /= n
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc
  const l2 = Math.max(0, tr / 2 - disc)
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  let t0 = Infinity
  let t1 = -Infinity
  for (const p of pts) {
    const t = (p.x - cx) * ux + (p.y - cy) * uy
    if (t < t0) t0 = t
    if (t > t1) t1 = t
  }
  return { cx, cy, ux, uy, major: Math.sqrt(l1), minor: Math.sqrt(l2), t0, t1 }
}

// 부축/주축 표준편차 비. 이 이하면 점들이 한 직선 둘레에 모여 있다고 본다
const LINEAR_RATIO = 0.22

/**
 * 한 획이 무엇인지. 알 수 없으면 null.
 *  - underline: 거의 곧은 가로선
 *  - circle: 처음과 끝이 만나는, 한 바퀴쯤 도는 고리
 *  - diag-up / diag-down: X 의 한 획이 될 수 있는 곧은 대각선 (두 획이 모여야 의미가 있다)
 *
 * 직선 판정은 점이 놓인 자리(주성분)로 한다. 점의 순서·되짚음에 영향을 받지 않는다
 */
export function recognizeStroke(pts: P[]): Recognized | null {
  if (pts.length < 3) return null
  const bbox = bboxOf(pts)
  const w = bbox.x1 - bbox.x0
  const h = bbox.y1 - bbox.y0
  const ax = principalAxis(pts)
  const extent = ax.t1 - ax.t0
  // 한 획으로 꺾어 그은 괄호 [ ] < >. 글자 사이에 끼우는 것이라 작게 긋고, 세로로 길어 '선'으로도 보이므로
  // 아래 판정보다 먼저 본다. 시작과 끝이 만나는 닫힌 획(동그라미)은 괄호가 아니다
  {
    const first = pts[0]
    const last = pts[pts.length - 1]
    const len = pathLength(decimate(pts, 3))
    const open = len > 0 && Math.hypot(last.x - first.x, last.y - first.y) / len >= 0.35
    const bracket = open ? recognizeBracket(pts, bbox) : null
    if (bracket) return { kind: 'bracket', bracket, bbox, pts }
  }
  // 톡 찍거나 짧게 긋는 것은 표시가 아니다
  if (extent < 20 && Math.max(w, h) < 24) return null
  const linear = ax.major > 0 && ax.minor / ax.major <= LINEAR_RATIO

  // 동그라미: 선이 아니고, 시작과 끝이 가깝고(둘레의 22% 이내), 방향이 한 바퀴 가까이 돈다
  if (!linear) {
    const smooth = decimate(pts, 5)
    const len = pathLength(smooth)
    const first = pts[0]
    const last = pts[pts.length - 1]
    const chord = Math.hypot(last.x - first.x, last.y - first.y)
    const turning = Math.abs(totalTurning(pts))
    if (len > 0 && chord / len <= 0.22 && turning >= 4.6 && w >= 16 && h >= 14 && w / h <= 7 && h / w <= 4) {
      return { kind: 'circle', bbox, pts }
    }
    return null
  }

  // 밑줄: 가로로 길고 기울기가 작다. 손떨림을 감안해 높이는 폭의 22%(또는 10px)까지 본다
  if (w >= 24 && h <= Math.max(10, 0.22 * w)) {
    return { kind: 'underline', bbox, pts }
  }

  // 대각선: 가로도 세로도 아닌 기울기(약 10°~80°).
  // 글자 줄은 가로로 긴 단어 위에 X 를 치므로 획이 꽤 납작하다(폭 60 에 높이 20 이면 17°).
  // 납작한 대각선 한 획은 짝이 없으면 아무 일도 하지 않으므로(isCross 가 맞은편 획과 만나는지 본다)
  // 문턱을 낮춰도 잘못 칠할 일이 적다
  if (extent >= 20) {
    const deg = (Math.atan2(Math.abs(ax.uy), Math.abs(ax.ux)) * 180) / Math.PI
    if (deg >= 10 && deg <= 80) {
      // 화면 좌표는 y 가 아래로 늘어난다. 왼쪽 아래에서 오른쪽 위로 가는 선은 ux*uy < 0
      const up = ax.ux * ax.uy < 0
      const seg: [P, P] = [
        { x: ax.cx + ax.ux * ax.t0, y: ax.cy + ax.uy * ax.t0 },
        { x: ax.cx + ax.ux * ax.t1, y: ax.cy + ax.uy * ax.t1 },
      ]
      return { kind: up ? 'diag-up' : 'diag-down', bbox, pts, seg }
    }
  }
  return null
}

/** 점들을 허용 오차 안에서 꺾이는 점만 남겨 줄인다(Douglas-Peucker) */
export function simplify(pts: P[], eps: number): P[] {
  if (pts.length <= 2) return pts
  const distToSeg = (p: P, a: P, b: P) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
  const keep = new Array<boolean>(pts.length).fill(false)
  keep[0] = true
  keep[pts.length - 1] = true
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let far = -1
    let farD = eps
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSeg(pts[i], pts[lo], pts[hi])
      if (d > farD) {
        farD = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = true
      stack.push([lo, far], [far, hi])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** 꼭짓점 b 에서 a·c 쪽 두 변이 이루는 안쪽 각(도). 반듯이 펴진 선이 180 */
function interiorAngle(a: P, b: P, c: P): number {
  const ax = a.x - b.x
  const ay = a.y - b.y
  const cx = c.x - b.x
  const cy = c.y - b.y
  const la = Math.hypot(ax, ay)
  const lc = Math.hypot(cx, cy)
  if (la === 0 || lc === 0) return 180
  const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (la * lc)))
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * 한 획으로 그은 괄호. 꺾이는 점만 남겨 보면
 *  - < > : 변 둘, 꼭짓점 하나. 열린 쪽이 옆(가로)이다
 *  - [ ] : 변 셋, 꼭짓점 둘. 가운데 변이 세로로 길고 양끝 변이 같은 쪽으로 짧게 나온다
 * 애매하면 null — 괄호가 아닌 것을 괄호로 읽는 것이 못 읽는 것보다 나쁘다
 */
export function recognizeBracket(pts: P[], bbox: BBox): BracketChar | null {
  const size = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0)
  if (size < 14) return null
  // [ ] 는 곧은 가운데 변과 가로 변의 관계로, < > 는 꺾이는 한 점으로 본다. [ ] 를 먼저 본다 —
  // < > 의 모양은 가운데가 곧지 않아 여기서 걸러지지만, 반대로 [ ] 가 < > 로 읽힐 수 있다
  const square = squareBracket(pts, bbox)
  if (square) return square
  const base = decimate(pts, 3)
  for (const f of [0.08, 0.13, 0.2]) {
    const s = simplify(base, f * size)
    // 허용 오차가 달라지면 꺾이는 점 수가 달라진다. 한 번 거절했다고 멈추지 않고 다음 오차로도 본다
    if (s.length < 3) return null
    if (s.length === 3) {
      const found = angleBracket(s, size)
      if (found) return found
    }
  }
  return null
}

function angleBracket(s: P[], size: number): BracketChar | null {
  const [a, b, c] = s
  const la = Math.hypot(a.x - b.x, a.y - b.y)
  const lc = Math.hypot(c.x - b.x, c.y - b.y)
  if (Math.min(la, lc) < 0.3 * size || Math.max(la, lc) / Math.min(la, lc) > 2.2) return null
  const ang = interiorAngle(a, b, c)
  if (ang < 30 || ang > 120) return null
  // 열린 쪽: 꼭짓점에서 두 끝의 가운데로 향하는 방향이 옆쪽이어야 한다(위아래로 열린 V·^ 는 괄호가 아니다)
  const vx = (a.x + c.x) / 2 - b.x
  const vy = (a.y + c.y) / 2 - b.y
  if (Math.abs(vx) < Math.abs(vy)) return null
  return vx > 0 ? '<' : '>'
}

/** 호의 길이를 같은 간격으로 나눈 점 n 개(처음·끝 포함). 점의 간격이 들쭉날쭉해도 모양만 본다 */
function resample(pts: P[], n: number): P[] {
  const total = pathLength(pts)
  if (total === 0 || pts.length < 2) return pts
  const out: P[] = [pts[0]]
  const step = total / (n - 1)
  let acc = 0
  let target = step
  for (let i = 1; i < pts.length && out.length < n - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    while (seg > 0 && acc + seg >= target && out.length < n - 1) {
      const u = (target - acc) / seg
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
      target += step
    }
    acc += seg
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * [ ] — 꺾이는 점을 찾는 대신 세로 띠로 본다. 손이 떨려도 척추(가운데 곧은 변)와 양끝 가로 변의 관계는 남는다.
 *  - 위·아래 끝 띠에서 가장 먼 점이 척추의 같은 쪽에 있고(그쪽이 열린 쪽의 반대), 시작·끝 변이 가로에 가깝다
 *  - 가운데 띠의 x 는 거의 일정하다(< > 처럼 비스듬히 번지지 않고, ( ) 처럼 휘지도 않는다)
 */
function squareBracket(pts: P[], bbox: BBox): BracketChar | null {
  const w = bbox.x1 - bbox.x0
  const h = bbox.y1 - bbox.y0
  if (h < 14 || h < 1.1 * w) return null
  const r = resample(pts, 48)
  if (r.length < 12) return null
  // 처음에서 끝까지 위→아래(또는 아래→위)로 한 방향이어야 한다
  const dirY = Math.sign(r[r.length - 1].y - r[0].y)
  if (dirY === 0 || Math.abs(r[r.length - 1].y - r[0].y) < 0.6 * h) return null
  let forward = 0
  for (let i = 1; i < r.length; i++) if ((r[i].y - r[i - 1].y) * dirY >= -0.04 * h) forward++
  if (forward < 0.85 * (r.length - 1)) return null

  const band = (lo: number, hi: number) => r.filter((p) => p.y >= bbox.y0 + lo * h && p.y <= bbox.y0 + hi * h)
  const mid = band(0.25, 0.75)
  if (mid.length < 4) return null
  const xs = mid.map((p) => p.x).sort((a, b) => a - b)
  const spineX = xs[Math.floor(xs.length / 2)]
  // 가운데 띠가 곧다
  if (xs[xs.length - 1] - xs[0] > 0.08 * h + 3.2) return null

  const farthest = (list: P[]) => list.reduce((best, p) => (Math.abs(p.x - spineX) > Math.abs(best.x - spineX) ? p : best), list[0])
  const topBand = band(0, 0.14)
  const botBand = band(0.86, 1)
  if (topBand.length === 0 || botBand.length === 0) return null
  const top = farthest(topBand)
  const bot = farthest(botBand)
  const need = Math.max(5, 0.1 * h)
  const dTop = top.x - spineX
  const dBot = bot.x - spineX
  if (Math.abs(dTop) < need || Math.abs(dBot) < need) return null
  // 두 변이 척추의 같은 쪽으로 나온다
  if (Math.sign(dTop) !== Math.sign(dBot)) return null
  // 양끝 변은 가로에 가깝다: 끝점에서 같은 호 길이만큼 들어온 점으로 방향을 본다
  const k = Math.max(2, Math.round(r.length * 0.12))
  const dir = (a: P, b: P) => ({ dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y) })
  const s0 = dir(r[0], r[k])
  const s1 = dir(r[r.length - 1], r[r.length - 1 - k])
  if (s0.dx < 0.9 * s0.dy || s1.dx < 0.9 * s1.dy) return null
  return dTop > 0 ? '[' : ']'
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
  if (!a.seg || !b.seg) return false
  const [a0, a1] = extended(a.seg[0], a.seg[1], 0.2)
  const [b0, b1] = extended(b.seg[0], b.seg[1], 0.2)
  if (!segIntersect(a0, a1, b0, b1)) return false
  // 크기가 너무 다르면(한쪽이 훨씬 길면) 같은 X 의 두 획이 아니다
  const la = Math.hypot(a.seg[1].x - a.seg[0].x, a.seg[1].y - a.seg[0].y)
  const lb = Math.hypot(b.seg[1].x - b.seg[0].x, b.seg[1].y - b.seg[0].y)
  return Math.max(la, lb) / Math.min(la, lb) <= 3
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

/** 알아보지 못한 획이 어떻게 읽혔는지. 화면 안내에 붙여 왜 안 됐는지 보이게 한다 */
export function describeStroke(pts: P[]): string {
  const b = bboxOf(pts)
  const len = pathLength(decimate(pts, 5))
  const ax = principalAxis(pts)
  const lin = ax.major > 0 ? Math.round((ax.minor / ax.major) * 100) : 0
  return `점 ${pts.length} · 길이 ${Math.round(len)} · 선형 ${lin}% · ${Math.round(b.x1 - b.x0)}×${Math.round(b.y1 - b.y0)} · 회전 ${totalTurning(pts).toFixed(1)}`
}
