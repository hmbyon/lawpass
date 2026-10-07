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

/**
 * 옆에 붙박이로 놓을 자리가 있는 화면인가.
 *
 * 문제 카드가 42rem(672px)이고 가운데 정렬이라, 패널을 옆에 두려면 한쪽 여백이
 * 패널 폭 + 여유만큼 있어야 한다. 그만한 자리가 없는데 띄우면 지문을 가리게 되는데,
 * 그건 "지문을 보면서 그린다"는 이 변경의 목적을 정면으로 거스른다.
 * 자리가 없으면 옮길 수 있는 작은 창으로 띄운다
 */
const DOCK_QUERY = '(min-width: 1160px)'

export function useDockedPad(): boolean {
  // 서버에서는 화면 크기를 모른다. 창부터 시작해 붙박이로 바꾸면 깜빡임이 한 번뿐이다
  const [docked, setDocked] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY)
    const sync = () => setDocked(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return docked
}

// 띄운 창의 최소 폭. 4:3 이라 이보다 좁으면 캔버스가 손가락보다 작아진다
const MIN_WINDOW = 200

/**
 * 붙박이 패널의 폭 한계.
 *
 * 기본 폭은 문제 카드(42rem) 옆에 남는 자리에 맞춰져 있는데, 그 자리는 오른쪽 여백뿐이라
 * 왼쪽 여백이 통째로 논다. 넓히면 그쪽까지 쓸 수 있어야 하므로 위는 넉넉히 연다 —
 * 지문을 얼마나 가릴지는 그리는 사람이 정할 일이다.
 * 대신 화면 밖으로는 못 나가게 하고(화면 폭 - 여백), 아래는 캔버스가 손가락보다
 * 작아지지 않는 선에서 막는다
 */
const MIN_DOCK = 220
const DOCK_MARGIN = 24
// 붙박이 패널이 화면 오른쪽 끝에서 띄운 자리(right-4 = 16px) + 문제 카드와의 사이 여유(8px).
// 패널 폭에 이만큼을 더한 것이 "오른쪽에서 문제 카드가 비켜 줘야 하는 폭"이다
const DOCK_RESERVE_EXTRA = 24

function maxDockWidth(): number {
  if (typeof window === 'undefined') return MIN_DOCK
  return Math.max(MIN_DOCK, window.innerWidth - DOCK_MARGIN)
}

function clampDock(w: number): number {
  return Math.max(MIN_DOCK, Math.min(w, maxDockWidth()))
}


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
  /** 띄운 창일 때만 본다. 붙박이 패널은 늘 열려 있다 */
  open: boolean
  onClose: () => void
  /** 저장한 뒤 알린다 (동기화 트리거) */
  onSaved: () => void
  /**
   * 붙박이 패널의 폭. null 이면 화면에 맞춘 기본 폭.
   * 부모가 쥔다 — 이 컴포넌트는 문제마다 key 로 새로 마운트되므로, 안에 두면
   * 문제를 넘길 때마다 넓혀 둔 폭이 기본 폭으로 되돌아간다
   */
  dockW: number | null
  onDockWChange: (w: number | null) => void
  /**
   * 오른쪽에서 문제 카드가 비켜 줘야 하는 폭(px). 붙박이 패널이 기본 폭보다 넓어졌을 때만
   * 0 보다 크다. 부모가 이 값으로 문제 카드를 왼쪽 여백 쪽으로 밀어 지문을 가리지 않게 한다
   */
  onReserveChange: (px: number) => void
}

export function DrawingPad({ questionId, questionNo, open, onClose, onSaved, dockW, onDockWChange, onReserveChange }: Props) {
  // 저장된 그림을 그대로 불러와 이어 그린다
  const [strokes, setStrokes] = useState<DrawingStroke[]>(() => getQuestionDrawing(questionId)?.strokes ?? [])
  const [tool, setTool] = useState<Tool>('pen')
  const [width, setWidth] = useState(0)

  const docked = useDockedPad()
  // 붙박이 패널을 잠시 치워 둘 수 있게 한다. 늘 떠 있는 것은 치울 길도 있어야 한다
  const [folded, setFolded] = useState(false)
  const [saved, setSaved] = useState(false)
  // 띄운 창의 자리와 폭. 높이는 4:3 이라 폭이 정한다 — 폭 하나만 붙들면 된다
  const [win, setWin] = useState<{ x: number; y: number; w: number } | null>(null)
  // 붙박이 패널의 폭은 부모가 쥔다(props). null 이면 화면에 맞춘 기본 폭(아래 클래스의 clamp)을 쓴다.
  // 이 세션 동안만 기억한다 — 저장할 만큼 무거운 취향이 아니고, 저장소를 하나 더 만들면
  // 계정 전환·초기화 때 치울 것도 하나 더 늘어난다
  const setDockW = onDockWChange

  // 지금 어느 껍데기를 그리고 있는가. 아래 두 효과가 이 값을 보고 다시 돈다
  const shell = docked ? (folded ? 'folded' : 'docked') : open && win ? 'window' : 'none'
  // 문제를 넘길 때 자동 저장하기 위한 자리들.
  // setStrokes 는 늘 새 배열을 만들므로, 마지막으로 저장한 배열과 같은 것을 들고 있으면
  // 아직 아무것도 안 그린(또는 그린 뒤 저장한) 상태다 — 참조 하나로 판별이 끝난다
  const savedStrokes = useRef<DrawingStroke[]>(strokes)
  const latest = useRef({ strokes, docked, onSaved })
  latest.current = { strokes, docked, onSaved }
  const dragFrom = useRef<{ dx: number; dy: number } | null>(null)
  const sizeFrom = useRef<{ x0: number; w0: number } | null>(null)
  // 붙박이 패널을 끌어 넓히는 중에 붙드는 값. 패널은 오른쪽에 붙어 있으므로
  // 손잡이를 왼쪽으로 끌면 그만큼 넓어진다
  const dockSizeFrom = useRef<{ x0: number; w0: number } | null>(null)
  const asideRef = useRef<HTMLElement>(null)

  /**
   * 지금 화면에 선 껍데기.
   *
   * 이 값이 바뀌면 캔버스가 DOM 에서 빠졌다 새로 붙는다. 아래 두 효과(크기 재기,
   * 다시 그리기)가 이것을 의존성으로 봐야 하는 이유다 — 예전에는 빈 배열이라 마운트 때
   * 딱 한 번 돌았는데, 이 컴포넌트는 붙박이가 될지 창이 될지 정해지기 전에 먼저 마운트되어
   * null 을 그린다. 그 순간 ref 는 비어 있고, 나중에 패널이 떠도 크기를 다시 재지 않아
   * width 가 0 에 머물렀다. 그리는 코드는 모두 width > 0 을 보므로 획은 쌓이는데 화면에는
   * 아무것도 안 나왔다
   */
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 그리는 중인 획. state 에 넣으면 점 하나마다 화면을 다시 그리게 된다
  const live = useRef<DrawingStroke | null>(null)
  // 솎아내기 기준이 되는, 마지막으로 받아들인 점 (화면 픽셀)
  const lastPx = useRef<[number, number] | null>(null)
  // 획 지우개로 문지르는 중인지. 이때는 새 획을 만들지 않는다.
  // 어느 포인터가 문지르고 있는지는 아래 activePointer 가 함께 쥔다 — 그리기와 같은 규칙이다
  const wiping = useRef(false)
  /**
   * 지금 이 손놀림(획 그리기 또는 획 지우개로 문지르기)을 쥔 포인터의 id.
   *
   * 아이패드에서 펜슬로 쓰는 동안 손바닥이나 다른 손가락이 같은 캔버스에 pointerdown 을
   * 또 보낸다. 그러면 그리던 획(live)이 새 획으로 갈아 끼워져, 그리고 있던 획은 배열에
   * 들어가지 못한 채 사라지고 이어지는 pointermove 는 손바닥 자리에서 시작한 엉뚱한 획에
   * 붙는다 — 방금 그은 획이 끊기거나 없어지고, 그 자리에서 선이 끌려간다.
   * 획 지우개도 같다: 문지르는 도중 손바닥이 닿으면 그 자리의 획까지 함께 지워진다.
   * 그래서 손놀림 하나는 그것을 시작한 포인터만 이어 간다
   */
  const activePointer = useRef<number | null>(null)

  // 획을 긋는 동안에는 문서 어디서도 글자 선택이 시작되지 않게 한다.
  // 캔버스의 select-none 은 캔버스 자체만 막는다 — 아이패드에서 이어 긋는 손이 옆의 글자
  // (그림판 제목줄의 '접기' 같은 것)에 선택을 걸어 끌고 가는 것은 이 리스너가 막는다
  useEffect(() => {
    const block = (e: Event) => {
      if (activePointer.current !== null) e.preventDefault()
    }
    document.addEventListener('selectstart', block)
    return () => document.removeEventListener('selectstart', block)
  }, [])

  /** 그리던 획을 배열에 넣고 손을 뗀 상태로 돌린다 (문지르던 중이었으면 그냥 정리된다) */
  const commitLive = useCallback(() => {
    wiping.current = false
    const s = live.current
    live.current = null
    lastPx.current = null
    activePointer.current = null
    if (s) setStrokes((prev) => [...prev, s])
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shell])

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
  }, [shell, width, strokes])

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
      // 앞서 잡힌 글자 선택이 남아 있으면 이어 긋는 손이 그 선택을 끌고 간다. 획을 시작할 때 걷어 낸다
      window.getSelection()?.removeAllRanges()
      const active = activePointer.current
      if (active !== null && active !== e.pointerId) {
        const held =
          typeof e.currentTarget.hasPointerCapture === 'function'
            ? e.currentTarget.hasPointerCapture(active)
            : false
        // 앞 포인터가 아직 캔버스를 붙들고 있다 = 그리거나 문지르는 중이다.
        // 손바닥·두 번째 손가락이 그것을 가로채지 못하게 여기서 끊는다
        if (held) return
        // 붙들고 있지 않다 = 그 포인터의 pointerup 을 못 받았다(아이패드에서 실제로 생긴다).
        // 그리던 획을 잃지 않게 여기서 마감하고(문지르던 것은 정리하고) 새로 시작한다
        commitLive()
      }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const { ratio, px } = at(e)
      if (tool === 'strokeEraser') {
        wiping.current = true
        activePointer.current = e.pointerId
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
      activePointer.current = e.pointerId
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx && width > 0) paintStroke(ctx, stroke, width)
    },
    [tool, width, wipeAt, commitLive]
  )

  const move = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (wiping.current) {
      // 문지르기를 시작한 포인터만 따라간다. 손바닥이 닿은 자리의 획을 지우지 않게
      if (activePointer.current !== e.pointerId) return
      e.preventDefault()
      wipeAt(at(e).ratio)
      return
    }
    const s = live.current
    if (!s) return
    // 이 획을 시작한 포인터가 아니면 무시한다 (손바닥이 획을 끌고 가지 않게)
    if (activePointer.current !== e.pointerId) return
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
      // 무시한 손바닥의 pointerup 으로는 문지르기를 끝내지 않는다
      if (activePointer.current !== e.pointerId) return
      wiping.current = false
      activePointer.current = null
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      return
    }
    if (!live.current) return
    // 그리던 포인터가 아니면(무시한 손바닥의 pointerup) 획을 끝내지 않는다
    if (activePointer.current !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    commitLive()
  }, [commitLive])

  /**
   * 문제를 넘기기 직전에 자동으로 저장한다.
   *
   * 붙박이 패널은 늘 떠 있어 닫는 동작이 없다. 저장 버튼을 눌러야 남는다는 것을 사람이
   * 계속 기억해야 하는데, 그린 뒤 다음 문제로 넘어가는 것이 가장 자연스러운 흐름이라
   * 놓치기 딱 좋다. 그래서 사라지기 직전에 한 번 더 붙든다.
   *
   * study-tab 의 이동 버튼마다 손을 넣지 않고 여기 둔 이유: 이 패널은 문제마다 key 로
   * 새로 열리므로 '사라지는 순간'이 곧 '문제가 바뀌는 순간'이다. 다음·이전·번호 점프는
   * 물론 학습 화면을 아예 벗어나는 길까지 한 자리에서 걸린다.
   *
   * 띄운 창(좁은 화면)에는 걸지 않는다. 거기서는 닫는 동작이 있어 사람이 판단할 자리가
   * 이미 있다
   */
  useEffect(() => {
    return () => {
      const { strokes: last, docked: wasDocked, onSaved: notify } = latest.current
      if (!wasDocked) return
      // 저장한 뒤로 달라진 것이 없으면 아무 일도 하지 않는다
      if (last === savedStrokes.current) return
      saveQuestionDrawing(questionId, { strokes: last })
      savedStrokes.current = last
      notify()
    }
  }, [questionId])

  // 처음 띄울 때 자리를 잡는다. 한 번 옮겨 둔 자리는 다시 열어도 그대로다
  useEffect(() => {
    if (!open || docked || win) return
    const w = Math.min(340, window.innerWidth - 24)
    setWin({ x: Math.max(12, (window.innerWidth - w) / 2), y: Math.max(12, Math.round(window.innerHeight * 0.16)), w })
  }, [open, docked, win])

  const clampWin = (x: number, y: number, w: number) => ({
    // 창이 화면 밖으로 나가면 다시 잡을 수 없다. 늘 붙들 자리를 남긴다
    x: Math.max(8 - w + 80, Math.min(x, window.innerWidth - 80)),
    y: Math.max(8, Math.min(y, window.innerHeight - 60)),
    w,
  })

  function dragDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!win) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragFrom.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }
  }
  function dragMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = dragFrom.current
    if (!from) return
    e.preventDefault()
    setWin((prev) => (prev ? clampWin(e.clientX - from.dx, e.clientY - from.dy, prev.w) : prev))
  }
  function dragUp(e: React.PointerEvent<HTMLDivElement>) {
    dragFrom.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  function dockSizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // 기본 폭(clamp)으로 있다가 끌기 시작하면, 지금 화면에 보이는 폭에서 이어 간다
    const w0 = dockW ?? asideRef.current?.getBoundingClientRect().width ?? MIN_DOCK
    dockSizeFrom.current = { x0: e.clientX, w0 }
  }
  function dockSizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = dockSizeFrom.current
    if (!from) return
    e.preventDefault()
    setDockW(clampDock(from.w0 + (from.x0 - e.clientX)))
  }
  function dockSizeUp(e: React.PointerEvent<HTMLDivElement>) {
    dockSizeFrom.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // 창이 좁아지면 넓혀 둔 패널이 화면 밖으로 밀려난다. 그때만 도로 줄인다
  useEffect(() => {
    if (dockW === null) return
    const onResize = () => setDockW(clampDock(dockW))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [dockW, setDockW])

  // 넓혀 둔 붙박이 패널이 차지한 폭을 부모에 알린다. 기본 폭일 때는 오른쪽 여백 안에 들어가므로
  // 0 — 문제 카드는 가운데에 그대로 있다. 접거나 창 모드로 바뀌면 다시 0
  useEffect(() => {
    onReserveChange(shell === 'docked' && dockW !== null ? dockW + DOCK_RESERVE_EXTRA : 0)
  }, [shell, dockW, onReserveChange])
  // 이 컴포넌트가 사라질 때(문제를 넘길 때 포함) 자리를 비운다. 새로 마운트되면서 곧바로 다시 알린다
  useEffect(() => () => onReserveChange(0), [onReserveChange])

  function sizeDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!win) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    sizeFrom.current = { x0: e.clientX, w0: win.w }
  }
  function sizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = sizeFrom.current
    if (!from) return
    e.preventDefault()
    setWin((prev) => {
      if (!prev) return prev
      const w = Math.max(MIN_WINDOW, Math.min(window.innerWidth - prev.x - 8, from.w0 + (e.clientX - from.x0)))
      return { ...prev, w }
    })
  }
  function sizeUp(e: React.PointerEvent<HTMLDivElement>) {
    sizeFrom.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // 저장은 여기 한 번뿐이다. 획마다 저장하면 한 장 그리는 동안 로컬 쓰기가 수백 번 돈다
  function save() {
    saveQuestionDrawing(questionId, { strokes })
    // 지금 것을 저장했다고 적어 둔다. 자동 저장이 같은 그림을 또 쓰지 않게 하는 표시다
    savedStrokes.current = strokes
    onSaved()
  }

  function saveAndClose() {
    save()
    onClose()
  }

  // 붙박이 패널은 닫을 일이 없어, 저장했다는 것만 잠깐 알린다
  function saveInPlace() {
    save()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  // 캔버스와 도구는 두 표시 방식이 그대로 나눠 쓴다. 바뀌는 것은 껍데기뿐이다
  const canvas = (
    /* 4:3 고정. 폭만 화면에 맞추고 높이는 따라오게 두면 어느 기기에서도 같은 그림이다 */
    <div ref={boxRef} className="relative w-full select-none overflow-hidden rounded-xl border border-border bg-white">
      <div style={{ paddingTop: `${ASPECT * 100}%` }} />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )

  const tools = (
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
        onClick={docked ? saveInPlace : saveAndClose}
        className="ml-auto rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        {docked ? (saved ? '✓ 저장됨' : '저장') : '완료'}
      </button>
    </div>
  )

  // ── 넓은 화면: 지문 옆에 붙박이로 ──
  if (docked) {
    if (folded) {
      return (
        <button
          onClick={() => setFolded(false)}
          title="그림판 펴기"
          className="fixed right-4 top-24 z-40 rounded-full border border-border bg-card px-3 py-2 text-sm shadow-lg hover:border-primary/40"
        >
          🎨
        </button>
      )
    }
    return (
      <aside
        ref={asideRef}
        style={dockW === null ? undefined : { width: dockW }}
        className={`fixed right-4 top-24 z-40 flex select-none flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg [-webkit-touch-callout:none] ${
          dockW === null ? 'w-[clamp(220px,calc((100vw-42rem)/2-2rem),340px)]' : ''
        }`}
      >
        {/* 왼쪽 모서리를 끌어 넓힌다. 기본 폭은 오른쪽 여백에만 맞춰져 있어,
            넓히지 않으면 왼쪽 여백이 통째로 논다 */}
        <div
          onPointerDown={dockSizeDown}
          onPointerMove={dockSizeMove}
          onPointerUp={dockSizeUp}
          onPointerCancel={dockSizeUp}
          onDoubleClick={() => setDockW(null)}
          role="separator"
          aria-orientation="vertical"
          aria-label="그림판 폭 조절 (두 번 누르면 기본 폭)"
          title="끌어서 폭 조절 · 두 번 누르면 기본 폭"
          className="absolute inset-y-3 -left-1 w-3 cursor-ew-resize touch-none rounded-full before:absolute before:inset-y-0 before:left-1 before:w-1 before:rounded-full before:bg-border hover:before:bg-primary/50"
        />
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold">🎨 {questionNo}번 그림판</h2>
          <button
            type="button"
            draggable={false}
            onClick={() => setFolded(true)}
            title="접어 두기"
            className="select-none text-xs text-muted-foreground hover:text-foreground"
          >
            접기
          </button>
        </div>
        {canvas}
        {tools}
      </aside>
    )
  }

  // ── 좁은 화면: 옮기고 늘릴 수 있는 작은 창 ──
  // 뒤를 덮지 않는다. 지문이 계속 보여야 그것을 보며 그린다
  if (!open || !win) return null
  return (
    <div
      className="fixed z-50 flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-2xl"
      style={{ left: win.x, top: win.y, width: win.w }}
    >
      <div
        onPointerDown={dragDown}
        onPointerMove={dragMove}
        onPointerUp={dragUp}
        onPointerCancel={dragUp}
        className="flex cursor-move touch-none items-center justify-between"
      >
        <h2 className="text-xs font-semibold">⠿ 🎨 {questionNo}번 그림판</h2>
        <button
          onClick={onClose}
          title="저장하지 않고 닫기"
          aria-label="그림판 닫기"
          className="text-lg leading-none text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {canvas}
      {tools}
      <div
        onPointerDown={sizeDown}
        onPointerMove={sizeMove}
        onPointerUp={sizeUp}
        onPointerCancel={sizeUp}
        title="끌어서 크기 조절"
        className="absolute bottom-0 right-0 h-7 w-7 cursor-se-resize touch-none rounded-br-2xl border-b-2 border-r-2 border-muted-foreground/40"
      />
    </div>
  )
}
