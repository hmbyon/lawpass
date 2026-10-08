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

// ── 수험생이 고른 답 ─────────────────────────────────────────────
// 복수정답 문제(answer 가 '②,④')는 정답 선지를 모두 골라야 맞은 것으로 채점한다.
// 시험에서는 하나만 골라도 인정되지만, 이 앱은 선지마다 정답 여부를 아는 연습이 목적이라
// 하나만 고르면 틀린 것으로 본다. 고른 답도 정답과 같은 표기('②,④')로 저장한다

/** 수험생이 고른 선지들. '②,④' → ['②','④'], 하나면 그 하나 */
export function selectedLabels(userAnswer: string | null | undefined): string[] {
  if (!userAnswer) return []
  return userAnswer.split(/[\s,，、·/]+/).filter(Boolean)
}

/** 고른 답이 정답과 정확히 같은 집합인가. 정답 없음 문제는 어떤 답이든 오답이다 */
export function isCorrectSelection(answer: string | undefined | null, userAnswer: string | null | undefined): boolean {
  // 정답이 '정답없음'인 문제는 수험생이 '정답 없음'을 골라야 맞다. 반대로 정답이 있는 문제에서 '정답 없음'을 고르면 오답이다
  if (answer?.trim() === NO_ANSWER) return userAnswer?.trim() === NO_ANSWER
  const correct = answerLabels(answer)
  const picked = selectedLabels(userAnswer)
  if (correct.length === 0 || picked.length === 0) return false
  return correct.length === picked.length && correct.every((l) => picked.includes(l))
}

/** 선지를 눌렀을 때 새 답. 단일 정답 문제는 그 선지로 바꾸고, 복수정답 문제는 켜고 끈다 */
export function toggleSelection(current: string | null | undefined, label: string, multi: boolean): string | null {
  if (!multi) return label
  // '정답 없음'을 골라 둔 상태에서 선지를 누르면 정답 없음은 풀리고 그 선지부터 새로 고른다
  const set = new Set(current?.trim() === NO_ANSWER ? [] : selectedLabels(current))
  if (set.has(label)) set.delete(label)
  else set.add(label)
  const ordered = CHOICE_LABELS.filter((l) => set.has(l))
  return ordered.length > 0 ? ordered.join(',') : null
}
