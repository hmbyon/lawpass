import React from 'react'
import type { BracketChar } from './penGesture'

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'orange' | 'red' | 'gray'

// 'fill' = 배경 칠하기(기존 형광펜), 'underline' = 밑줄만,
// 'strike' = 취소선, 'circle' = 동그라미, 'cross' = X표시
// 옛 데이터에는 이 필드가 없으므로 undefined는 'fill'로 취급한다
export type HighlightStyle = 'fill' | 'underline' | 'strike' | 'circle' | 'cross'

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'pink', 'blue', 'purple', 'orange', 'red']

// 선으로 그리는 스타일에서만 회색을 추가로 제공한다 (배경 채우기로는 잘 보이지 않는 색)
export const UNDERLINE_COLORS: HighlightColor[] = [...HIGHLIGHT_COLORS, 'gray']

export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '노랑',
  green: '초록',
  pink: '핑크',
  blue: '파랑',
  purple: '보라',
  orange: '주황',
  red: '빨강',
  gray: '회색',
}

export interface Highlight {
  id: string
  field: string
  start: number
  end: number
  color: HighlightColor
  style?: HighlightStyle // 옛 데이터의 단일 스타일. 새로 칠하는 것은 styles 에 적는다
  // 한 구간에 겹쳐 적용한 스타일들(형광펜+밑줄 등). 색은 위의 color 하나를 함께 쓴다.
  // 옛 데이터에는 없으므로 읽을 때는 반드시 stylesOf() 를 거친다
  styles?: HighlightStyle[]
  // 스타일마다 따로 고른 색. 밑줄은 빨강, 형광펜은 노랑처럼 같은 구간에 겹쳐 둘 때 각자의 색을
  // 지키려는 것이다. 여기 없는 스타일은 위의 color 를 쓴다(옛 데이터는 이 필드가 없다)
  colors?: Partial<Record<HighlightStyle, HighlightColor>>
  // 글자 사이에 끼운 괄호([ ] < >). 구간이 아니라 자리라서 start === end 이고, 위의 스타일·색 규칙과 무관하다
  // (색만 color 를 쓴다). 구간을 다루는 함수들은 start < end 인 것만 보므로 이 항목을 건드리지 않는다
  bracket?: BracketChar
}

export const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/70 dark:bg-yellow-500/40',
  green: 'bg-emerald-300/70 dark:bg-emerald-500/40',
  pink: 'bg-pink-300/70 dark:bg-pink-500/40',
  blue: 'bg-blue-300/70 dark:bg-blue-500/40',
  purple: 'bg-purple-300/70 dark:bg-purple-500/40',
  orange: 'bg-orange-300/70 dark:bg-orange-500/40',
  red: 'bg-red-300/70 dark:bg-red-500/40',
  gray: 'bg-gray-300/70 dark:bg-gray-500/40',
}

// 아래 네 맵(밑줄·취소선·원·X표시)은 '장식만' 담는다. 배경색은 여기 두지 않고
// highlightClassName 이 한 번만 정한다 — 형광펜과 함께 켜면 형광펜 배경색이, 아니면
// bg-transparent 가 붙는다. 맵마다 bg-transparent 를 박아두면 형광펜 배경색과 같은 속성을
// 두고 다투는데, Tailwind 는 클래스를 적은 순서가 아니라 스타일시트 순서로 이겨서 결과를
// 예측할 수 없다.
//
// 밑줄: 아래 테두리(border-b)는 글자 상자(내려긋는 획 자리까지 포함) '바깥'에 그려져서
// 한글처럼 내려긋는 획이 적은 글자 밑에서는 선이 글자와 한참 떨어져 보인다.
// 그래서 기본은 배경 그라디언트로 2px 선을 그리고, 글자 상자 아래에서 0.08em 올려 붙인다.
// 위치를 em 으로 둬서 지문(text-sm)과 선지 해설(text-xs)에서 모두 비슷하게 붙는다.
// 선 위치(0.08em)·두께(2px)를 바꾸고 싶으면 아래 UL 한 곳만 고치면 된다.
//
// 배경 그라디언트는 X표시(HIGHLIGHT_CROSS_CLASSES)와 같은 background-image 를 쓰므로 둘이 함께 켜지면
// 한쪽이 가려진다. 그 조합에서는 예전 테두리 밑줄(HIGHLIGHT_UNDERLINE_BORDER_CLASSES)로 돌아간다.
// text-decoration 을 안 쓰는 이유는 지우개 hover의 line-through/decoration과 충돌하고,
// 취소선과 함께 켰을 때 같은 속성을 두고 다투기 때문이다
// (Tailwind 는 소스에 글자 그대로 적힌 클래스만 만든다. 값을 변수로 끼워 넣으면 CSS 가 생기지 않는다)
const UL = 'bg-no-repeat bg-[length:100%_2px] bg-[position:0_calc(100%_-_0.08em)]'
export const HIGHLIGHT_UNDERLINE_BORDER_CLASSES: Record<HighlightColor, string> = {
  yellow: 'border-b-2 border-yellow-500 dark:border-yellow-400',
  green: 'border-b-2 border-emerald-500 dark:border-emerald-400',
  pink: 'border-b-2 border-pink-500 dark:border-pink-400',
  blue: 'border-b-2 border-blue-500 dark:border-blue-400',
  purple: 'border-b-2 border-purple-500 dark:border-purple-400',
  orange: 'border-b-2 border-orange-500 dark:border-orange-400',
  red: 'border-b-2 border-red-500 dark:border-red-400',
  gray: 'border-b-2 border-gray-500 dark:border-gray-400',
}

export const HIGHLIGHT_UNDERLINE_CLASSES: Record<HighlightColor, string> = {
  yellow: `bg-[linear-gradient(#eab308,#eab308)] dark:bg-[linear-gradient(#facc15,#facc15)] ${UL}`,
  green: `bg-[linear-gradient(#10b981,#10b981)] dark:bg-[linear-gradient(#34d399,#34d399)] ${UL}`,
  pink: `bg-[linear-gradient(#ec4899,#ec4899)] dark:bg-[linear-gradient(#f472b6,#f472b6)] ${UL}`,
  blue: `bg-[linear-gradient(#3b82f6,#3b82f6)] dark:bg-[linear-gradient(#60a5fa,#60a5fa)] ${UL}`,
  purple: `bg-[linear-gradient(#a855f7,#a855f7)] dark:bg-[linear-gradient(#c084fc,#c084fc)] ${UL}`,
  orange: `bg-[linear-gradient(#f97316,#f97316)] dark:bg-[linear-gradient(#fb923c,#fb923c)] ${UL}`,
  red: `bg-[linear-gradient(#ef4444,#ef4444)] dark:bg-[linear-gradient(#f87171,#f87171)] ${UL}`,
  gray: `bg-[linear-gradient(#6b7280,#6b7280)] dark:bg-[linear-gradient(#9ca3af,#9ca3af)] ${UL}`,
}

// 취소선: 밑줄과 달리 text-decoration 을 그대로 쓴다. 지우개 hover 가 line-through 를
// 신호로 쓰고 있어 겹치는데, 그건 renderHighlighted 에서 이 스타일만 다른 신호로 바꾼다
export const HIGHLIGHT_STRIKE_CLASSES: Record<HighlightColor, string> = {
  yellow: 'line-through decoration-2 decoration-yellow-500 dark:decoration-yellow-400',
  green: 'line-through decoration-2 decoration-emerald-500 dark:decoration-emerald-400',
  pink: 'line-through decoration-2 decoration-pink-500 dark:decoration-pink-400',
  blue: 'line-through decoration-2 decoration-blue-500 dark:decoration-blue-400',
  purple: 'line-through decoration-2 decoration-purple-500 dark:decoration-purple-400',
  orange: 'line-through decoration-2 decoration-orange-500 dark:decoration-orange-400',
  red: 'line-through decoration-2 decoration-red-500 dark:decoration-red-400',
  gray: 'line-through decoration-2 decoration-gray-500 dark:decoration-gray-400',
}

// 동그라미: 여러 줄에 걸치면 box-decoration-clone 이 줄마다 온전한 상자를 그린다.
// 그게 없으면 첫 줄 왼쪽과 마지막 줄 오른쪽에만 테두리가 붙어 반쪽짜리가 된다
export const HIGHLIGHT_CIRCLE_CLASSES: Record<HighlightColor, string> = {
  yellow: 'border-2 border-yellow-500 dark:border-yellow-400',
  green: 'border-2 border-emerald-500 dark:border-emerald-400',
  pink: 'border-2 border-pink-500 dark:border-pink-400',
  blue: 'border-2 border-blue-500 dark:border-blue-400',
  purple: 'border-2 border-purple-500 dark:border-purple-400',
  orange: 'border-2 border-orange-500 dark:border-orange-400',
  red: 'border-2 border-red-500 dark:border-red-400',
  gray: 'border-2 border-gray-500 dark:border-gray-400',
}

// X표시: 대각선 두 줄을 겹쳐 ×를 만든다. 한 줄만 그으면 취소선과 구별되지 않는다.
// 그라디언트는 인라인 조각마다 각각 칠해지므로 여러 줄에 걸치면 줄마다 ×가 하나씩 생긴다 —
// 다만 범위가 길수록 대각선이 완만해져 ×보다 리본에 가까워진다. 한 문장 안에서 쓰는 표시다.
//
// 그라디언트는 background-image 라 형광펜의 background-color 와 실제로는 겹치지 않지만,
// 다른 장식과 같은 규칙으로 배경색은 빼고 둔다. 형광펜 없이 쓸 때 <mark> 의 브라우저 기본
// 배경(노랑)이 비치지 않도록 bg-transparent 를 붙이는 일은 highlightClassName 이 한다.
// 색을 임의 값으로 박는 자리라 Tailwind 팔레트의 500 색상값을 그대로 적는다
export const HIGHLIGHT_CROSS_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-[linear-gradient(to_top_right,transparent_47%,#eab308_47%,#eab308_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#eab308_47%,#eab308_53%,transparent_53%)]',
  green: 'bg-[linear-gradient(to_top_right,transparent_47%,#10b981_47%,#10b981_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#10b981_47%,#10b981_53%,transparent_53%)]',
  pink: 'bg-[linear-gradient(to_top_right,transparent_47%,#ec4899_47%,#ec4899_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#ec4899_47%,#ec4899_53%,transparent_53%)]',
  blue: 'bg-[linear-gradient(to_top_right,transparent_47%,#3b82f6_47%,#3b82f6_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#3b82f6_47%,#3b82f6_53%,transparent_53%)]',
  purple: 'bg-[linear-gradient(to_top_right,transparent_47%,#a855f7_47%,#a855f7_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#a855f7_47%,#a855f7_53%,transparent_53%)]',
  orange: 'bg-[linear-gradient(to_top_right,transparent_47%,#f97316_47%,#f97316_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#f97316_47%,#f97316_53%,transparent_53%)]',
  red: 'bg-[linear-gradient(to_top_right,transparent_47%,#ef4444_47%,#ef4444_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#ef4444_47%,#ef4444_53%,transparent_53%)]',
  gray: 'bg-[linear-gradient(to_top_right,transparent_47%,#6b7280_47%,#6b7280_53%,transparent_53%),linear-gradient(to_bottom_right,transparent_47%,#6b7280_47%,#6b7280_53%,transparent_53%)]',
}

// 색과 무관한 모양. 여기서 한 번만 정해야 rounded-sm 과 원의 반경이 같은 요소에
// 함께 실려 어느 쪽이 이길지 CSS 순서에 맡기는 일이 없다.
//
// 원은 rounded-full(무한대 반경)이 아니라 50% 다. 무한대 반경은 위아래가 곧고 양끝만
// 둥근 알약이 되는데, 손으로 친 동그라미는 그렇게 생기지 않았다. 50% 는 가로·세로
// 반지름을 각각 절반으로 잡아 상자에 꼭 맞는 타원이 되고, 글자가 길어지면 그만큼
// 납작한 타원으로 저절로 늘어난다.
//
// 여백은 px 이 아니라 em 이다. 지문(text-sm)과 선지 해설(text-xs)의 글자 크기가 달라,
// 고정 픽셀로 두면 작은 글씨에서만 헐렁해진다.
//
// 세로 여백이 타원이 글자를 얼마나 품는지를 정한다. 타원은 네 귀퉁이를 잘라내므로
// 여백이 작을수록 글자 윗변의 양끝이 밖으로 나온다. 키우면 더 품지만 위아래 줄과 멀어져 헐렁해 보인다.
// 글자 상자 자체가 글자보다 위아래로 넉넉해서 0.25em 은 헐렁했다 — 지금은 0.05em, 좌우는 0.3em 이다
const SHAPE_DEFAULT = 'rounded-sm'
const SHAPE_CIRCLE = 'rounded-[50%] px-[0.3em] py-[0.05em] box-decoration-clone'

// 형광펜(fill)은 배경이라 장식 목록에 없다
const DECORATION_CLASSES: Record<Exclude<HighlightStyle, 'fill'>, Record<HighlightColor, string>> = {
  underline: HIGHLIGHT_UNDERLINE_CLASSES,
  strike: HIGHLIGHT_STRIKE_CLASSES,
  circle: HIGHLIGHT_CIRCLE_CLASSES,
  cross: HIGHLIGHT_CROSS_CLASSES,
}

// 저장·표시 순서. 누른 순서와 무관하게 같은 조합은 같은 배열이 된다
const STYLE_ORDER: HighlightStyle[] = ['fill', 'underline', 'strike', 'circle', 'cross']

/** 모르는 값을 걸러 순서대로 정리한다. 남는 것이 없으면 옛 기본값인 형광펜이다 */
function normalizeStyles(styles: readonly (HighlightStyle | undefined)[]): HighlightStyle[] {
  const picked = STYLE_ORDER.filter((s) => styles.includes(s))
  return picked.length > 0 ? picked : ['fill']
}

/**
 * 하이라이트에 적용된 스타일들. 옛 데이터는 styles 가 없고 style 하나만(또는 그것도 없이) 있다.
 * 스타일을 읽는 곳은 모두 이것을 거친다
 */
export function stylesOf(h: Highlight): HighlightStyle[] {
  return normalizeStyles(h.styles && h.styles.length > 0 ? h.styles : [h.style ?? 'fill'])
}

/** 고를 수 있는 색. 선으로 그리는 스타일이 하나라도 켜져 있으면 회색도 보인다 */
export function colorsForStyles(styles: readonly HighlightStyle[]): HighlightColor[] {
  return styles.some((s) => s !== 'fill') ? UNDERLINE_COLORS : HIGHLIGHT_COLORS
}

/**
 * 모양·배경·장식을 따로 정해 합친다. 같은 CSS 속성을 두 클래스가 다투지 않게 하려는 것이다.
 *  - 모양: 원이 있으면 원, 없으면 rounded-sm
 *  - 배경: 형광펜이 있으면 그 색, 없으면 bg-transparent (<mark> 기본 노랑을 지운다)
 *  - 장식: 형광펜을 뺀 나머지 스타일의 선·테두리·그라디언트
 * 원과 X표시처럼 모양이 어울리지 않는 조합도 깨지지만 않으면 그대로 둔다
 */
export function highlightClassName(
  styles: readonly HighlightStyle[],
  color: HighlightColor,
  colors?: Partial<Record<HighlightStyle, HighlightColor>>
): string {
  const s = normalizeStyles(styles)
  const colorOf = (style: HighlightStyle): HighlightColor => colors?.[style] ?? color
  // 밑줄은 아래 테두리라, 모서리가 둥글면 양끝이 위로 말려 올라간다. 밑줄이 있으면(원이 아닐 때)
  // 모서리를 각지게 둔다
  const shape = s.includes('circle') ? SHAPE_CIRCLE : s.includes('underline') ? 'rounded-none' : SHAPE_DEFAULT
  const background = s.includes('fill') ? HIGHLIGHT_CLASSES[colorOf('fill')] : 'bg-transparent'
  const decorations = s
    .filter((x): x is Exclude<HighlightStyle, 'fill'> => x !== 'fill')
    .map((x) =>
      // 밑줄(배경 그라디언트)은 X표시와 같은 background-image 를 쓰므로 함께 있으면 테두리 밑줄로 돌아간다
      x === 'underline' && s.includes('cross')
        ? HIGHLIGHT_UNDERLINE_BORDER_CLASSES[colorOf(x)]
        : DECORATION_CLASSES[x][colorOf(x)]
    )
  return [shape, background, ...decorations].join(' ')
}

/** 하이라이트에서 그 스타일이 쓰는 색 */
function colorOfStyle(h: Highlight, style: HighlightStyle): HighlightColor {
  return h.colors?.[style] ?? h.color
}

// 캔버스(펜 자동표시의 임시 선)처럼 클래스를 못 쓰는 곳에서 쓰는 색값. 위 장식 클래스들의 500 색과 같다
export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: '#eab308',
  green: '#10b981',
  pink: '#ec4899',
  blue: '#3b82f6',
  purple: '#a855f7',
  orange: '#f97316',
  red: '#ef4444',
  gray: '#6b7280',
}

export const HIGHLIGHT_SWATCH_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-400',
  pink: 'bg-pink-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  orange: 'bg-orange-400',
  red: 'bg-red-400',
  gray: 'bg-gray-400',
}

export function highlightsKey(questionId: string) {
  return `lawpass_highlights_${questionId}`
}

export function loadHighlights(questionId: string): Highlight[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(highlightsKey(questionId))
    return raw ? (JSON.parse(raw) as Highlight[]) : []
  } catch {
    return []
  }
}

export function saveHighlights(questionId: string, highlights: Highlight[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(highlightsKey(questionId), JSON.stringify(highlights))
    // 기기 사이에서 어느 쪽이 최신인지 가리는 기준. 모두 지운 것(빈 배열)도 '지웠다'는 기록으로 남는다
    localStorage.setItem(highlightsStampKey(questionId), String(Date.now()))
  } catch (e) {
    console.error('[highlights] 저장 실패', e)
    return
  }
  // 클라우드 동기화가 듣는다(app-shell). 이 파일은 동기화를 모른다
  window.dispatchEvent(new Event(HIGHLIGHTS_CHANGED_EVENT))
}

export const HIGHLIGHTS_CHANGED_EVENT = 'lawpass:highlights-changed'

// 저장 시각. 접두어가 'lawpass' 로 시작해야 계정을 바꿀 때 함께 지워진다
export function highlightsStampKey(questionId: string) {
  return `lawpass_hlstamp_${questionId}`
}

/** 한 문제의 표시 묶음. 기기 사이에서 문제 단위로 주고받는다 */
export interface HighlightRecord {
  id: string // 문제 id
  highlights: Highlight[]
  updatedAt: number
}

/**
 * 이 기기에 있는 모든 문제의 표시.
 *
 * 저장 시각이 없는 옛 표시(이 기능 전에 쳤거나 올린 적 없는 것)는 지금 시각을 찍어 준다 —
 * 그래야 처음 동기화할 때 다른 기기로 퍼지고, 시각 없는 쪽이 늘 지는 일이 없다
 */
export function listHighlightRecords(): HighlightRecord[] {
  if (typeof window === 'undefined') return []
  const out: HighlightRecord[] = []
  const prefix = 'lawpass_highlights_'
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue
      const id = key.slice(prefix.length)
      let highlights: Highlight[]
      try {
        highlights = JSON.parse(localStorage.getItem(key) ?? '[]') as Highlight[]
      } catch {
        continue
      }
      let stamp = Number(localStorage.getItem(highlightsStampKey(id)))
      if (!Number.isFinite(stamp) || stamp <= 0) {
        if (highlights.length === 0) continue // 시각도 내용도 없으면 보낼 것이 없다
        stamp = Date.now()
        localStorage.setItem(highlightsStampKey(id), String(stamp))
      }
      out.push({ id, highlights, updatedAt: stamp })
    }
  } catch (e) {
    console.error('[highlights] 목록 읽기 실패', e)
  }
  return out
}

/** 다른 기기에서 받은 표시를 이 기기에 쓴다. 동기화 이벤트는 내지 않는다(받은 것을 다시 올릴 이유가 없다) */
export function writeHighlightRecords(records: HighlightRecord[]) {
  if (typeof window === 'undefined') return
  for (const r of records) {
    try {
      localStorage.setItem(highlightsKey(r.id), JSON.stringify(r.highlights))
      localStorage.setItem(highlightsStampKey(r.id), String(r.updatedAt))
    } catch (e) {
      console.error('[highlights] 받은 표시 저장 실패', e)
    }
  }
}

/**
 * 문제마다 저장 시각이 더 늦은 쪽을 남긴다. 같으면 이 기기 것.
 * fromRemote: 이 기기에 새로 써야 할 것(원격이 이긴 것), toRemote: 원격에 올려야 하는지
 */
export function mergeHighlightRecords(
  local: HighlightRecord[],
  remote: HighlightRecord[] | null
): { merged: HighlightRecord[]; fromRemote: HighlightRecord[]; toRemote: boolean } {
  const theirs = new Map((remote ?? []).map((r) => [r.id, r]))
  const mine = new Map(local.map((r) => [r.id, r]))
  const merged: HighlightRecord[] = []
  const fromRemote: HighlightRecord[] = []
  let toRemote = false

  for (const r of local) {
    const t = theirs.get(r.id)
    if (!t) {
      merged.push(r)
      toRemote = true
    } else if (t.updatedAt > r.updatedAt) {
      merged.push(t)
      fromRemote.push(t)
    } else {
      merged.push(r)
      if (r.updatedAt > t.updatedAt) toRemote = true
    }
  }
  for (const t of remote ?? []) {
    if (mine.has(t.id)) continue
    merged.push(t)
    fromRemote.push(t)
  }
  return { merged, fromRemote, toRemote }
}

/**
 * 글자 사이(at)에 괄호를 끼운다. 같은 자리에 같은 괄호가 이미 있으면 그대로 둔다.
 * at 은 텍스트 오프셋으로, at 번째 글자 바로 앞이다(0 이면 맨 앞, 글자 수와 같으면 맨 뒤)
 */
export function addBracket(
  highlights: Highlight[],
  target: { id: string; field: string; at: number; bracket: BracketChar; color: HighlightColor }
): Highlight[] {
  const { id, field, at, bracket, color } = target
  if (highlights.some((h) => h.field === field && h.bracket === bracket && h.start === at && h.end === at)) return highlights
  return [...highlights, { id, field, start: at, end: at, color, bracket }]
}

/** 같은 필드에서 [start,end) 와 겹치는 하이라이트를 뺀다. keepId 는 남긴다 */
export function withoutOverlaps(
  highlights: Highlight[],
  field: string,
  start: number,
  end: number,
  keepId?: string
) {
  return highlights.filter((h) => h.id === keepId || h.field !== field || h.end <= start || h.start >= end)
}

/**
 * 새로 칠한 구간을 반영한 목록을 돌려준다.
 *
 * 하이라이트끼리는 겹치지 않게 늘 구간을 쪼개 둔다(그래서 그리는 쪽은 겹침을 신경 쓰지 않는다).
 * 새 구간과 겹치는 기존 하이라이트는 경계에서 잘라, 겹친 조각에는 새 스타일을 **더하고** 바깥
 * 조각은 그대로 둔다. 그래서 밑줄을 친 자리에 형광펜을 쳐도 밑줄이 남고, 구간이 정확히 같지
 * 않아도 마찬가지다. 기존 하이라이트가 없던 자리는 새 스타일만 가진 조각이 된다.
 *
 * 같은 종류를 같은 자리에 다시 치면 아무것도 바꾸지 않는다(색도 먼저 칠한 것이 남는다).
 * 스타일마다 색을 따로 쥐므로 밑줄(빨강)과 형광펜(노랑)이 각자의 색으로 겹친다.
 * 이어 붙은 조각이 같은 모양이면 하나로 다시 합친다 — 지우개로 누르면 조각 하나가 아니라
 * 눈에 보이는 한 덩어리가 지워진다
 */
export function applyHighlightStyles(
  highlights: Highlight[],
  target: { id: string; field: string; start: number; end: number; color: HighlightColor; styles: readonly HighlightStyle[] }
): Highlight[] {
  const { id, field, start, end, color } = target
  if (!(start < end)) return highlights
  const addStyles = normalizeStyles(target.styles)

  let seq = 0
  const nextId = () => `${id}_${seq++}`

  /** 조각 하나. 스타일별 색은 모두 풀어서 담는다 */
  const piece = (
    from: Highlight | null,
    s: number,
    e: number,
    styles: HighlightStyle[],
    colors: Partial<Record<HighlightStyle, HighlightColor>>
  ): Highlight => ({
    id: from && seq === 0 && s === from.start ? from.id : nextId(),
    field,
    start: s,
    end: e,
    color: colors[styles[0]] ?? color,
    styles,
    colors,
  })

  const colorsOf = (h: Highlight, styles: HighlightStyle[]) => {
    const out: Partial<Record<HighlightStyle, HighlightColor>> = {}
    for (const st of styles) out[st] = colorOfStyle(h, st)
    return out
  }

  // 괄호(start === end)는 구간이 아니라 그대로 남긴다
  const others = highlights.filter((h) => h.field !== field || h.start >= h.end)
  const mine = highlights
    .filter((h) => h.field === field && h.start < h.end)
    .sort((a, b) => a.start - b.start)

  const result: Highlight[] = []
  // 새 구간 안에서 기존 하이라이트가 덮은 자리. 덮이지 않은 자리는 아래에서 새로 채운다
  const covered: [number, number][] = []

  for (const h of mine) {
    if (h.end <= start || h.start >= end) {
      result.push(h)
      continue
    }
    const hStyles = stylesOf(h)
    if (h.start < start) result.push(piece(h, h.start, start, hStyles, colorsOf(h, hStyles)))
    const ms = Math.max(h.start, start)
    const me = Math.min(h.end, end)
    // 겹친 조각: 이미 있는 스타일은 그대로(색 포함), 없는 스타일만 이번 색으로 더한다
    const merged = normalizeStyles([...hStyles, ...addStyles])
    const colors = colorsOf(h, hStyles)
    for (const st of addStyles) if (!hStyles.includes(st)) colors[st] = color
    result.push(piece(h, ms, me, merged, colors))
    covered.push([ms, me])
    if (h.end > end) result.push(piece(h, end, h.end, hStyles, colorsOf(h, hStyles)))
  }

  // 새 구간 중 기존 하이라이트가 없던 자리
  let cursor = start
  for (const [cs, ce] of covered.sort((a, b) => a[0] - b[0])) {
    if (cs > cursor) result.push(piece(null, cursor, cs, addStyles, Object.fromEntries(addStyles.map((st) => [st, color]))))
    cursor = Math.max(cursor, ce)
  }
  if (cursor < end) result.push(piece(null, cursor, end, addStyles, Object.fromEntries(addStyles.map((st) => [st, color]))))

  // 이어 붙은 조각이 같은 모양이면 합친다
  result.sort((a, b) => a.start - b.start)
  return [...others, ...coalesceTouching(result)]
}

/** 시작 순으로 정렬된 같은 필드의 조각 중, 맞닿아 있고 스타일·색이 같은 것을 하나로 합친다 */
function coalesceTouching(sorted: Highlight[]): Highlight[] {
  const same = (a: Highlight, b: Highlight) => {
    const sa = stylesOf(a)
    const sb = stylesOf(b)
    return sa.length === sb.length && sa.every((st, i) => st === sb[i] && colorOfStyle(a, st) === colorOfStyle(b, st))
  }
  const out: Highlight[] = []
  for (const h of sorted) {
    const last = out[out.length - 1]
    if (last && last.end === h.start && same(last, h)) {
      out[out.length - 1] = { ...last, end: h.end }
    } else {
      out.push(h)
    }
  }
  return out
}

/**
 * 같은 스타일·같은 색으로 이어진 조각들(맞닿은 것만). 한 번 그은 밑줄이 중간에 다른 표시(형광펜 등)와 겹쳐
 * 조각으로 나뉘어 있어도, 눈에는 한 줄로 보이는 그 전체다. fieldList 는 같은 필드의 조각을 시작 순으로 둔 것
 */
function runOfStyle(fieldList: Highlight[], from: Highlight, style: HighlightStyle): Highlight[] {
  const color = colorOfStyle(from, style)
  const has = (h: Highlight) => stylesOf(h).includes(style) && colorOfStyle(h, style) === color
  const i = fieldList.indexOf(from)
  let a = i
  let b = i
  while (a > 0 && fieldList[a - 1].end === fieldList[a].start && has(fieldList[a - 1])) a--
  while (b < fieldList.length - 1 && fieldList[b].end === fieldList[b + 1].start && has(fieldList[b + 1])) b++
  return fieldList.slice(a, b + 1)
}

function fieldListOf(highlights: Highlight[], field: string): Highlight[] {
  return highlights.filter((h) => h.field === field && h.start < h.end).sort((a, b) => a.start - b.start)
}

/**
 * 지우개로 누른 표시를 지운다. 누른 조각에 있는 스타일마다, 그 스타일이 이어진 구간 **전체**에서 뺀다.
 * 예) 밑줄이 중간에 형광펜과 겹쳐 세 조각으로 나뉘어 있어도 밑줄을 누르면 밑줄 전체가 지워지고,
 * 겹쳐 있던 형광펜은 남는다. 누른 조각에 스타일이 여럿이면 그 스타일들이 모두 지워진다(예전과 같다).
 * 모르는 id 면 그대로 돌려준다
 */
export function removeHighlightRun(highlights: Highlight[], id: string): Highlight[] {
  const target = highlights.find((h) => h.id === id)
  if (!target) return highlights
  const list = fieldListOf(highlights, target.field)
  const pos = list.indexOf(target)
  if (pos < 0) return highlights.filter((h) => h.id !== id)

  // 지울 (조각 id, 스타일) 쌍
  const strip = new Map<string, Set<HighlightStyle>>()
  for (const st of stylesOf(target)) {
    for (const seg of runOfStyle(list, target, st)) {
      const set = strip.get(seg.id) ?? new Set<HighlightStyle>()
      set.add(st)
      strip.set(seg.id, set)
    }
  }

  const others = highlights.filter((h) => h.field !== target.field || h.start >= h.end)
  const kept: Highlight[] = []
  for (const h of list) {
    const gone = strip.get(h.id)
    if (!gone) {
      kept.push(h)
      continue
    }
    const left = stylesOf(h).filter((st) => !gone.has(st))
    if (left.length === 0) continue
    const colors: Partial<Record<HighlightStyle, HighlightColor>> = {}
    for (const st of left) colors[st] = colorOfStyle(h, st)
    kept.push({ ...h, styles: left, style: undefined, colors, color: colors[left[0]] ?? h.color })
  }
  return [...others, ...coalesceTouching(kept)]
}

/** 지우개로 눌렀을 때 함께 지워지는 조각들을 묶는 이름표. 같은 이름표를 가진 조각이 한 덩어리다 */
function runKeys(fieldList: Highlight[], h: Highlight): string {
  return stylesOf(h)
    .map((st) => `${h.field}:${st}:${runOfStyle(fieldList, h, st)[0].start}`)
    .join(' ')
}

// 🧹 빨간색 지우개 커서 SVG
const ERASER_CURSOR_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m7 21-4-3 8.5-8.5a2.12 2.12 0 0 1 3 0l3.5 3.5a2.12 2.12 0 0 1 0 3L9 21'/><path d='m11 7 3 3'/><path d='m19 21-4 0'/></svg>`

// 원본 PDF에서 밑줄로 강조돼 있던 구간 (text 기준 오프셋)
export interface BoldRange {
  start: number
  end: number
}

// 주어진 구간의 텍스트에 볼드 범위를 적용한다.
// absStart는 이 조각이 전체 text에서 시작하는 위치 (하이라이트로 잘린 조각도 정확히 매핑하기 위함)
function applyBold(
  slice: string,
  absStart: number,
  bolds: BoldRange[],
  keyPrefix: string
): React.ReactNode {
  if (bolds.length === 0 || !slice) return slice
  const absEnd = absStart + slice.length
  const overlapping = bolds
    .filter((b) => b.end > absStart && b.start < absEnd)
    .sort((a, b) => a.start - b.start)
  if (overlapping.length === 0) return slice

  const nodes: React.ReactNode[] = []
  let cursor = absStart
  for (const b of overlapping) {
    const start = Math.max(b.start, absStart)
    const end = Math.min(b.end, absEnd)
    if (start > cursor) nodes.push(slice.slice(cursor - absStart, start - absStart))
    nodes.push(
      <strong key={`${keyPrefix}_b${start}`} className="font-bold">
        {slice.slice(start - absStart, end - absStart)}
      </strong>
    )
    cursor = Math.max(cursor, end)
  }
  if (cursor < absEnd) nodes.push(slice.slice(cursor - absStart))
  return nodes
}

/**
 * 지우개 hover 신호.
 *
 * 기본은 빨간 취소선인데, 이미 취소선이 그어진 스타일(취소선이 켜진 하이라이트)에는 그어봐야 달라지는 것이
 * 없어 지워질 것이라는 신호가 되지 못한다. 그쪽은 흐려지는 것으로 알린다.
 * X표시는 대각선만 있어 가로줄이 겹쳐도 구별된다 — 기본 신호를 그대로 쓴다
 */
function eraserHoverClass(styles: readonly HighlightStyle[]): string {
  return styles.includes('strike')
    ? 'hover:bg-red-500/30 hover:opacity-40'
    : 'hover:bg-red-500/30 hover:line-through hover:decoration-red-500 hover:decoration-2'
}

/**
 * 마우스를 올린 조각과 함께 지워질 조각들에 data-erasing 을 달아 같이 붉게 보이게 한다(globals.css).
 * 한 조각만 붉어지면 눌렀을 때 더 많이 지워지는 것을 알 수 없다. keys 가 빈 문자열이면 모두 푼다
 */
function markErasing(keys: string) {
  if (typeof document === 'undefined') return
  document.querySelectorAll('mark[data-erasing]').forEach((el) => el.removeAttribute('data-erasing'))
  for (const key of keys.split(' ').filter(Boolean)) {
    document.querySelectorAll('mark[data-hl-run]').forEach((el) => {
      if ((el.getAttribute('data-hl-run') ?? '').split(' ').includes(key)) el.setAttribute('data-erasing', '')
    })
  }
}

// X표시를 위에 얹는 층에 쓰는 그라디언트. 색값은 HIGHLIGHT_CROSS_CLASSES 와 같다(Tailwind 500)
const CROSS_HEX: Record<HighlightColor, string> = {
  yellow: '#eab308',
  green: '#10b981',
  pink: '#ec4899',
  blue: '#3b82f6',
  purple: '#a855f7',
  orange: '#f97316',
  red: '#ef4444',
  gray: '#6b7280',
}
function crossGradient(color: HighlightColor): string {
  const c = CROSS_HEX[color]
  return (
    `linear-gradient(to top right, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%), ` +
    `linear-gradient(to bottom right, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%)`
  )
}

/**
 * 글자 사이에 끼운 괄호를 그린다. 괄호는 텍스트 노드가 아니라 ::before 의 내용이다(globals.css .hl-bracket) —
 * 글자 위치를 재는 코드(펜 인식, 글자 선택)가 텍스트 노드 길이로 오프셋을 세므로, 글자를 끼우면 오프셋이 어긋난다.
 * 이 조각이 맡는 자리는 [absStart, absEnd). 맨 뒤 조각만 글자 수와 같은 자리(includeEnd)도 맡는다
 */
function withBrackets(
  slice: string,
  absStart: number,
  bolds: BoldRange[],
  field: string,
  brackets: Highlight[],
  includeEnd: boolean,
  onRemove?: (id: string) => void
): React.ReactNode {
  const absEnd = absStart + slice.length
  const inside = brackets
    .filter((b) => b.start >= absStart && (b.start < absEnd || (includeEnd && b.start >= absEnd)))
    .sort((a, b) => a.start - b.start)
  if (inside.length === 0) return applyBold(slice, absStart, bolds, field)

  const nodes: React.ReactNode[] = []
  let cursor = absStart
  for (const b of inside) {
    const at = Math.min(b.start, absEnd)
    if (at > cursor) nodes.push(applyBold(slice.slice(cursor - absStart, at - absStart), cursor, bolds, field))
    nodes.push(
      <span
        key={`${field}_br_${b.id}`}
        className="hl-bracket"
        data-bracket={b.bracket}
        data-erasable={onRemove ? '' : undefined}
        aria-hidden
        style={{
          color: HIGHLIGHT_COLOR_HEX[b.color],
          cursor: onRemove ? `url("${ERASER_CURSOR_SVG}") 4 20, pointer` : 'default',
        }}
        title={onRemove ? '클릭하면 지워집니다 (지우개)' : undefined}
        onClick={
          onRemove
            ? (e) => {
                e.stopPropagation()
                onRemove(b.id)
              }
            : undefined
        }
      />
    )
    cursor = Math.max(cursor, at)
  }
  if (cursor < absEnd) nodes.push(applyBold(slice.slice(cursor - absStart), cursor, bolds, field))
  return nodes
}

export function renderHighlighted(
  text: string,
  field: string,
  highlights: Highlight[],
  onRemove?: (id: string) => void,
  bolds: BoldRange[] = []
) {
  const fieldHighlights = highlights
    .filter((h) => h.field === field && h.start < h.end && h.end <= text.length)
    .sort((a, b) => a.start - b.start)
  const brackets = highlights.filter((h) => h.field === field && h.bracket && h.start === h.end && h.start <= text.length)

  if (fieldHighlights.length === 0) return withBrackets(text, 0, bolds, field, brackets, true, onRemove)
  // 지우개가 지우는 덩어리(§ removeHighlightRun) 계산용. 렌더에 쓰는 것과 같은 목록이어야 한다
  const runList = fieldListOf(highlights, field)

  const nodes: React.ReactNode[] = []
  let cursor = 0
  // 동그라미 하나가 형광펜 등 다른 표시와 겹쳐 여러 조각으로 나뉘어 있으면, 조각마다 원을 그리지 않고
  // 맞닿은 조각 전체를 감싸는 원 하나를 그린다. (조각마다 그리면 "법원의 허가"를 한 번에 쳤는데
  // 형광펜이 칠해진 "법원"과 "의 허가"에 각각 작은 원이 생겨 잘려 보였다)
  // 조각이 하나뿐인 원은 예전 그대로 그 조각 자체가 원이 된다
  let group: { kind: 'circle' | 'cross'; key: string; color: HighlightColor; items: React.ReactNode[] } | null = null
  const flushGroup = () => {
    if (!group) return
    if (group.kind === 'circle') {
      nodes.push(
        <span
          key={`${field}_circle_${group.key}`}
          className={`${SHAPE_CIRCLE} ${HIGHLIGHT_CIRCLE_CLASSES[group.color]}`}
        >
          {group.items}
        </span>
      )
    } else {
      // X표시도 같다. 조각마다 그라디언트를 칠하면 조각마다 ×가 하나씩 생기므로, 이어진 조각 전체에
      // 덮어씌우는 × 하나를 따로 둔다. 조각의 형광펜 배경(자식)이 부모 배경을 덮기 때문에 배경이 아니라
      // 위에 얹는 층으로 그리고, 클릭은 아래 글자로 통과시킨다
      nodes.push(
        <span key={`${field}_cross_${group.key}`} className="relative">
          {group.items}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: crossGradient(group.color) }}
          />
        </span>
      )
    }
    group = null
  }
  for (const h of fieldHighlights) {
    const styles = stylesOf(h)
    const circleRun = styles.includes('circle') ? runOfStyle(runList, h, 'circle') : null
    const joined = circleRun !== null && circleRun.length > 1
    // 원과 X가 함께 이어져 있으면 원만 합친다. 둘을 한꺼번에 감싸는 규칙은 두지 않았다
    const crossRun = !joined && styles.includes('cross') ? runOfStyle(runList, h, 'cross') : null
    const joinedCross = crossRun !== null && crossRun.length > 1
    // 합쳐진 원·X 안의 조각은 그 모양을 빼고 나머지 스타일만 입는다. 남는 스타일이 없으면 투명하게 둔다
    // (highlightClassName 은 빈 목록을 형광펜으로 되돌리므로 따로 처리한다)
    const ownStyles = styles.filter((st) => !(joined && st === 'circle') && !(joinedCross && st === 'cross'))
    const underlineInside = !joined && styles.includes('underline') && styles.includes('circle')
    const content = withBrackets(text.slice(h.start, h.end), h.start, bolds, field, brackets, false, onRemove)
    if (h.start > cursor) {
      flushGroup()
      nodes.push(withBrackets(text.slice(cursor, h.start), cursor, bolds, field, brackets, false, onRemove))
    }
    const mark = (
      <mark
        key={h.id}
        data-hl-run={onRemove ? runKeys(runList, h) : undefined}
        onMouseEnter={onRemove ? (e) => markErasing(e.currentTarget.dataset.hlRun ?? '') : undefined}
        onMouseLeave={onRemove ? () => markErasing('') : undefined}
        onClick={(e) => {
          if (onRemove) {
            e.stopPropagation()
            onRemove(h.id)
          }
        }}
        title={onRemove ? '클릭하면 지워집니다 (지우개)' : undefined}
        style={{
          cursor: onRemove ? `url("${ERASER_CURSOR_SVG}") 4 20, pointer` : 'default',
        }}
        className={`${
          ownStyles.length === 0
            ? 'bg-transparent'
            : highlightClassName(ownStyles.filter((st) => !(underlineInside && st === 'underline')), h.color, h.colors)
        } transition-all ${onRemove ? eraserHoverClass(styles) : ''}`}
      >
        {underlineInside ? (
          // 원과 함께 있는 밑줄은 원(둥근 테두리)에 가려져 끊겨 보이므로, 원 안쪽 글자를 감싼 span 에 따로 그린다.
          // span 이 원의 좌우 여백(0.3em)과 테두리(2px)까지 덮어 이웃한 밑줄과 이어진다
          <span
            className={`${HIGHLIGHT_UNDERLINE_CLASSES[colorOfStyle(h, 'underline')]} box-decoration-clone`}
            style={{ padding: '0 0.3em', margin: '0 calc(-0.3em - 2px)' }}
          >
            {content}
          </span>
        ) : (
          content
        )}
      </mark>
    )
    if (joined || joinedCross) {
      const kind = joined ? 'circle' : 'cross'
      const key = (joined ? circleRun! : crossRun!)[0].id
      if (group && (group.kind !== kind || group.key !== key)) flushGroup()
      if (!group) group = { kind, key, color: colorOfStyle(h, kind), items: [] }
      group.items.push(mark)
    } else {
      flushGroup()
      nodes.push(mark)
    }
    cursor = Math.max(cursor, h.end)
  }
  flushGroup()
  // 맨 뒤 조각. 표시가 글 끝까지 닿아 있어도 글 끝에 끼운 괄호는 그려야 한다
  nodes.push(withBrackets(text.slice(cursor), cursor, bolds, field, brackets, true, onRemove))
  return nodes
}