// 상대 경로: check:case-solve 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import type { Problem } from './types'

/**
 * 사례형 풀이(답안 작성) — 데이터 모양과 순수 함수.
 * 소문항은 데이터에 구조화되어 있지 않다. question.ask 안의 '(N점)' 이 두 번 이상 나오면
 * 그 자리마다 칸을 나누고, 한 번 이하면 문항 전체를 칸 하나로 둔다
 */

export interface AnswerBox {
  label: string // '(1)', '가.', '①' — 앞머리 표지가 없으면 ''
  points: number | null
  text: string // 그 소문항의 물음 원문
}

const POINTS = /\(\s*(\d+)\s*점\s*\)/g
// 소문항 앞머리 표지: (1)  1)  ①  가.  1.
const LEAD = /^\s*(\(\d+\)|\d+\)|[①-⑳]|[가-하]\.|\d+\.)\s*/

export function splitAsk(ask: string, points: number): AnswerBox[] {
  const whole: AnswerBox[] = [{ label: '', points, text: ask.trim() }]
  const ends = [...ask.matchAll(POINTS)].map((m) => ({ end: m.index! + m[0].length, points: Number(m[1]) }))
  if (ends.length < 2) return whole
  const boxes: AnswerBox[] = []
  let start = 0
  ends.forEach((e, i) => {
    // 마지막 배점 뒤에 붙은 단서('(평등권은 논외로 함)')는 마지막 칸에 남긴다
    const text = ask.slice(start, i === ends.length - 1 ? ask.length : e.end).trim()
    start = e.end
    // '2) ①', '3. (2)' 처럼 표지가 겹치면 가장 안쪽(마지막) 것을 쓴다
    let label = ''
    for (let rest = text, m = rest.match(LEAD); m; rest = rest.slice(m[0].length), m = rest.match(LEAD)) label = m[1]
    boxes.push({ label, points: e.points, text })
  })
  // '1. 머리 물음 (20점) (1) … (10점) (2) … (10점)' — 머리 물음의 배점은 아래 소문항의 합이다.
  // 문항 배점과 맞을 때까지 머리 칸을 다음 칸 앞에 붙인다
  const sum = (bs: AnswerBox[]) => bs.reduce((n, b) => n + (b.points ?? 0), 0)
  while (boxes.length > 1 && sum(boxes) !== points && sum(boxes.slice(1)) === points) {
    const [head, next] = boxes.splice(0, 2)
    boxes.unshift({ ...next, text: `${head.text} ${next.text}` })
  }
  return boxes.length > 1 ? boxes : [{ ...boxes[0], label: '' }]
}

export const boxesOf = (p: Pick<Problem, 'question' | 'points'>): AnswerBox[] =>
  p.question?.ask ? splitAsk(p.question.ask, p.points) : [{ label: '', points: p.points, text: '' }]

// 시도 하나 = 한 번 풀이 화면을 연 것. 같은 문항(묶음)을 여러 번 풀면 시도가 쌓인다
export interface CaseAttempt {
  id: string
  setKey: string // 문항 id 를 순서대로 ',' 로 이은 것 — 같은 묶음의 임시저장을 찾는 키
  problemIds: string[]
  answers: { problemId: string; boxes: string[] }[]
  status: 'draft' | 'submitted'
  elapsedSeconds: number
  targetMinutes: number | null
  startedAt: number
  updatedAt: number
  submittedAt: number | null
  // 제출 후 조문 점검(선택 필드, lib/caseStudy/statuteCheck). 문항 id → 자동 판정 사본·직접 고친 값.
  // 없으면(예전 시도) 열 때 자동 판정으로 보여 준다
  statuteChecks?: Record<string, { auto: Record<string, StatuteMark>; manual: Record<string, StatuteMark> }>
  // 제출 후 AI 점검(선택 필드, lib/caseStudy/aiCheck). 문항 id → 점검 결과. answerHash 가 지금 답안과 다르면 오래된 결과
  aiChecks?: Record<string, {
    model: string
    checkedAt: number
    answerHash: string
    items: Record<string, { verdict: AiVerdict; evidence: string; note: string; userVerdict?: AiVerdict }>
  }>
}
export type AiVerdict = '담김' | '부분' | '누락' | '확인불가'
export type StatuteMark = 'ok' | 'partial' | 'missing'

export const setKeyOf = (problemIds: string[]) => problemIds.join(',')

export const filledCount = (boxes: string[]) => boxes.filter((t) => t.trim().length > 0).length

export function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
