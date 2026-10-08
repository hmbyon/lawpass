import type { ExplanationBlock, Question, SubItem } from '@/lib/types'
import { renderHighlighted } from '@/lib/highlights'
import type { Highlight, BoldRange } from '@/lib/highlights'

/**
 * 선지·보기 항목 밑에 붙는 해설 박스(요약 + 블록). 선학습과 오답노트가 같은 모양·같은 필드 키를 쓰기 때문에
 * 선학습에서 해설에 칠한 형광펜·펜 자동표시가 오답노트에서도 그대로 보인다.
 * 필드 키는 선학습이 저장해 온 이름 그대로여야 한다 — 바꾸면 이미 칠해 둔 표시가 어긋난다
 */

// 원본에서 밑줄로 강조돼 있던 구간을 AI가 **텍스트** 형태로 표시해 준다.
// 형광펜 오프셋은 화면에 렌더된 텍스트 기준이므로, ** 마크를 제거한 문자열과
// 그 문자열 기준 볼드 범위를 함께 돌려줘야 두 기능이 어긋나지 않는다
export function parseBoldMarks(raw: string): { text: string; bolds: BoldRange[] } {
  const regex = /\*\*([\s\S]+?)\*\*/g
  const bolds: BoldRange[] = []
  let text = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(raw))) {
    text += raw.slice(last, match.index)
    const start = text.length
    text += match[1]
    bolds.push({ start, end: text.length })
    last = match.index + match[0].length
  }
  text += raw.slice(last)
  return { text, bolds }
}

// 해설은 블록 배열이 표준이지만, 블록 구조 도입 이전 데이터와 정규식 폴백 결과는 문자열이다
export function toExplanationBlocks(raw: string | ExplanationBlock[] | undefined): ExplanationBlock[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    const content = raw.trim()
    return content ? [{ type: 'text', content }] : []
  }
  return raw.filter((b) => b?.content?.trim())
}

export interface ExplanationParts {
  summary?: string
  blocks: ExplanationBlock[]
  summaryKey: string
  /** 블록 i 의 필드 키 */
  blockKey: (i: number) => string
}

/** ①~⑤ 선지 하나의 해설. 선학습의 선지 해설 렌더와 같은 규칙 */
export function choiceExplanationParts(q: Question, label: string): ExplanationParts {
  const raw = q.choiceExplanations?.[label]
  const isBlock = Array.isArray(raw)
  return {
    summary: q.choiceExplanationSummaries?.[label]?.trim() || undefined,
    blocks: toExplanationBlocks(raw),
    summaryKey: `choicesum_${label}`,
    // 옛 문자열 데이터는 기존 키를 그대로 써야 이미 칠해 둔 형광펜이 어긋나지 않는다
    blockKey: (i) => (isBlock ? `choiceexp_${label}_${i}` : `choiceexp_${label}`),
  }
}

/** ㄱㄴㄷ 보기 항목 하나의 해설 (subItems 구조 데이터만) */
export function subItemExplanationParts(item: SubItem): ExplanationParts {
  return {
    summary: item.explanationSummary?.trim() || undefined,
    blocks: toExplanationBlocks(item.explanation),
    summaryKey: `subsum_${item.label}`,
    blockKey: (i) => `subexp_${item.label}_${i}`,
  }
}

export function hasExplanationParts(p: ExplanationParts): boolean {
  return Boolean(p.summary) || p.blocks.length > 0
}

interface BoxProps {
  parts: ExplanationParts
  highlights: Highlight[]
  onRemove?: (id: string) => void
  fieldRef: (field: string) => (el: HTMLElement | null) => void
  className?: string
}

export function ExplanationBox({ parts, highlights, onRemove, fieldRef, className = 'ml-3 mt-1' }: BoxProps) {
  if (!hasExplanationParts(parts)) return null
  const { summary, blocks, summaryKey, blockKey } = parts
  return (
    <div className={`${className} bg-muted rounded-lg p-2.5 space-y-2`}>
      {summary && (
        <div className="flex gap-1.5 items-start">
          <span className="shrink-0 text-[10px] text-primary font-medium mt-0.5">요약</span>
          <p
            ref={fieldRef(summaryKey)}
            className="text-xs font-semibold text-foreground leading-relaxed whitespace-pre-wrap select-text"
          >
            {(() => {
              const { text, bolds } = parseBoldMarks(summary)
              return renderHighlighted(text, summaryKey, highlights, onRemove, bolds)
            })()}
          </p>
        </div>
      )}
      {summary && blocks.length > 0 && <div className="border-t border-border" />}
      {blocks.map((block, bi) => {
        const key = blockKey(bi)
        const { text: blockText, bolds } = parseBoldMarks(block.content)
        if (block.type === 'lawBox') {
          return (
            <div key={key} className="border border-primary/30 bg-primary/5 rounded-lg p-2 space-y-1">
              {block.title && (
                <p className="text-[11px] font-semibold text-primary leading-snug">{parseBoldMarks(block.title).text}</p>
              )}
              <p
                ref={fieldRef(key)}
                className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
              >
                {renderHighlighted(blockText, key, highlights, onRemove, bolds)}
              </p>
            </div>
          )
        }
        return (
          <p
            key={key}
            ref={fieldRef(key)}
            className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text"
          >
            {renderHighlighted(blockText, key, highlights, onRemove, bolds)}
          </p>
        )
      })}
    </div>
  )
}
