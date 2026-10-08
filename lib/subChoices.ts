import type { Question } from '@/lib/types'
import { isAnswerLabel, selectedLabels } from '@/lib/answers'

/**
 * 보기 항목(ㄱㄴㄷㄹ·가나다라) 해석. 선학습·CBT 가 같은 기준으로 지문과 보기를 나눠 보여주도록
 * 한곳에 둔다. 구조화 추출된 subItems 가 있으면 그것을, 없으면 지문 정규식 파싱을 쓴다
 */

// 유니코드 한글 음절 조합 순서의 초성 19자
export const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
export const HANGUL_SYLLABLE_BASE = 0xac00 // '가'
export const CHOSEONG_STRIDE = 588 // 중성 21 × 종성 28

// 자음 라벨을 같은 순서의 가나다 라벨로 변환한다 (중성 'ㅏ', 받침 없음)
// 예: 'ㄱ' → '가', 'ㅁ' → '마', 'ㅎ' → '하'
export function syllableForConsonant(consonant: string): string | null {
  const index = CHOSEONG.indexOf(consonant)
  return index < 0 ? null : String.fromCharCode(HANGUL_SYLLABLE_BASE + index * CHOSEONG_STRIDE)
}

// 라벨로 인정할 자음: ㄱ~ㅎ (쌍자음은 보기 라벨로 쓰이지 않으므로 제외)
export const SUB_LABEL_CONSONANTS = CHOSEONG.filter((c) => !'ㄲㄸㅃㅆㅉ'.includes(c))

// { 'ㄱ': 'ㄱ', '가': 'ㄱ', 'ㄴ': 'ㄴ', '나': 'ㄴ', ... 'ㅎ': 'ㅎ', '하': 'ㅎ' }
// 글자를 직접 나열하지 않고 계산으로 만들어, 새로운 라벨(ㅂ/바, ㅅ/사 …)도 코드 수정 없이 인식된다
export const SUB_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SUB_LABEL_CONSONANTS.flatMap((consonant) => {
    const syllable = syllableForConsonant(consonant)
    const entries: [string, string][] = [[consonant, consonant]]
    if (syllable) entries.push([syllable, consonant])
    return entries
  })
)

// 보기 항목 라벨로 인정하는 문자들. 마커 정규식들이 이 상수를 공유해야
// SUB_LABEL_MAP과 어긋나지 않는다 (ㅁ/마가 빠져 ㄹ 항목에 흡수되던 버그)
export const SUB_LABEL_CHARS = Object.keys(SUB_LABEL_MAP).join('')

export const OX_CHAR_CLASS = 'OoXx○◯〇×✕✗ＯＸ'

export interface SubChoice {
  stem: string
  items: { label: string; text: string }[]
}

export function parseSubChoices(passage: string): SubChoice | null {
  const regex = new RegExp(`(?:^|\n)[ \t]*([${SUB_LABEL_CHARS}])[ \t]*\\.[ \t]*`, 'g')
  const markers: { label: string; start: number; contentStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(passage))) {
    const label = SUB_LABEL_MAP[m[1]]
    if (!label) continue
    const labelIndex = m.index + m[0].indexOf(m[1])
    markers.push({ label, start: labelIndex, contentStart: m.index + m[0].length })
  }
  if (markers.length < 2) return null

  // 표·서식 안의 "가.", "다." 같은 산발적 표기를 하위지문으로 오인하지 않도록,
  // 실제 보기 항목처럼 ㄱ부터 순서대로 이어지는 경우만 인정한다
  const order = markers.map((m) => SUB_LABEL_CONSONANTS.indexOf(m.label))
  if (order[0] !== 0) return null
  if (order.some((v, i) => i > 0 && v !== order[i - 1] + 1)) return null

  const stem = passage.slice(0, markers[0].start).trim()
  const items: { label: string; text: string }[] = []
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].contentStart
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : passage.length
    const text = passage.slice(textStart, textEnd).trim()
      .replace(new RegExp(`\\s*\\([${OX_CHAR_CLASS}]\\)\\.?\\s*$`), '')
      .trim()
    if (text) items.push({ label: markers[i].label, text })
  }
  return items.length >= 2 ? { stem, items } : null
}


export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// subItems에는 발문(stem)이 없다. 지문에서 첫 항목이 시작되는 위치를 찾아 그 앞을 발문으로 자른다.
// 못 찾으면 기존 정규식 파싱의 stem으로, 그것도 없으면 지문 전체로 폴백한다
export function stemForSubItems(passage: string, items: { label: string; text: string }[]): string {
  const first = items[0]
  if (!first) return passage

  const probe = first.text.trim().slice(0, 20)
  let idx = probe ? passage.indexOf(probe) : -1
  if (idx < 0) {
    idx = passage.search(new RegExp(`(?:^|\n)\\s*${escapeRegExp(first.label)}\\s*[.)]`))
  }
  if (idx < 0) return parseSubChoices(passage)?.stem ?? passage

  // 본문 앞에 남은 라벨 표기("ㄱ." 등)까지 함께 잘라낸다
  return passage
    .slice(0, idx)
    .replace(new RegExp(`\\s*${escapeRegExp(first.label)}\\s*[.)]?\\s*$`), '')
    .trim()
}

// subItems(구조화 추출)를 우선 사용하고, 없으면 지문 정규식 파싱으로 폴백한다
export function resolveSubChoices(q: Question): SubChoice | null {
  if (q.subItems?.length) {
    const items = q.subItems.map((it) => ({ label: it.label, text: it.text }))
    return { stem: stemForSubItems(q.passage, items), items }
  }
  return parseSubChoices(q.passage)
}


/**
 * 지문에 안 들어 있는 보기 항목.
 *
 * 구조화 추출된 문제는 ㄱㄴㄷ 항목이 subItems 에만 있고 passage 에는 발문만 남는다.
 * passage 만 그리는 화면에서는 그 보기가 통째로 빠져, 풀 수 없는 문제가 된다.
 * 지문 안에 이미 보기가 있으면(옛 데이터) 중복해서 그리지 않도록 빈 배열을 돌려준다
 */
export function missingSubItems(q: Question): { label: string; text: string }[] {
  const items = (q.subItems ?? []).filter((it) => it.text?.trim())
  if (items.length === 0) return []
  const probe = items[0].text.trim().slice(0, 20)
  if (probe && q.passage.includes(probe)) return []
  return items.map((it) => ({ label: it.label, text: it.text }))
}

/**
 * 헷갈린 곳을 고르는 칩의 라벨.
 *
 * ㄱㄴㄷㄹ(가나다라) 보기가 있는 문제는 ①~⑤가 보기의 조합("ㄱ, ㄷ")일 뿐이라, 헷갈린 것은 선지 번호가
 * 아니라 어느 보기였는지다. 보기가 둘 이상 있으면 그 라벨을, 없으면 선지 라벨을 돌려준다
 */
export function confusionLabels(q: Question): { labels: string[]; kind: '보기' | '선지' } {
  const sub = resolveSubChoices(q)
  if (sub && sub.items.length >= 2) return { labels: sub.items.map((it) => it.label), kind: '보기' }
  return { labels: q.choices.map((c) => c.label), kind: '선지' }
}

/** 저장된 라벨이 선지 번호면 '선지', 아니면 '보기'. 화면 문구에 쓴다 */
export function confusedKind(q: Question, labels: string[]): '보기' | '선지' {
  const choice = new Set(q.choices.map((c) => c.label))
  return labels.length > 0 && labels.every((l) => choice.has(l)) ? '선지' : '보기'
}

/**
 * 해설 한 덩어리 안에 "ㄱ. (O) …" 식으로 이어 적힌 보기별 해설을 라벨별로 쪼갠다.
 * subItems 가 없는 옛 데이터의 폴백이다. 선학습과 오답노트·암기장이 같은 규칙으로 읽도록 한 곳에 둔다
 */
export function parseSubExplanations(explanation: string | null): Record<string, string> {
  if (!explanation) return {}
  const regex = new RegExp(`(?<![가-힣])([${SUB_LABEL_CHARS}])\\s*\\.\\s*\\([${OX_CHAR_CLASS}]\\)`, 'g')
  const markers: { label: string; start: number; end: number }[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(explanation))) {
    const label = SUB_LABEL_MAP[match[1]]
    if (label) markers.push({ label, start: match.index, end: match.index + match[0].length })
  }

  const result: Record<string, string> = {}
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].end
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : explanation.length
    const text = explanation.slice(textStart, textEnd).trim()
    if (text) result[markers[i].label] = text
  }

  return result
}

/** 보기 라벨을 ㄱ/가 어느 쪽으로 적었든 같은 키(ㄱ)로 본다 */
export function canonicalSubLabel(label: string): string {
  return SUB_LABEL_MAP[label] ?? label
}

/**
 * ①~⑤ 선지가 "ㄱ, ㄷ, ㄹ" 처럼 보기 라벨만 늘어놓은 조합이면 그 라벨들(ㄱ 기준 정규화)을, 아니면 null.
 * 일반 문장 선지를 조합으로 잘못 읽지 않도록 라벨·구분 기호 외의 글자가 하나라도 있으면 null 이다
 */
export function choiceSubLabels(text: string): string[] | null {
  const labels: string[] = []
  for (const ch of text) {
    if (SUB_LABEL_MAP[ch]) labels.push(SUB_LABEL_MAP[ch])
    else if (!/[\s,.·ㆍ/、]/.test(ch)) return null
  }
  return labels.length > 0 ? labels : null
}

/**
 * 내가 고른 조합과 정답 조합을 견줘, 어느 보기에서 갈렸는지.
 *  - wrongPick: 내가 골랐는데 정답 조합에는 없는 보기 (예: 정답 ㄱㄹ, 내 답 ㄱㄷㄹ → ㄷ)
 *  - missed: 정답 조합에는 있는데 내가 안 고른 보기
 * 발문이 '옳은 것'인지 '옳지 않은 것'인지와 상관없이 두 조합의 차이만 본다.
 * 조합형 문제가 아니거나 답이 같으면 빈 맵이다
 */
export function subItemDiffs(q: Question, userAnswer: string | null): Map<string, 'wrongPick' | 'missed'> {
  const out = new Map<string, 'wrongPick' | 'missed'>()
  if (!userAnswer) return out
  const labelsOf = (choiceLabel: string | undefined) => {
    const c = q.choices.find((x) => x.label === choiceLabel)
    return c ? choiceSubLabels(c.text) : null
  }
  const mine = labelsOf(selectedLabels(userAnswer)[0])
  const correctChoice = q.choices.find((c) => isAnswerLabel(q.answer, c.label))
  const correct = labelsOf(correctChoice?.label)
  if (!mine || !correct) return out
  for (const l of mine) if (!correct.includes(l)) out.set(l, 'wrongPick')
  for (const l of correct) if (!mine.includes(l)) out.set(l, 'missed')
  return out
}
