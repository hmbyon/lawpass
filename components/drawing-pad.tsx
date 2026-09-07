'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawingStroke } from '@/lib/types'
import { getQuestionDrawing, saveQuestionDrawing } from '@/lib/store'
import { hitsStroke } from '@/lib/strokeHit'

/**
 * 문제 하나에 딸린 그림판.
 *
 * 지문 위에 겹쳐 긋는 오버레이(DrawLayer)와는 별개의 기능이다. 그쪽은 글자 위에 표시를
 * 남기는 것이라 화면 폭이 바뀌면 글자와 어긋나고, 그래서 저장하지 않는다.
 * 이쪽은 **글자에 매이지 않은 독립 캔버스**라 비율 좌표로 담아 두면 어느 기기에서 열어도
 * 같은 그림이 나온다. 그래서 저장한다.
 *
 * 그리는 손놀림 자체(포인터 처리·펜/지우개·DPR 보정)는 DrawLayer 와 같은 방식이고,
 * 좌표 기준만 다르다 — 여기서는 캔버스 폭으로 나눈 비율로 담는다
 */

// 4:3 고정. 높이가 폭을 따라 정해지므로 폭 하나만 알면 그림이 그대로 복원된다
const ASPECT = 3 / 4

// 두께도 폭 대비 비율이다. 400px 캔버스에서 펜 2.4px, 지우개 18px 쯤 된다
const PEN_WIDTH = 0.006
const ERASER_WIDTH = 0.045

const PEN_COLOR = '#ef4444'

// 좌표는 소수점 3자리까지만 남긴다. 400px 캔버스에서 0.4px 눈금이라 눈으로는 차이가 없고,
// 자리는 절반 넘게 줄어든다
const PRECISION = 1000
// 이만큼도 안 움직인 점은 버린다. 손이 멈춘 사이에도 포인터 이벤트는 계속 들어온다
const MIN_MOVE_PX = 2
// 획 지우개가 무는 거리. 좌표가 비율이라 이것도 폭 대비로 둔다 (400px 캔버스에서 12px)
const STROKE_HIT = 0.03

// 'eraser' 는 지나간 자리를 픽셀째로 지우고, 'strokeEraser' 는 누른 획을 통째로 지운다
type Tool = 'pen' | 'eraser' | 'strokeEraser'

function round(v: number): number {
  return Math.round(v * PRECISION) / PRECISION
}

function applyStyle(ctx: CanvasRenderingContext2D, stroke: { erase: boolean; width: number }, w: number) {
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
  ctx.strokeStyle = PEN_COLOR
  ctx.fillStyle = PEN_COLOR
  // 비율을 그 화면의 픽셀로 되돌린다. 폭이 두 배면 획도 두 배 굵어야 같은 그림이다
  ctx.lineWidth = Math.max(1, stroke.width * w)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** 저장된 획 하나를 지금 화면 크기에 맞춰 그린다 */
function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawingStroke, w: number) {
  const p = stroke.points
  if (p.length < 2) return
  applyStyle(ctx, stroke, w)
  // 톡 찍은 점도 자국이 남아야 한다. 선으로 그리면 길이가 0이라 아무것도 안 보인다
  if (p.length === 2) {
    ctx.beginPath()
    ctx.arc(p[0] * w, p[1] * w, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(p[0] * w, p[1] * w)
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * w)
  ctx.stroke()
}

/** 손이 움직인 만큼만 이어 그린다. 획마다 전부 다시 그리면 손끝이 밀린다 */
function paintSegment(
  ctx: CanvasRenderingContext2D,
  stroke: { erase: boolean; width: number },
  from: [number, number],
  to: [number, number],
  w: number
) {
  applyStyle(ctx, stroke, w)
  ctx.beginPath()
  ctx.moveTo(from[0] * w, from[1] * w)
  ctx.lineTo(to[0] * w, to[1] * w)
  ctx.stroke()
}

interface Props {
  questionId: string
  questionNo: string | number
  onClose: () => void
  /** 저장한 뒤 알린다 (동기화 트리거) */
  onSaved: () => void
}

export function DrawingPad({ questionId, questionNo, onClose, onSaved }: Props) {
  // 저장된 그림을 그대로 불러와 이어 그린다
  const [strokes, setStrokes] = useState<DrawingStroke[]>(() => getQuestionDrawing(questionId)?.strokes ?? [])
  const [tool, setTool] = useState<Tool>('pen')
  const [width, setWidth] = useState(0)

  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 그리는 중인 획. state 에 넣으면 점 하나마다 화면을 다시 그리게 된다
  const live = useRef<DrawingStroke | null>(null)
  // 솎아내기 기준이 되는, 마지막으로 받아들인 점 (화면 픽셀)
  const lastPx = useRef<[number, number] | null>(null)
  // 획 지우개로 문지르는 중인지. 이때는 새 획을 만들지 않는다
  const wiping = useRef(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 폭이나 획이 바뀌면 처음부터 다시 그린다. 창 크기를 바꿔도 그림이 같이 늘어나는 자리다
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || width === 0) return
    const height = width * ASPECT
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(height * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    for (const s of strokes) paintStroke(ctx, s, width)
  }, [width, strokes])

  /**
   * 그 자리에 걸린 획을 배열에서 뺀다. 저장 형태는 그대로다 — 통째로 빠질 뿐이다.
   *
   * 지우개로 그은 획(erase)은 건드리지 않는다 — 눈에 안 보이는 것을 지우면 아까 지웠던
   * 자국이 되살아나, 누른 사람에게는 없던 그림이 튀어나온 것으로 보인다
   */
  const wipeAt = useCallback(([x, y]: [number, number]) => {
    setStrokes((prev) => {
      const next = prev.filter(
        (s) => s.erase || !hitsStroke(s.points.length / 2, (i) => [s.points[i * 2], s.points[i * 2 + 1]], x, y, STROKE_HIT)
      )
      return next.length === prev.length ? prev : next
    })
  }, [])

  /** 화면 좌표를 캔버스 폭 대비 비율로 바꾼다. 저장되는 값은 늘 이 형태다 */
  const at = (e: React.PointerEvent<HTMLCanvasElement>): { ratio: [number, number]; px: [number, number] } => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const w = r.width || 1
    return { ratio: [round(x / w), round(y / w)], px: [x, y] }
  }

  const down = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // 마우스·터치·펜을 한 갈래로 받는다. 장치마다 다른 API 를 쓰지 않는 이유다
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const { ratio, px } = at(e)
      if (tool === 'strokeEraser') {
        wiping.current = true
        wipeAt(ratio)
        return
      }
      const stroke: DrawingStroke = {
        erase: tool === 'eraser',
        width: tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH,
        points: [ratio[0], ratio[1]],
      }
      live.current = stroke
      lastPx.current = px
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx && width > 0) paintStroke(ctx, stroke, width)
    },
    [tool, width, wipeAt]
  )

  const move = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (wiping.current) {
      e.preventDefault()
      wipeAt(at(e).ratio)
      return
    }
    const s = live.current
    if (!s) return
    e.preventDefault()
    const { ratio, px } = at(e)
    const prev = lastPx.current
    // 2px 도 안 움직였으면 버린다. 그림은 그대로인데 점만 늘어나는 구간이다
    if (prev && Math.hypot(px[0] - prev[0], px[1] - prev[1]) < MIN_MOVE_PX) return
    const from: [number, number] = [s.points[s.points.length - 2], s.points[s.points.length - 1]]
    s.points.push(ratio[0], ratio[1])
    lastPx.current = px
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && width > 0) paintSegment(ctx, s, from, ratio, width)
  }, [width, wipeAt])

  const up = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (wiping.current) {
      wiping.current = false
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      return
    }
    const s = live.current
    if (!s) return
    live.current = null
    lastPx.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setStrokes((prev) => [...prev, s])
  }, [])

  // 저장은 여기 한 번뿐이다. 획마다 저장하면 한 장 그리는 동안 로컬 쓰기가 수백 번 돈다
  function saveAndClose() {
    saveQuestionDrawing(questionId, { strokes })
    onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">🎨 {questionNo}번 그림판</h2>
          <button
            onClick={onClose}
            title="저장하지 않고 닫기"
            className="text-xl leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>

        {/* 4:3 고정. 폭만 화면에 맞추고 높이는 따라오게 두면 어느 기기에서도 같은 그림이다 */}
        <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl border border-border bg-white">
          <div style={{ paddingTop: `${ASPECT * 100}%` }} />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTool('pen')}
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tool === 'pen' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            ✏️ 펜
          </button>
          <button
            onClick={() => setTool('eraser')}
            title="지나간 자리를 문질러 지웁니다"
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tool === 'eraser' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            🧽 지우개
          </button>
          <button
            onClick={() => setTool('strokeEraser')}
            title="획 하나를 눌러 통째로 지웁니다"
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tool === 'strokeEraser' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            ✂️ 획 지우개
          </button>
          <button
            onClick={() => setStrokes([])}
            disabled={strokes.length === 0}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            전체 지우기
          </button>
          <button
            onClick={saveAndClose}
            className="ml-auto rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            완료
          </button>
        </div>
      </div>
    </div>
  )
}
