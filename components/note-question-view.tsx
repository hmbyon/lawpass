'use client'

import { useMemo, useState } from 'react'
import type { WrongNote } from '@/lib/types'
import { getChoiceMemosFor } from '@/lib/store'
import { renderHighlighted } from '@/lib/highlights'
import { HighlightEditor } from '@/components/highlight-editor'
import { PassageTable } from '@/components/passage-table'
import { QuestionImages } from '@/components/question-images'
import { DrawingPreview } from '@/components/drawing-preview'
import { parseSubExplanations, resolveSubChoices } from '@/lib/subChoices'
import {
  ExplanationBox, choiceExplanationParts, subItemExplanationParts, hasExplanationParts, toExplanationBlocks,
  type ExplanationParts,
} from '@/components/quiz/explanation-blocks'
import { isAnswerLabel, isMultiAnswer, selectedLabels } from '@/lib/answers'

// 정규식으로 쪼갠 옛 보기별 해설(문자열). 키를 선학습과 똑같이(subexp_라벨) 써야 거기서 칠한 형광펜이 어긋나지 않는다
function legacySubParts(label: string, text: string): ExplanationParts {
  return { blocks: toExplanationBlocks(text), summaryKey: `subsum_${label}`, blockKey: () => `subexp_${label}` }
}

/**
 * 한 문제를 선학습과 같은 모양으로 보여 준다(읽기 + 형광펜·펜 자동표시).
 * 도면 이미지 → 발문·표 → ㄱㄴㄷ 보기와 그 보기의 해설 → ①~⑤ 선지와 그 선지의 해설 → 그림판에 그린 그림.
 * 오답노트 상세 창, 채점 직후 오답 분석 결과, D-1 암기장이 모두 이것을 쓴다 — 화면마다 따로 그리면 어긋난다
 * (예: ㄱㄴㄷㄹ 가 지문에 들어 있는 옛 문제는 선학습이 passage_stem·sub_ㄹ 칸에 칠하는데,
 * 다른 화면이 passage 칸만 보면 거기서 칠한 표시가 하나도 안 보인다)
 */
export function NoteQuestionView({ note, onChanged }: { note: WrongNote; onChanged?: () => void }) {
  const q = note.question
  // 선학습과 같은 판정: subItems 가 있으면 그것, 없으면 지문에서 ㄱㄴㄷ/가나다 줄을 파싱한다
  const subChoices = resolveSubChoices(q)
  // ①~⑤ 가 보기의 조합인 문제(구조화 보기가 있는 경우). 파싱으로만 찾은 경우는 O/X·선지 해설 규칙을 바꾸지 않는다
  const isCombination = (q.subItems?.length ?? 0) > 0
  const subItemByLabel = useMemo(() => new Map((q.subItems ?? []).map((it) => [it.label, it])), [q.subItems])
  const legacySub = useMemo(
    () => (subChoices ? { ...parseSubExplanations(q.explanation), ...(q.subChoiceExplanations ?? {}) } : {}),
    [subChoices, q.explanation, q.subChoiceExplanations]
  )
  // 보기별 해설: 구조화된 것을 우선, 없으면 옛 문자열
  function subParts(label: string): ExplanationParts | null {
    const sub = subItemByLabel.get(label)
    const own = sub ? subItemExplanationParts(sub) : null
    if (own && hasExplanationParts(own)) return own
    const legacy = (legacySub as Record<string, string>)[label]
    return legacy?.trim() ? legacySubParts(label, legacy) : null
  }
  const hasPerItemExplanation =
    (subChoices?.items.some((item) => subParts(item.label) !== null) ?? false) ||
    (!isCombination && q.choices.some((c) => hasExplanationParts(choiceExplanationParts(q, c.label))))
  // 선지 메모는 오답노트와 따로 저장된다. 옛 메모(note.choiceMemos)도 이 안에 합쳐져 온다
  const [choiceMemos] = useState(() => getChoiceMemosFor(note.questionId))
  const mine = selectedLabels(note.userAnswer)

  return (
    <div className="space-y-4">
      {/* 문제에 붙은 도면 이미지. 없으면 아무것도 그리지 않는다 */}
      <QuestionImages questionId={q.id} imageIds={q.images} poolId={q.poolId} readOnly />

      {/* 지문과 선지에 형광펜·펜 자동표시를 쓴다. 표시는 문제 id 로 저장돼 선학습과 같이 쓰인다 */}
      <HighlightEditor questionId={q.id} onChanged={onChanged} className="space-y-4">
        {({ highlights, remove: removeHighlight, fieldRef }) => (
          <>
            {/* 문제 지문 */}
            <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">문제 지문</p>
              <p
                ref={fieldRef(subChoices ? 'passage_stem' : 'passage')}
                className="text-foreground leading-relaxed text-xs whitespace-pre-wrap select-text"
              >
                {renderHighlighted(
                  subChoices ? subChoices.stem : q.passage,
                  subChoices ? 'passage_stem' : 'passage',
                  highlights,
                  removeHighlight
                )}
              </p>

              {/* 지문 안의 표/서식 */}
              {q.passageTable && q.passageTable.length > 0 && (
                <div className="mt-2">
                  <PassageTable
                    tables={q.passageTable}
                    highlights={highlights}
                    onRemoveHighlight={removeHighlight}
                    registerRef={(key, el) => fieldRef(key)(el)}
                  />
                </div>
              )}

              {/* ㄱㄴㄷ 보기 — 각 보기 바로 밑에 그 보기의 해설 */}
              {subChoices && (
                <div className="mt-2 space-y-2 pl-3 border-l-2 border-border">
                  {subChoices.items.map((item) => {
                    const subItem = subItemByLabel.get(item.label)
                    const ox = subItem ? subItem.isCorrect : q.subChoiceAnswers?.[item.label]
                    const parts = subParts(item.label)
                    return (
                      <div key={item.label}>
                        <div className="flex gap-2 items-start text-xs">
                          {ox !== undefined && (
                            <span className={`shrink-0 font-bold ${ox ? 'text-blue-400' : 'text-red-400'}`}>{ox ? 'O' : 'X'}</span>
                          )}
                          <span className="font-semibold text-primary shrink-0">{item.label}.</span>
                          <span ref={fieldRef(`sub_${item.label}`)} className="flex-1 text-foreground leading-relaxed select-text">
                            {renderHighlighted(item.text, `sub_${item.label}`, highlights, removeHighlight)}
                          </span>
                        </div>
                        {/* 선학습에서 이 보기에 남긴 메모(보기 라벨로 저장된다) */}
                        {choiceMemos[item.label] && (
                          <div className="ml-3 mt-1 px-2 py-1 bg-yellow-100 text-yellow-900 border-l-2 border-yellow-500/50 rounded-r text-xs dark:bg-yellow-900/20 dark:text-yellow-300">
                            📌 {choiceMemos[item.label]}
                          </div>
                        )}
                        {parts && (
                          <ExplanationBox
                            parts={parts}
                            highlights={highlights}
                            onRemove={removeHighlight}
                            fieldRef={fieldRef}
                            className="ml-3 mt-1"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 선지 */}
            <div className="space-y-1">
              {q.choices.map((c) => (
                <div key={c.label}>
                  <div
                    className={`flex gap-2 p-2 rounded-lg text-xs border ${
                      isAnswerLabel(q.answer, c.label)
                        ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : mine.includes(c.label)
                          ? 'border-red-500 bg-red-100 text-red-900 dark:border-red-600 dark:bg-red-900/20 dark:text-red-300'
                          : 'border-border text-muted-foreground'
                    }`}
                  >
                    <span className="font-semibold shrink-0">{c.label}</span>
                    <span ref={fieldRef(`choice_${c.label}`)} className="flex-1 select-text">
                      {renderHighlighted(c.text, `choice_${c.label}`, highlights, removeHighlight)}
                    </span>
                    {note.confusedWith?.includes(c.label) && (
                      <span className="ml-auto shrink-0 text-amber-600 dark:text-amber-400">
                        {note.status === '찍음' ? '🎲 찍음' : '🤔 헷갈림'}
                      </span>
                    )}
                    {isAnswerLabel(q.answer, c.label) && (
                      <span className="ml-auto shrink-0">
                        ✓ 정답{isMultiAnswer(q.answer) && !mine.includes(c.label) ? ' · 놓침' : ''}
                      </span>
                    )}
                    {mine.includes(c.label) && !isAnswerLabel(q.answer, c.label) && <span className="ml-auto shrink-0">✗ 내 답</span>}
                  </div>
                  {choiceMemos[c.label] && (
                    <div className="ml-2 mt-0.5 px-2 py-1 bg-yellow-100 text-yellow-900 border-l-2 border-yellow-500/50 rounded-r text-xs dark:bg-yellow-900/20 dark:text-yellow-300">
                      📌 {choiceMemos[c.label]}
                    </div>
                  )}
                  {/* 선학습과 같은 자리·같은 필드 키라, 거기서 해설에 칠한 형광펜·펜 표시가 그대로 보인다.
                      조합형(ㄱㄴㄷ) 문제의 ①~⑤는 조합 결과일 뿐이라 선학습처럼 선지 해설을 붙이지 않는다 */}
                  {!isCombination && (
                    <ExplanationBox
                      parts={choiceExplanationParts(q, c.label)}
                      highlights={highlights}
                      onRemove={removeHighlight}
                      fieldRef={fieldRef}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </HighlightEditor>

      {/* 해설. 선지별·보기별 해설이 하나라도 있으면 위에서 각 자리에 보여 줬으므로 합쳐 둔 해설은 겹쳐서 숨긴다 */}
      {q.explanation && !hasPerItemExplanation && (
        <div className="bg-muted/40 border border-border/60 rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-1 font-medium">해설</p>
          <p className="text-foreground text-xs leading-relaxed whitespace-pre-wrap break-words">{q.explanation}</p>
        </div>
      )}

      {/* 선학습 그림판에 그린 그림 (읽기 전용) */}
      <DrawingPreview questionId={q.id} />
    </div>
  )
}
