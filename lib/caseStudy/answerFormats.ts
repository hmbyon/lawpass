// 상대 경로: check:case-answer-formats 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import type { FormatRange } from '../highlights'

/**
 * 모범답안 블록 html → (글자, 기본 서식 구간). 화면에서 읽을 때만 바꾸고 카드 데이터는 그대로 둔다.
 * 입력은 sanitizeCaseHtml 을 거친 html 이다 — 남는 것이 <mark class="law|case|res">·<u>·<b>·<br> 와
 * 이스케이프된 글자뿐이라 짧은 토큰 규칙으로 정확히 읽힌다. 모르는 태그는 글자 없이 건너뛴다
 */
export interface ParsedBlock {
  text: string
  formats: FormatRange[]
}

const TOKEN = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>|([^<]+)|</g
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (_, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : NAMED[name]
  )
}

export function parseBlockHtml(html: string): ParsedBlock {
  let text = ''
  const open: { tag: 'mark' | 'u' | 'b'; className?: string; start: number; order: number }[] = []
  const formats: (FormatRange & { order: number })[] = []
  let opened = 0
  const seen = new Map<string, number>()
  for (const m of html.matchAll(TOKEN)) {
    const [whole, closing, rawTag, attrs, data] = m
    if (data !== undefined) {
      text += decodeEntities(data)
      continue
    }
    if (!rawTag) {
      text += whole // 태그가 아닌 '<'
      continue
    }
    const tag = rawTag.toLowerCase()
    if (tag === 'br') {
      text += '\n'
      continue
    }
    if (tag !== 'mark' && tag !== 'u' && tag !== 'b') continue
    if (!closing) {
      const cls = tag === 'mark' ? /class="([^"]*)"/.exec(attrs ?? '')?.[1]?.trim() : undefined
      open.push({ tag, className: cls || undefined, start: text.length, order: opened++ })
      continue
    }
    // 가장 안쪽의 같은 태그를 닫는다
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].tag !== tag) continue
      const [o] = open.splice(i, 1)
      if (text.length > o.start) {
        // id = 종류:위치. 같은 자리에 같은 종류가 겹치면 뒤에 번호를 붙인다
        const base = `${o.className ?? o.tag}:${o.start}-${text.length}`
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        formats.push({ id: n > 1 ? `${base}#${n}` : base, start: o.start, end: text.length, tag: o.tag, className: o.className, order: o.order })
      }
      break
    }
  }
  // 바깥 것이 먼저 오게 둔다. 같은 범위를 두 태그가 감쌌으면('<u><mark>…</mark></u>') 먼저 연 것이 바깥이다 —
  // renderHighlighted 는 같은 범위의 순서를 그대로 지키므로 원래 안긴 순서대로 그려진다
  formats.sort((a, b) => a.start - b.start || b.end - a.end || a.order - b.order)
  return { text, formats: formats.map(({ order: _order, ...f }) => f) }
}

// 블록 글자 해시(FNV-1a 32bit). 형광펜·숨김 기록을 그 글자 판본에 묶어, 카드가 고쳐지면 옛 기록이 엉뚱한 자리에 붙지 않게 한다
export function textHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// 모범답안 블록 i 의 형광펜 field. 해시가 들어 있어 글자가 바뀐 블록의 옛 기록은 field 가 달라 그려지지 않는다(지우지는 않는다)
export const answerField = (blockIndex: number, text: string) => `a${blockIndex}@${textHash(text)}`

// 숨긴 기존 표시의 키: '{field}:{서식 id}' — 예 'a12@1k3j9x:law:3-20'
export const hiddenKey = (field: string, formatId: string) => `${field}:${formatId}`
