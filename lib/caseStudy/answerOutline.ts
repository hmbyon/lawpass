// 상대 경로만 쓴다 — check:* 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { caseNumberSpans, htmlToText } from '../caseDigest'
import type { Block } from './types'

/**
 * 사례형 모범답안을 판례 화면용으로 읽는다 — 목차(h1/h2)와, 판례가 나온 문단의 '법리'와 '사안포섭' 가르기.
 *
 * 실데이터(판례 인용 522건)에서 사안포섭은 세 모양으로 온다:
 *  (a) 인용 문단은 인용 문장으로 끝나고, 사안포섭은 따로 있다 — 같은 목차의 다음 문단이 "사안에의 적용 : 甲이…"
 *      처럼 시작하거나, 바로 다음 목차가 "사안의 적용/해결/검토/경우", "사안에의 적용", "적용", "포섭", "소결"
 *  (b) 같은 문단 안에서 인용 괄호 뒤에 이어진다 — "…(대법원 … 2022다200089 판결). 甲은행의 수동채권은…"
 *  (c) 인용이 든 문장 자체가 포섭이다 — "따라서 乙이 … 효력이 발생한다(대법원 … 80다76 판결)."
 * 포섭인지는 당사자 표기(甲乙丙…)나 "사안…·이 사건" 머리말로 본다.
 * 애매하면 자르지 않는다(덜 자르는 쪽): (b) 는 뒤 문장이 포섭처럼 보일 때만 끊고, 법리로 이어지면 통째로 둔다
 */

// 당사자 표기 — 법리 문장은 '채권자·채무자'로 쓰고, 사안에 적용하는 문장은 甲乙丙…으로 쓴다
const PARTY = /[甲乙丙丁戊己庚辛壬癸]/
// 사안포섭 문장·문단의 머리말. "따라서·그러므로·결국"은 법리 문장에도 흔해서(판결 이유를 옮긴 문단)
// 신호로 쓰지 않는다 — 그런 문장은 당사자 표기가 있을 때만 포섭으로 본다
const APPLY_LEAD = /^\s*(?:\(?\d+\)?\s*)?(?:사안에의 적용|사안의 적용|사안의 경우|사안의 해결|사안의 검토|사안에서|사안에 관하여|사안은|사안을|본 사안|이 사건)/
// 사안포섭 목차 제목 ("사안의 쟁점"은 쟁점 정리라 아니다)
const APPLY_HEAD = /사안의\s*(?:적용|해결|검토|경우|포섭)|사안에의\s*적용|사안\s*포섭|포섭|^(?:[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|\(\d+\)|[가-하]\.)?\s*(?:적용|소결론?)\s*$/

const looksApplied = (s: string) => PARTY.test(s) || APPLY_LEAD.test(s)
// 문단의 첫 문장
const firstSentence = (t: string) => t.slice(0, sentenceAround(t, 0, 0)[1])

export type CitationKind = 'a' | 'b' | 'c' | 'none'

export interface CaseCitation {
  blockIndex: number
  kind: CitationKind
  law: string // 파란 박스에 넣을 부분 — 인용 문장까지(인용 괄호 포함). 비지 않는다
  application?: { title?: string; paragraphs: string[] } // 사안포섭 (없으면 undefined)
}

const levelOf = (b: Pick<Block, 't' | 'lv'>): number => (b.t === 'h1' ? 1 : b.lv === 'l3' ? 3 : 2)

/** 문장이 여기서 끝나는가. 앞이 숫자인 점은 날짜·조문("2022. 6. 30.")이라 끝이 아니다 */
function isSentenceEnd(text: string, i: number): boolean {
  return text[i] === '.' && !/\d/.test(text[i - 1] ?? '')
}

/** at 이 든 문장의 [시작, 끝) — 끝은 마침표 다음 (못 찾으면 글 끝) */
function sentenceAround(text: string, at: number, endFrom: number): [number, number] {
  let start = 0
  for (let i = at - 1; i >= 0; i--) {
    if (isSentenceEnd(text, i)) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = endFrom; i < text.length; i++) {
    if (isSentenceEnd(text, i)) {
      end = i + 1
      break
    }
  }
  return [start, end]
}

/**
 * 판례가 나온 p 블록 하나를 법리/사안포섭으로 가른다. blocks 는 그 문항 answer.blocks 전체
 */
export function splitCitation(blocks: Block[], blockIndex: number, caseNumber: string): CaseCitation {
  const text = htmlToText(blocks[blockIndex].html)
  const spans = caseNumberSpans(text, caseNumber)
  if (spans.length === 0) return { blockIndex, kind: 'none', law: text }
  // 판례가 문단에 여러 번 나오면 마지막 인용 문장까지를 법리로 본다
  const first = spans[0]
  const last = spans[spans.length - 1]
  const [sStart] = sentenceAround(text, first.at, first.at + first.len)
  const [, sEnd] = sentenceAround(text, last.at, last.at + last.len)
  const citeSentence = text.slice(sStart, sEnd)

  // (c) 인용 문장 자체가 사안에 적용하는 문장이다 — 잘라낼 법리가 없으니 통째로
  if (looksApplied(citeSentence)) return { blockIndex, kind: 'c', law: text }

  // (b) 같은 문단에서 인용 문장 뒤에 포섭이 이어진다
  const rest = text.slice(sEnd).trim()
  if (rest) {
    if (looksApplied(firstSentence(rest))) {
      return { blockIndex, kind: 'b', law: text.slice(0, sEnd).trim(), application: { paragraphs: [rest] } }
    }
    // 뒤가 법리로 이어진다 — 자르지 않는다
    return { blockIndex, kind: 'none', law: text }
  }

  // (a) 사안포섭이 다음 문단이나 다음 목차로 따로 있다
  const applyParas: string[] = []
  let i = blockIndex + 1
  for (; i < blocks.length && blocks[i].t === 'p'; i++) {
    const t = htmlToText(blocks[i].html)
    if (applyParas.length > 0 || looksApplied(firstSentence(t))) applyParas.push(t)
  }
  if (applyParas.length > 0) return { blockIndex, kind: 'a', law: text, application: { paragraphs: applyParas } }
  // 사안포섭 목차: 바로 다음 목차이거나, 인용 문단이 속한 목차와 같은 레벨의 뒤 형제 목차
  // ("1. 판례의 태도 → 2. 이유 → 3. 사안의 적용"). 더 큰 목차를 만나면 그 판례의 범위를 벗어난 것이라 멈춘다
  let ownerLevel = 1
  for (let k = blockIndex - 1; k >= 0; k--) {
    if (blocks[k].t !== 'p') {
      ownerLevel = levelOf(blocks[k])
      break
    }
  }
  for (let j = i; j < blocks.length; j++) {
    const head = blocks[j]
    if (head.t === 'p') continue
    const lv = levelOf(head)
    if (lv < ownerLevel) break
    if ((j === i || lv === ownerLevel) && APPLY_HEAD.test(htmlToText(head.html))) {
      const paragraphs: string[] = []
      for (let k = j + 1; k < blocks.length; k++) {
        if (blocks[k].t !== 'p') {
          if (levelOf(blocks[k]) <= lv) break
          continue
        }
        paragraphs.push(htmlToText(blocks[k].html))
      }
      if (paragraphs.length > 0) return { blockIndex, kind: 'a', law: text, application: { title: htmlToText(head.html), paragraphs } }
    }
  }
  return { blockIndex, kind: 'none', law: text }
}

/** 그 문항 답안에서 판례가 나온 p 블록마다 법리/사안포섭을 가른 결과 (같은 법리 문단은 한 번) */
export function caseCitations(
  problem: { answer?: { blocks: Block[] } } | undefined,
  caseNumber: string
): CaseCitation[] {
  const blocks = problem?.answer?.blocks ?? []
  const out: CaseCitation[] = []
  blocks.forEach((b, i) => {
    if (b.t !== 'p' || caseNumberSpans(htmlToText(b.html), caseNumber).length === 0) return
    const c = splitCitation(blocks, i, caseNumber)
    if (!out.some((o) => o.law === c.law)) out.push(c)
  })
  return out
}

export interface OutlineItem {
  blockIndex: number
  level: 1 | 2 | 3
  title: string
  pts?: string
}

/** 모범답안 목차(h1/h2) — 레벨(h1=1, h2 l2=2, l3=3)·배점 포함 */
export function answerOutline(problem: { answer?: { blocks: Block[] } } | undefined): OutlineItem[] {
  const out: OutlineItem[] = []
  ;(problem?.answer?.blocks ?? []).forEach((b, i) => {
    if (b.t === 'p') return
    out.push({ blockIndex: i, level: levelOf(b) as 1 | 2 | 3, title: htmlToText(b.html), pts: b.pts || undefined })
  })
  return out
}

/** 블록이 속한 목차 항목(바로 앞의 h1/h2) — 목차보다 앞에 있으면 -1 */
export function outlineItemOf(outline: OutlineItem[], blockIndex: number): number {
  let found = -1
  outline.forEach((o, k) => {
    if (o.blockIndex < blockIndex) found = k
  })
  return found
}

/**
 * 토글 맨 위의 문제 요약: brief[] 가 있으면 그것, 없으면 사례 원문 앞 1~2문단(설문과 같은 문단은 빼고),
 * 그것도 없으면 빈 배열(생략)
 */
export function problemSummary(problem: {
  brief?: string[]
  question?: { paragraphs: string[]; ask: string }
}): { lines: string[]; fromBrief: boolean } {
  const brief = (problem.brief ?? []).map((s) => s.trim()).filter(Boolean)
  if (brief.length > 0) return { lines: brief, fromBrief: true }
  const ask = problem.question?.ask.trim()
  const paras = (problem.question?.paragraphs ?? []).map((s) => s.trim()).filter((s) => s && s !== ask)
  return { lines: paras.slice(0, 2), fromBrief: false }
}
