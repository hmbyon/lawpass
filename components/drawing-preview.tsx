'use client'

import { useEffect, useMemo, useRef } from 'react'
import { getQuestionDrawing } from '@/lib/store'
import { paintStroke } from '@/components/drawing-pad'

// 그림판(DrawingPad)과 같은 4:3. 좌표가 폭 대비 비율이라 폭만 알면 어느 화면에서도 같은 그림이 나온다
const ASPECT = 3 / 4

/**
 * 선학습 그림판에 그려 둔 그림을 보기만 하는 판. 오답노트 상세에서 쓴다.
 * 저장된 그림이 없으면 아무것도 그리지 않는다. 고치려면 선학습에서 그 문제의 그림판을 연다
 */
export function DrawingPreview({ questionId }: { questionId: string }) {
  const strokes = useMemo(() => getQuestionDrawing(questionId)?.strokes ?? [], [questionId])
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hasInk = strokes.some((s) => !s.erase && s.points.length >= 2)

  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas || !hasInk) return
    const draw = () => {
      const width = box.clientWidth
      if (width <= 0) return
      const height = width * ASPECT
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      for (const stroke of strokes) paintStroke(ctx, stroke, width)
      ctx.globalCompositeOperation = 'source-over'
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [strokes, hasInk])

  if (!hasInk) return null
  return (
    <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1 font-medium">🎨 그림판</p>
      <div ref={boxRef} className="relative w-full select-none overflow-hidden rounded-xl border border-border bg-white">
        <div style={{ paddingTop: `${ASPECT * 100}%` }} />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  )
}
