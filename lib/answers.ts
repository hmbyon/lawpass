/**
 * 정답 표기. 대부분 '③' 한 글자지만 두 가지 예외가 있다.
 *  - 복수정답: 판례 변경 등으로 법무부(또는 교재)가 정답을 둘 이상으로 인정한 문제. '②,④' 처럼 쉼표로 이어 적는다.
 *    둘 중 어느 것을 골라도 정답이고, 화면에는 해당 선지 모두에 ✓ 정답이 붙는다
 *  - 정답 없음: 선지가 모두 틀린 문제. '정답없음' 으로 적는다. 정답 표시가 붙는 선지가 없고 어떤 답이든 오답이다
 *
 * 정답을 비교하는 곳은 q.answer === label 로 직접 비교하지 말고 이 함수들을 거친다 —
 * 직접 비교하면 복수정답 문제의 두 번째 정답이 오답으로 채점된다
 */

export const NO_ANSWER = '정답없음'
export const CHOICE_LABELS = ['①', '②', '③', '④', '⑤'] as const

/** 정답으로 인정되는 선지 라벨들. 정답 없음이면 빈 배열 */
export function answerLabels(answer: string | undefined | null): string[] {
  if (!answer) return []
  const trimmed = answer.trim()
  if (trimmed === NO_ANSWER) return []
  const parts = trimmed.split(/[\s,，、·/]+/).filter(Boolean)
  if (parts.length > 0 && parts.every((p) => (CHOICE_LABELS as readonly string[]).includes(p))) {
    return Array.from(new Set(parts))
  }
  // 알 수 없는 표기는 예전처럼 통째로 한 값으로 본다 (옛 데이터가 깨지지 않게)
  return [trimmed]
}

/** 이 선지가 정답인가 */
export function isAnswerLabel(answer: string | undefined | null, label: string | null | undefined): boolean {
  if (!label) return false
  return answerLabels(answer).includes(label)
}

export function isMultiAnswer(answer: string | undefined | null): boolean {
  return answerLabels(answer).length > 1
}

/** 화면에 보여 줄 정답 문자열. '②,④' → '② · ④' */
export function formatAnswer(answer: string | undefined | null): string {
  if (!answer) return ''
  const labels = answerLabels(answer)
  if (answer.trim() === NO_ANSWER) return NO_ANSWER
  return labels.join(' · ')
}

/** 입력(JSON 의 answer)이 허용되는 모양인가: ①~⑤ 하나, 쉼표로 이은 둘 이상, 또는 정답없음 */
export function isValidAnswerValue(answer: unknown): answer is string {
  if (typeof answer !== 'string') return false
  const trimmed = answer.trim()
  if (trimmed === NO_ANSWER) return true
  const parts = trimmed.split(/[\s,，、·/]+/).filter(Boolean)
  return parts.length > 0 && parts.every((p) => (CHOICE_LABELS as readonly string[]).includes(p))
}
