'use client'

import { useEffect, useRef } from 'react'
import { bboxOf, describeStroke, isCross, recognizeStroke, unionBBox, type BBox, type P, type Recognized } from '@/lib/penGesture'
import type { HighlightStyle } from '@/lib/highlights'

/**
 * 펜슬로 본문 위에 직접 긋는 밑줄·동그라미·X 를 알아보고, 글자 위의 표시(형광펜 하이라이트)로 남긴다.
 *
 * 글자를 먼저 선택하지 않으므로 iPad 의 "복사/붙여넣기" 메뉴가 뜨지 않는다. 그린 선 자체는
 * 저장하지 않는다 — 모양을 알아본 뒤에는 글자 범위(field, start, end)로 바꿔 넘기고, 선은 잠깐 보였다 사라진다.
 *
 * 부모(상대 위치 박스) 안에 두는 투명 캔버스다. 입력은 부모에서 직접 받으므로 캔버스는 입력을 가로채지 않는다.
 * 손가락은 건드리지 않는다(스크롤·글자 선택·탭이 종전대로) — 펜슬과 마우스(눌러서 끌기)만 가져온다.
 * 마우스는 끌면 글자 선택이 되던 동작을 대신하므로, 쓰지 않을 때는 위의 스위치로 끈다.
 */

export interface PenGesture {
  field: string
  start: number
  end: number
  style: HighlightStyle
}

interface Props {
  enabled: boolean
  getFieldEls: () => Record<string, HTMLElement | null>
  onGesture: (g: PenGesture) => void
  /** 알아봤지만 표시로 남기지 못했거나, 아예 못 알아본 이유. 왜 안 됐는지 화면에서 보이게 한다 */
  onInfo?: (message: string) => void
}

// 펜슬이 닿아도 종전대로 두는 요소. 눌러서 쓰는 것들이라 획으로 읽으면 안 된다
const INTERACTIVE = 'button,a,input,select,textarea,summary,[role="button"],[contenteditable="true"]'

// 점마다 남기는 것은 화면 좌표뿐이다. 선이 사라질 때까지의 시간(ms)
const FADE_MS = 900
// 대각선 두 획을 X 한 개로 묶어 주는 간격(ms)
const CROSS_WINDOW_MS = 2500
// 이 안이면 획이 아니라 톡 두드린 것으로 본다
const TAP_MOVE_PX = 6
const TAP_MS = 400

const KIND_LABEL = { underline: '밑줄', circle: '원', cross: 'X' } as const

interface CharBox {
  idx: number
  ch: string
  l: number
  r: number
  t: number
  b: number
}

/** 한 칸(필드)의 글자 하나하나의 화면 위치. idx 는 getTextOffset 과 같은 기준(텍스트 노드 길이의 누적)이다 */
function charBoxes(el: HTMLElement, area: BBox): CharBox[] {
  const out: CharBox[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data
    const parent = node.parentElement
    const pr = parent?.getBoundingClientRect()
    const near = !!pr && pr.right >= area.x0 - 4 && pr.left <= area.x1 + 4 && pr.bottom >= area.y0 - 40 && pr.top <= area.y1 + 40
    if (near) {
      for (let j = 0; j < data.length; j++) {
        range.setStart(node, j)
        range.setEnd(node, j + 1)
        const rect = range.getClientRects()[0]
        if (!rect || rect.width <= 0 || rect.height <= 0) continue
        out.push({ idx: offset + j, ch: data[j], l: rect.left, r: rect.right, t: rect.top, b: rect.bottom })
      }
    }
    offset += data.length
  }
  return out
}

/** 앞뒤 공백을 떼고 [start,end) 를 돌려준다. 남는 글자가 없으면 null */
function trimmed(boxes: CharBox[]): { start: number; end: number; count: number } | null {
  const solid = boxes.filter((c) => c.ch.trim() !== '')
  if (solid.length === 0) return null
  return { start: solid[0].idx, end: solid[solid.length - 1].idx + 1, count: solid.length }
}

function underlineChars(boxes: CharBox[], bb: BBox, my: number): CharBox[] {
  // 줄로 묶는다
  const lines: CharBox[][] = []
  for (const c of boxes) {
    const line = lines[lines.length - 1]
    const lb = line ? line[line.length - 1].b : 0
    if (line && Math.abs(c.b - lb) <= 0.5 * (c.b - c.t)) line.push(c)
    else lines.push([c])
  }
  let best: CharBox[] | null = null
  let bestD = Infinity
  for (const line of lines) {
    const lt = Math.min(...line.map((c) => c.t))
    const lb = Math.max(...line.map((c) => c.b))
    const lh = lb - lt
    // 글자 아래쪽 근처를 지난 선만 밑줄로 본다(글자 한가운데를 가른 선은 취소선에 가까워 제외)
    if (my < lt + 0.4 * lh || my > lb + 0.9 * lh) continue
    const d = Math.abs(my - lb)
    if (d < bestD) {
      bestD = d
      best = line
    }
  }
  if (!best) return []
  return best.filter((c) => {
    const w = c.r - c.l
    const overlap = Math.min(c.r, bb.x1) - Math.max(c.l, bb.x0)
    return overlap >= 0.5 * w
  })
}

function insideEllipse(c: CharBox, bb: BBox): boolean {
  const cx = (bb.x0 + bb.x1) / 2
  const cy = (bb.y0 + bb.y1) / 2
  const a = ((bb.x1 - bb.x0) / 2) * 1.1
  const b = ((bb.y1 - bb.y0) / 2) * 1.1
  if (a <= 0 || b <= 0) return false
  const x = (c.l + c.r) / 2 - cx
  const y = (c.t + c.b) / 2 - cy
  return (x * x) / (a * a) + (y * y) / (b * b) <= 1
}

function insideBox(c: CharBox, bb: BBox): boolean {
  const x = (c.l + c.r) / 2
  const y = (c.t + c.b) / 2
  return x >= bb.x0 && x <= bb.x1 && y >= bb.y0 && y <= bb.y1
}

export default function PenAnnotateLayer({ enabled, getFieldEls, onGesture, onInfo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const getFieldElsRef = useRef(getFieldEls)
  const onGestureRef = useRef(onGesture)
  const onInfoRef = useRef(onInfo)
  getFieldElsRef.current = getFieldEls
  onInfoRef.current = onInfo
  onGestureRef.current = onGesture

  useEffect(() => {
    if (!enabled) return
    const cv = canvasRef.current
    const box = cv?.parentElement
    if (!cv || !box) return
    const canvas: HTMLCanvasElement = cv
    const host: HTMLElement = box

    // ── 캔버스 크기 ───────────────────────────────────
    let w = 0
    let h = 0
    function resize() {
      const dpr = window.devicePixelRatio || 1
      w = host.clientWidth
      h = host.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(host)

    // ── 선 그리기(잠깐 보였다 사라진다) ─────────────────
    interface Trace {
      pts: P[]
      endedAt: number | null
    }
    const traces: Trace[] = []
    let raf = 0
    function paint() {
      raf = 0
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      const rect = host.getBoundingClientRect()
      const now = performance.now()
      for (let i = traces.length - 1; i >= 0; i--) {
        const t = traces[i]
        const age = t.endedAt === null ? 0 : now - t.endedAt
        if (age >= FADE_MS) {
          traces.splice(i, 1)
          continue
        }
        ctx.globalAlpha = 1 - age / FADE_MS
        ctx.strokeStyle = '#6b7280'
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        t.pts.forEach((p, k) => {
          const x = p.x - rect.left
          const y = p.y - rect.top
          if (k === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (traces.length > 0) raf = requestAnimationFrame(paint)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint)
    }

    // ── 모양 → 글자 범위 ──────────────────────────────
    function locate(kind: 'underline' | 'circle' | 'cross', bb: BBox, my: number): PenGesture | null {
      let best: PenGesture | null = null
      let bestCount = 0
      for (const [field, el] of Object.entries(getFieldElsRef.current())) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.right < bb.x0 - 20 || r.left > bb.x1 + 20 || r.bottom < bb.y0 - 40 || r.top > bb.y1 + 40) continue
        const boxes = charBoxes(el, bb)
        let picked: CharBox[]
        if (kind === 'underline') picked = underlineChars(boxes, bb, my)
        else if (kind === 'circle') picked = boxes.filter((c) => insideEllipse(c, bb))
        else picked = boxes.filter((c) => insideBox(c, bb))
        const span = trimmed(picked)
        if (!span || span.count <= bestCount) continue
        bestCount = span.count
        best = { field, start: span.start, end: span.end, style: kind }
      }
      return best
    }

    // ── 획 알아보기 ───────────────────────────────────
    let pending: { rec: Recognized; at: number } | null = null
    function commit(kind: 'underline' | 'circle' | 'cross', bb: BBox, my: number) {
      const g = locate(kind, bb, my)
      if (g) onGestureRef.current(g)
      else onInfoRef.current?.(`${KIND_LABEL[kind]}(으)로 읽었지만 겹치는 글자를 못 찾았어요`)
    }
    function handle(pts: P[], t0: number) {
      const rec = recognizeStroke(pts)
      if (!rec) {
        const b = bboxOf(pts)
        // 아주 짧은 낙서까지 알리면 시끄럽다
        if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) >= 40) onInfoRef.current?.(`모양을 못 알아봤어요 (${describeStroke(pts)})`)
        return
      }
      const now = performance.now()
      if (rec.kind === 'underline') {
        pending = null
        const my = rec.pts.reduce((s, p) => s + p.y, 0) / rec.pts.length
        commit('underline', rec.bbox, my)
      } else if (rec.kind === 'circle') {
        pending = null
        commit('circle', rec.bbox, 0)
      } else {
        // 둘째 획을 '시작한' 때가 첫 획이 끝난 지 얼마 안 됐는지 본다(끝난 때로 재면 천천히 긋는 사람이 놓친다)
        if (pending && t0 - pending.at <= CROSS_WINDOW_MS && isCross(pending.rec, rec)) {
          const bb = unionBBox(pending.rec.bbox, rec.bbox)
          pending = null
          commit('cross', bb, 0)
        } else {
          pending = { rec, at: now }
          onInfoRef.current?.('X 의 한 획을 읽었어요 — 반대 방향 획을 이어서 그어 주세요')
        }
      }
    }

    // ── 입력 ──────────────────────────────────────────
    let cur: { id: number; pts: P[]; t0: number; target: Element; trace: Trace; mouse: boolean } | null = null

    const interactive = (t: Element | null) => !!t?.closest(INTERACTIVE)

    function onDown(e: PointerEvent) {
      // 펜슬과 마우스(왼쪽 버튼)를 받는다. 손가락은 스크롤·글자 선택에 쓰이므로 건드리지 않는다
      const mouse = e.pointerType === 'mouse'
      if ((e.pointerType !== 'pen' && !mouse) || !e.isPrimary) return
      if (mouse && e.button !== 0) return
      const target = e.target as Element | null
      if (!target || !host.contains(target) || interactive(target)) return
      // 이미 잡혀 있던 글자 선택이 남아 있으면 그림을 그은 뒤에 형광펜 팝업이 뜬다
      if (mouse) window.getSelection()?.removeAllRanges()
      const trace: Trace = { pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], endedAt: null }
      cur = { id: e.pointerId, pts: trace.pts, t0: performance.now(), target, trace, mouse }
      traces.push(trace)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      schedule()
    }
    function onMove(e: PointerEvent) {
      if (!cur || e.pointerId !== cur.id) return
      const list = e.getCoalescedEvents?.() ?? []
      for (const ev of list.length ? list : [e]) cur.pts.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp })
      schedule()
    }
    function stop() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    function onUp(e: PointerEvent) {
      if (!cur || e.pointerId !== cur.id) return
      const c = cur
      cur = null
      stop()
      c.trace.endedAt = performance.now()
      schedule()
      const bb = bboxOf(c.pts)
      const moved = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0)
      if (moved < TAP_MOVE_PX && performance.now() - c.t0 < TAP_MS) {
        // 마우스는 브라우저가 click 을 그대로 만들어 준다
        if (c.mouse) {
          c.trace.endedAt = performance.now() - FADE_MS
          return
        }
        // 톡 두드림. touchstart 를 막았으므로 브라우저가 click 을 만들어 주지 않는다 — 우리가 대신 낸다
        // (선지 누르기, 형광펜 지우기 등이 펜슬로도 되게)
        c.trace.endedAt = performance.now() - FADE_MS
        ;(c.target as HTMLElement).click?.()
        return
      }
      // 점을 시간 순으로 바로잡는다. 묶여 오는 이벤트(coalesced)가 거꾸로 오거나 겹쳐 오면
      // 경로가 앞뒤로 오가며 길이가 몇 배로 잡힌다. 같은 자리 점도 덜어 낸다
      const ordered = [...c.pts].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
      const clean = ordered.filter((p, i) => i === 0 || p.x !== ordered[i - 1].x || p.y !== ordered[i - 1].y)
      handle(clean, c.t0)
    }
    function onCancel(e: PointerEvent) {
      if (!cur || e.pointerId !== cur.id) return
      cur.trace.endedAt = performance.now()
      cur = null
      stop()
      schedule()
    }

    // 펜슬의 손짓이 스크롤·글자 선택·길게 눌러 뜨는 메뉴로 번지지 않게 한다.
    // iOS 의 Touch.touchType 은 'stylus' 인 접촉만 골라 낸다(손가락은 그대로 둔다)
    function onTouchStart(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        if ((t as Touch & { touchType?: string }).touchType !== 'stylus') continue
        if (interactive(t.target as Element | null)) return
        e.preventDefault()
        return
      }
    }

    // 마우스로 긋는 동안은 글자가 선택되지 않게 한다. 눌린 채 끌면 브라우저가 글자 선택을 시작하기 때문이다.
    // mousedown 의 기본 동작만 막으므로 click 은 그대로 나온다(선지 누르기, 형광펜 지우기)
    function onMouseDown(e: MouseEvent) {
      if (cur?.mouse && e.button === 0) e.preventDefault()
    }
    host.addEventListener('mousedown', onMouseDown, true)
    host.addEventListener('pointerdown', onDown, true)
    host.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
    return () => {
      host.removeEventListener('mousedown', onMouseDown, true)
      host.removeEventListener('pointerdown', onDown, true)
      host.removeEventListener('touchstart', onTouchStart, true)
      stop()
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [enabled])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full rounded-xl" />
}
