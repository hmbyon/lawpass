'use client'

import { useEffect, useRef, useState } from 'react'
import {
  HIGHLIGHT_COLOR_HEX,
  HIGHLIGHT_COLOR_LABELS,
  HIGHLIGHT_SWATCH_CLASSES,
  UNDERLINE_COLORS,
  addBracket,
  applyHighlightStyles,
  colorsForStyles,
  loadHighlights,
  removeHighlightRun,
  saveHighlights,
  type Highlight,
  type HighlightColor,
  type HighlightStyle,
} from '@/lib/highlights'
import PenAnnotateLayer, { type BracketGesture, type PenGesture } from '@/components/pen-annotate-layer'

/**
 * 문제 지문·선지 위에 형광펜을 치는 틀. 글자를 골라 팝업에서 모양·색을 정하는 방식과,
 * 펜슬/마우스로 본문에 직접 밑줄·원·X 를 긋는 방식(펜 자동표시)을 함께 쓴다.
 *
 * 표시는 문제 id 로 저장되므로 선학습에서 친 것이 여기서도 보이고, 여기서 친 것이 선학습에서도 보인다.
 * (오답노트 상세 창에서 쓴다. 선학습 화면은 같은 동작을 자기 안에 따로 갖고 있다.)
 */

/**
 * 펜 자동표시가 켜져 있을 때 보이는 색 고르개. 펜으로 긋는 밑줄·원·X 가 이 색으로 남고,
 * 긋는 동안 보이는 임시 선도 같은 색이다. 선으로 그리는 표시라 회색까지 고를 수 있다
 */
export function PenColorPicker({ value, onChange }: { value: HighlightColor; onChange: (c: HighlightColor) => void }) {
  return (
    <div role="radiogroup" aria-label="펜 색" className="mr-auto flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">펜 색</span>
      {UNDERLINE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={HIGHLIGHT_COLOR_LABELS[c]}
          title={HIGHLIGHT_COLOR_LABELS[c]}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full border border-black/10 transition-all ${HIGHLIGHT_SWATCH_CLASSES[c]} ${
            value === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-card scale-110' : 'opacity-60 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  )
}

export const STYLE_LABELS: Record<HighlightStyle, string> = {
  fill: '형광펜',
  underline: '밑줄',
  wave: '물결',
  strike: '취소선',
  circle: '원',
  cross: 'X표시',
}

/** 색 버튼 안에 그리는 미리보기. 고른 스타일이 어떻게 보일지 그 자리에서 알려준다 */
export function StyleSwatch({ style, color }: { style: HighlightStyle; color: HighlightColor }) {
  const paint = HIGHLIGHT_SWATCH_CLASSES[color]
  if (style === 'fill') return <span className={`block w-full h-full rounded-full ${paint}`} />
  if (style === 'circle') {
    // 가운데를 카드 색으로 덮어 고리로 만든다 — 테두리 색 맵을 따로 두지 않아도 된다
    return (
      <span className={`flex w-full h-full items-center justify-center rounded-full ${paint}`}>
        <span className="block w-3 h-3 rounded-full bg-card" />
      </span>
    )
  }
  if (style === 'cross') {
    return (
      <span className="relative block w-full h-full">
        <span className={`absolute left-1/2 top-1/2 block h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full ${paint}`} />
        <span className={`absolute left-1/2 top-1/2 block h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full ${paint}`} />
      </span>
    )
  }
  if (style === 'wave') {
    // 물결: 본문 물결 밑줄과 같은 모양(16×7 곡선, 진폭 약 1.8px)
    return (
      <span className="flex w-full h-full items-end justify-center pb-0.5">
        <svg width="20" height="7" viewBox="0 0 20 7" aria-hidden className="overflow-visible">
          <path d="M0 3.5 Q2.5 0 5 3.5 T10 3.5 T15 3.5 T20 3.5" fill="none" stroke={HIGHLIGHT_COLOR_HEX[color]} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  // 밑줄과 취소선은 선의 높이만 다르다
  return (
    <span className={`flex w-full h-full justify-center ${style === 'underline' ? 'items-end pb-1' : 'items-center'}`}>
      <span className={`block h-1 w-4 rounded-full ${paint}`} />
    </span>
  )
}

// 팝업과 선택 영역 사이 간격
const POPUP_GAP = 8
const PEN_KEY = 'lawpass_pen_gesture'

function getTextOffset(container: Node, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(container)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

export interface HighlightEditorApi {
  highlights: Highlight[]
  /** 표시를 눌러 지울 때 */
  remove: (id: string) => void
  /** 글자가 들어 있는 요소에 걸어 둔다. field 는 renderHighlighted 에 넘기는 이름과 같아야 한다 */
  fieldRef: (field: string) => (el: HTMLElement | null) => void
}

interface Props {
  questionId: string
  /** 표시가 바뀐 뒤(저장 후) 부르는 콜백 */
  onChanged?: () => void
  className?: string
  children: (api: HighlightEditorApi) => React.ReactNode
}

export function HighlightEditor({ questionId, onChanged, className, children }: Props) {
  const [highlights, setHighlights] = useState<Highlight[]>(() => loadHighlights(questionId))
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

  const [popup, setPopup] = useState<{ field: string; start: number; end: number; x: number; y: number } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const popupHeightRef = useRef(88)
  const [style, setStyle] = useState<HighlightStyle>('fill')
  const lastColorRef = useRef<HighlightColor>('gray')
  // 화면에 보이는 펜 색(고르개·임시 선). 실제로 칠할 때는 lastColorRef 를 읽는다 — 둘은 항상 같이 바꾼다
  const [penColor, setPenColor] = useState<HighlightColor>('gray')
  function choosePenColor(c: HighlightColor) {
    lastColorRef.current = c
    setPenColor(c)
  }

  const [penOn, setPenOn] = useState(true)
  const [toast, setToast] = useState<{ label: string; prev: Highlight[] | null } | null>(null)

  useEffect(() => {
    setHighlights(loadHighlights(questionId))
    setPopup(null)
    setToast(null)
  }, [questionId])

  // 펜 자동표시 스위치는 선학습과 같은 값을 쓴다. 고른 적이 없으면 터치 기기만 켠다
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PEN_KEY)
      if (saved === '0' || (saved === null && navigator.maxTouchPoints === 0)) setPenOn(false)
    } catch {}
  }, [])
  function togglePen() {
    setPenOn((on) => {
      try {
        localStorage.setItem(PEN_KEY, on ? '0' : '1')
      } catch {}
      return !on
    })
  }

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(t)
  }, [toast])

  function commit(next: Highlight[]) {
    setHighlights(next)
    saveHighlights(questionId, next)
    onChanged?.()
  }

  const api: HighlightEditorApi = {
    highlights,
    remove: (id) => commit(removeHighlightRun(highlights, id)),
    fieldRef: (field) => (el) => {
      fieldRefs.current[field] = el
    },
  }

  // ── 글자 선택 → 팝업 ─────────────────────────────
  const timerRef = useRef<number | null>(null)
  const touchModeRef = useRef(false)

  function checkSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) return
    const range = sel.getRangeAt(0)
    for (const [field, el] of Object.entries(fieldRefs.current)) {
      if (!el || !el.contains(range.commonAncestorContainer)) continue
      const start = getTextOffset(el, range.startContainer, range.startOffset)
      const end = getTextOffset(el, range.endContainer, range.endOffset)
      if (end <= start) return

      const rect = range.getBoundingClientRect()
      const HALF = 140
      const h = popupHeightRef.current
      const x = Math.min(Math.max(rect.left + rect.width / 2, HALF + POPUP_GAP), window.innerWidth - HALF - POPUP_GAP)
      const above = rect.top - h - POPUP_GAP
      const below = rect.bottom + POPUP_GAP
      const fitsAbove = above >= POPUP_GAP
      const fitsBelow = below + h + POPUP_GAP <= window.innerHeight
      // 터치에서는 iOS 의 복사 메뉴가 선택 위에 뜨므로 아래를 먼저 쓴다
      let y = touchModeRef.current ? (fitsBelow ? below : fitsAbove ? above : below) : fitsAbove ? above : below
      y = Math.min(Math.max(y, POPUP_GAP), Math.max(POPUP_GAP, window.innerHeight - h - POPUP_GAP))
      setPopup({ field, start, end, x, y })
      return
    }
  }

  function schedule(delay: number) {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      checkSelection()
    }, delay)
  }

  useEffect(() => {
    function onSelectionChange() {
      if (!touchModeRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return
      schedule(300)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 팝업 바깥을 누르면 닫는다. 선택 핸들을 잡으려고 글자를 누르는 것은 바깥이 아니다
  useEffect(() => {
    if (!popup) return
    function outside(e: MouseEvent | TouchEvent) {
      const t = e.target as Node | null
      if (!t || popupRef.current?.contains(t)) return
      if (Object.values(fieldRefs.current).some((el) => el?.contains(t))) return
      setPopup(null)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
    }
  }, [popup])

  // 팝업의 실제 높이를 재서 다음 자리 계산에 쓴다
  useEffect(() => {
    if (!popup) return
    const h = popupRef.current?.getBoundingClientRect().height
    if (h && h > 0) popupHeightRef.current = h
  }, [popup])

  function applyFromPopup(color: HighlightColor) {
    if (!popup) return
    choosePenColor(color)
    const next = applyHighlightStyles(highlightsRef.current, {
      id: `h_${Date.now()}`,
      field: popup.field,
      start: popup.start,
      end: popup.end,
      color,
      styles: [style],
    })
    commit(next)
    setPopup(null)
    window.getSelection()?.removeAllRanges()
  }

  function applyPen(g: PenGesture) {
    const prev = highlightsRef.current
    const next = applyHighlightStyles(prev, {
      id: `h_${Date.now()}`,
      field: g.field,
      start: g.start,
      end: g.end,
      color: lastColorRef.current,
      styles: [g.style],
    })
    commit(next)
    setToast({ label: STYLE_LABELS[g.style], prev })
  }

  function applyPenBracket(g: BracketGesture) {
    const prev = highlightsRef.current
    const next = addBracket(prev, {
      id: `h_${Date.now()}`,
      field: g.field,
      at: g.at,
      bracket: g.bracket,
      color: lastColorRef.current,
    })
    if (next === prev) return
    commit(next)
    setToast({ label: `괄호 ${g.bracket}`, prev })
  }

  function undoPen() {
    if (!toast?.prev) return
    commit(toast.prev)
    setToast(null)
  }

  return (
    <div
      className={`relative ${className ?? ''}`}
      onMouseUp={() => {
        if (!penOn) schedule(0)
      }}
      onTouchStart={() => {
        touchModeRef.current = true
      }}
      onTouchEnd={() => schedule(80)}
    >
      <div className="mb-2 flex items-center justify-end gap-2 no-print">
        {penOn && <PenColorPicker value={penColor} onChange={choosePenColor} />}
        <button
          type="button"
          onClick={togglePen}
          aria-pressed={penOn}
          title="펜슬(또는 마우스를 누른 채)로 본문에 밑줄(—)·물결(∿)·원(○)·X 를 그으면 알아보고 표시로 남깁니다. 글자 사이에 괄호 [ ] < > ( ) 를 한 획씩 그으면 그 자리에 끼워 넣어요. 켜 두면 마우스로 끌어서 글자를 고르는 건 안 돼요"
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
            penOn
              ? 'bg-primary/15 text-primary border-primary/40'
              : 'bg-muted text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
          }`}
        >
          ✨ 펜 자동표시
        </button>
      </div>

      {children(api)}

      <PenAnnotateLayer
        enabled={penOn}
        color={HIGHLIGHT_COLOR_HEX[penColor]}
        getFieldEls={() => fieldRefs.current}
        onGesture={applyPen}
        onBracket={applyPenBracket}
        onInfo={(message) => setToast({ label: message, prev: null })}
      />

      {popup && (
        <div
          ref={popupRef}
          className="fixed z-[70] flex flex-col gap-1.5 bg-card border border-border rounded-xl shadow-lg px-2 py-2"
          style={{ left: popup.x, top: Math.max(popup.y, 8), transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-1">
            {(
              [
                ['fill', '배경'],
                ['underline', '밑줄'],
                ['wave', '물결'],
                ['strike', '취소선'],
                ['circle', '원'],
                ['cross', 'X표시'],
              ] as [HighlightStyle, string][]
            ).map(([s, label]) => (
              <button
                key={s}
                type="button"
                aria-pressed={style === s}
                onClick={() => setStyle(s)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  style === s ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPopup(null)}
              className="ml-auto text-muted-foreground hover:text-foreground text-xs px-1"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {colorsForStyles([style]).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => applyFromPopup(color)}
                title={`${HIGHLIGHT_COLOR_LABELS[color]} ${STYLE_LABELS[style]}`}
                className="w-6 h-6 rounded-full border border-black/10 hover:scale-110 transition-transform"
              >
                <StyleSwatch style={style} color={color} />
              </button>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-xs shadow-lg backdrop-blur">
          <span className="text-foreground">{toast.prev ? `${toast.label} 표시함` : toast.label}</span>
          {toast.prev && (
            <button type="button" onClick={undoPen} className="font-medium text-primary hover:underline">
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
