'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { hitsStroke } from '@/lib/strokeHit'

/**
 * 문제 위에 직접 그리는 필기 레이어.
 *
 * 지문에 동그라미를 치고 화살표를 긋는 일은 종이 시험지에서 하던 것이다. 형광펜(밑줄·칠)은
 * 글자 좌표에 붙어 있어 글자가 없는 자리에는 아무 표시도 못 한다. 그래서 이 레이어는
 * 글자와 무관한 **캔버스 한 장**으로 따로 둔다 — 두 기능은 서로를 모른다.
 *
 * 그린 것은 어디에도 저장하지 않는다. 세션 동안 메모리에만 있다가 화면을 벗어나면 사라진다.
 * 문제를 오갈 때 남아 있어야 하므로, 보관은 문제 하나가 아니라 **문제를 넘기는 컴포넌트**가
 * 맡는다(useDrawBoard). 그 컴포넌트가 사라지면 그림도 함께 사라진다 — 따로 치울 것이 없다
 */

export interface DrawPoint {
  x: number
  y: number
}

export interface DrawStroke {
  /** 지우개로 그은 획. 그릴 때 destination-out 으로 지운다 */
  erase: boolean
  points: DrawPoint[]
}

/**
 * 'eraser' 는 지나간 자리를 픽셀째로 지우고, 'strokeEraser' 는 누른 획을 통째로 지운다.
 * 종이에 연필로 문지르는 것과, 그은 줄 하나를 골라 없애는 것의 차이다
 */
export type DrawTool = 'pen' | 'eraser' | 'strokeEraser'

/** 문제 id → 그 문제에 그린 획들 */
export type DrawStrokeMap = Record<string, DrawStroke[]>

export interface DrawBoard {
  enabled: boolean
  setEnabled: (on: boolean) => void
  tool: DrawTool
  setTool: (tool: DrawTool) => void
  byQuestion: DrawStrokeMap
  setByQuestion: React.Dispatch<React.SetStateAction<DrawStrokeMap>>
}

/**
 * 필기 상태를 문제 목록을 쥔 쪽에 둔다.
 *
 * 문제를 넘겨도 이 컴포넌트는 살아 있으므로 그림이 남고, 채점을 끝내거나 세션을 접거나
 * 새로고침하면 통째로 사라진다. 저장·정리 로직이 따로 필요 없는 이유다
 */
export function useDrawBoard(): DrawBoard {
  const [enabled, setEnabled] = useState(false)
  const [tool, setTool] = useState<DrawTool>('pen')
  const [byQuestion, setByQuestion] = useState<DrawStrokeMap>({})
  return { enabled, setEnabled, tool, setTool, byQuestion, setByQuestion }
}

// 단일 색·단일 두께. 밝은 화면에서도 어두운 화면에서도 글자 위에서 읽히는 빨강을 쓴다
const PEN_COLOR = '#ef4444'
const PEN_WIDTH = 2.5
const ERASER_WIDTH = 18

// 획 지우개가 무는 거리. 손끝은 정확하지 않아 획 두께보다 넉넉해야 한다
const STROKE_HIT_PX = 12

const EMPTY: DrawStroke[] = []

function strokeStyle(ctx: CanvasRenderingContext2D, erase: boolean) {
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  ctx.strokeStyle = PEN_COLOR
  ctx.fillStyle = PEN_COLOR
  ctx.lineWidth = erase ? ERASER_WIDTH : PEN_WIDTH
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** 획 하나를 통째로 그린다 (다시 그리기용) */
function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  const pts = stroke.points
  if (pts.length === 0) return
  strokeStyle(ctx, stroke.erase)
  // 톡 찍은 점도 자국이 남아야 한다. 선으로 그리면 길이가 0이라 아무것도 안 보인다
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

/** 손이 움직인 만큼만 이어 그린다. 획마다 전부 다시 그리면 손끝이 밀린다 */
function paintSegment(ctx: CanvasRenderingContext2D, from: DrawPoint, to: DrawPoint, erase: boolean) {
  strokeStyle(ctx, erase)
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

interface Props {
  board: DrawBoard
  /** 그림을 매어 둘 키. 이 값이 바뀌면 그 문제의 그림으로 갈아 끼운다 */
  questionId: string
  className?: string
  children: React.ReactNode
  /**
   * 안내에 덧붙일 한마디. 저장되는 그림판이 같은 화면에 함께 있을 때 그쪽을 가리킨다 —
   * CBT 처럼 그림판이 없는 화면에서는 넘기지 않는다
   */
  keepHint?: string
  /** 기존 형광펜이 쓰는 손잡이들. 그리기 모드에서는 호출부가 넘기지 않는다 */
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>
  onTouchEnd?: React.TouchEventHandler<HTMLDivElement>
}

export function DrawLayer({ board, questionId, className, children, keepHint, ...handlers }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 그리는 중인 획. state 에 넣으면 점 하나마다 화면을 다시 그리게 된다
  const live = useRef<DrawStroke | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 저장되지 않는다는 안내. 처음 켤 때 한 번만 펴 보이고, 닫으면 이 화면에 있는 동안은
  // 다시 뜨지 않는다. 그림 자체를 저장하지 않는 기능이라 이 표시도 남기지 않는다
  const [noticeOpen, setNoticeOpen] = useState(true)
  // 획 지우개로 문지르는 중인지. 이때는 새 획을 만들지 않는다
  const wiping = useRef(false)

  const strokes = board.byQuestion[questionId] ?? EMPTY

  // 문제마다 지문 길이가 달라 카드 높이가 바뀐다. 캔버스도 따라가야 그림이 어긋나지 않는다
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [questionId])

  // 크기나 획이 바뀌면 처음부터 다시 그린다. 문제를 오갈 때 그림이 갈아 끼워지는 자리이기도 하다
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || size.w === 0 || size.h === 0) return
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    for (const s of strokes) paintStroke(ctx, s)
  }, [size, strokes])

  /**
   * 그 자리에 걸린 획을 배열에서 뺀다.
   *
   * 지우개로 그은 획(erase)은 건드리지 않는다 — 눈에 안 보이는 것을 지우면 아까 지웠던
   * 자국이 되살아나, 누른 사람에게는 없던 그림이 튀어나온 것으로 보인다
   */
  const wipeAt = useCallback(
    (p: DrawPoint) => {
      board.setByQuestion((m) => {
        const list = m[questionId] ?? []
        const next = list.filter(
          (s) => s.erase || !hitsStroke(s.points.length, (i) => [s.points[i].x, s.points[i].y], p.x, p.y, STROKE_HIT_PX)
        )
        // 걸린 것이 없으면 같은 객체를 돌려준다. 문지르는 내내 다시 그리게 할 이유가 없다
        return next.length === list.length ? m : { ...m, [questionId]: next }
      })
    },
    [board, questionId]
  )

  const at = (e: React.PointerEvent<HTMLCanvasElement>): DrawPoint => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!board.enabled) return
      // 마우스·터치·펜을 한 갈래로 받는다. 장치마다 다른 API 를 쓰지 않는 이유다
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const p = at(e)
      if (board.tool === 'strokeEraser') {
        wiping.current = true
        wipeAt(p)
        return
      }
      live.current = { erase: board.tool === 'eraser', points: [p] }
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) paintStroke(ctx, live.current)
    },
    [board.enabled, board.tool, wipeAt]
  )

  const move = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (wiping.current) {
      e.preventDefault()
      wipeAt(at(e))
      return
    }
    const s = live.current
    if (!s) return
    e.preventDefault()
    const p = at(e)
    const prev = s.points[s.points.length - 1]
    s.points.push(p)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) paintSegment(ctx, prev, p, s.erase)
  }, [wipeAt])

  const up = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (wiping.current) {
        wiping.current = false
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        return
      }
      const s = live.current
      if (!s) return
      live.current = null
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      board.setByQuestion((m) => ({ ...m, [questionId]: [...(m[questionId] ?? []), s] }))
    },
    [board, questionId]
  )

  const hasDrawing = strokes.length > 0

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`} {...handlers}>
      {children}

      {/*
        캔버스는 평소 입력을 받지 않는다(pointer-events-none). 그래야 그 아래 선지 클릭·
        형광펜 드래그가 종전대로 동작한다. 그리기 모드에서만 입력을 가로챈다
      */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`absolute inset-0 h-full w-full rounded-xl ${
          board.enabled ? 'pointer-events-auto touch-none cursor-crosshair' : 'pointer-events-none'
        }`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />

      {/* 화면 아래에 붙어 따라다닌다. 긴 지문에서도 손이 닿는 자리에 있어야 한다 */}
      <div className="pointer-events-none sticky bottom-3 z-20 flex flex-col items-end gap-1.5">
        {/* 처음 켤 때 한 번. 같은 화면에 저장되는 그림판이 따로 있어서, 어느 쪽에 그리고
            있는지 모르면 애써 그린 것을 잃는다 */}
        {board.enabled && noticeOpen && (
          <div className="pointer-events-auto flex max-w-xs items-start gap-2 rounded-xl border border-border bg-card/95 px-2.5 py-2 shadow-lg backdrop-blur">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              여기 그린 것은 저장되지 않아요. 화면을 나가면 사라집니다{keepHint ? ` — ${keepHint}` : ''}.
            </p>
            <button
              onClick={() => setNoticeOpen(false)}
              aria-label="안내 닫기"
              title="닫기"
              className="-mt-0.5 shrink-0 text-sm leading-none text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-1 rounded-2xl border border-border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur">
          {board.enabled ? (
            <>
              {/* 안내를 닫은 뒤에도 어느 쪽에 그리고 있는지는 계속 보여야 한다 */}
              <span
                title="여기 그린 것은 저장되지 않아요"
                className="px-1 text-[10px] text-muted-foreground"
              >
                임시
              </span>
              <button
                onClick={() => board.setTool('pen')}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  board.tool === 'pen' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                ✏️ 펜
              </button>
              <button
                onClick={() => board.setTool('eraser')}
                title="지나간 자리를 문질러 지웁니다"
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  board.tool === 'eraser' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                🧽 지우개
              </button>
              <button
                onClick={() => board.setTool('strokeEraser')}
                title="획 하나를 눌러 통째로 지웁니다"
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  board.tool === 'strokeEraser'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                ✂️ 획 지우개
              </button>
              <button
                onClick={() => board.setByQuestion((m) => ({ ...m, [questionId]: [] }))}
                disabled={!hasDrawing}
                className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                전체 지우기
              </button>
              <button
                onClick={() => board.setEnabled(false)}
                className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:opacity-80"
              >
                완료
              </button>
            </>
          ) : (
            <button
              onClick={() => board.setEnabled(true)}
              title="임시로 그리는 곳이에요 — 저장되지 않아요"
              className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ✏️ 그리기{hasDrawing ? ' •' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
