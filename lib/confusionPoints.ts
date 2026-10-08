import type { WrongNote } from '@/lib/types'
import { isAnswerLabel, selectedLabels } from '@/lib/answers'
import { canonicalSubLabel, confusionLabels, deriveChoiceTruth, resolveSubChoices, subItemDiffs } from '@/lib/subChoices'

/**
 * 한 문제에서 "내가 헷갈린 자리" 하나.
 *  - confused: 풀 때 직접 헷갈림/찍음으로 짚은 보기·선지
 *  - diff: 채점해 보니 갈린 자리 — ㄱㄴㄷㄹ 조합 문제는 내 조합과 정답 조합이 다른 보기,
 *    그 밖의 문제는 내가 고른 오답 선지
 */
export interface ConfusionPoint {
  /** 같은 문제 안에서 유일한 키 */
  key: string
  /** ㄱ / ㄷ / ① 같은 라벨 */
  label: string
  text: string
  confused: boolean
  diff: boolean
  /** 보기(ㄱㄴㄷ)인지 선지(①~⑤)인지 */
  kind: '보기' | '선지'
  /** 이 보기·선지 문장 자체가 옳은 서술(O)인지 틀린 서술(X)인지. 알 수 없으면 undefined */
  truth?: boolean
}

export function confusionPoints(note: WrongNote): ConfusionPoint[] {
  const q = note.question
  const picked = new Set(note.confusedWith ?? [])
  const out: ConfusionPoint[] = []
  const { kind } = confusionLabels(q)
  if (kind === '보기') {
    const sub = resolveSubChoices(q)
    const diffs = subItemDiffs(q, note.userAnswer)
    const subByLabel = new Map((q.subItems ?? []).map((it) => [it.label, it]))
    for (const item of sub?.items ?? []) {
      const confused = picked.has(item.label)
      const diff = diffs.has(canonicalSubLabel(item.label))
      if (confused || diff) out.push({
          key: `sub_${item.label}`,
          label: item.label,
          text: item.text,
          confused,
          diff,
          kind: '보기',
          truth: subByLabel.get(item.label)?.isCorrect ?? q.subChoiceAnswers?.[item.label],
        })
    }
    return out
  }
  const mine = selectedLabels(note.userAnswer)
  // 선지 문장의 참/거짓은 발문 유형과 정답으로 정한다(선학습과 같은 규칙). 유형을 못 읽으면 저장된 값
  const truths = deriveChoiceTruth(q) ?? q.choiceIsCorrectStatement
  for (const c of q.choices) {
    const confused = picked.has(c.label)
    // 맞힌 문제의 정답 선지는 갈린 자리가 아니다. 내가 골랐는데 정답이 아닌 선지만 센다
    const diff = mine.includes(c.label) && !isAnswerLabel(q.answer, c.label)
    if (confused || diff) out.push({ key: `choice_${c.label}`, label: c.label, text: c.text, confused, diff, kind: '선지', truth: truths?.[c.label] })
  }
  return out
}
