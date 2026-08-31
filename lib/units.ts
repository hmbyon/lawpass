import type { Subject } from './types'

// AI가 "단원" 값으로 쓸 수 있는 유일한 목록.
// 이 객체가 추출 프롬프트(app/api/analyze/route.ts)에 그대로 실려 나가므로,
// 파싱 결과의 단원이 올바른지 검증할 때도 반드시 같은 목록을 기준으로 삼아야 한다.
// (components/quiz/quiz-filter.tsx에도 비슷한 목록이 있지만 그쪽은 필터 UI용 후보라
//  표기가 다르다 — 예: 상법 '총칙' vs 여기 '총칙・상행위'. 검증 기준은 이 파일이다)
export const SUBJECT_UNITS: Record<Subject, string[]> = {
  '민법': ['민법총칙', '물권법', '채권총론', '채권각론', '가족법'],
  '민사소송법': ['소송요건', '소송절차', '증거', '상소', '강제집행'],
  '상법': ['총칙・상행위', '회사법', '어음수표법', '보험법', '해상법'],
  '형법': ['범죄론', '미수론·공범론', '죄수론·형벌론', '개인적 법익에 관한 죄', '사회적 법익에 관한 죄', '국가적 법익에 관한 죄', '특별형법'],
  '형사소송법': ['수사', '공소', '공판', '증거', '상소'],
  '헌법': ['헌법총론', '기본권총론', '자유권', '사회권・참정권・청구권', '통치구조'],
  '행정법': ['행정법통론', '행정작용법・절차법', '행정구제법', '각론'],
}

// 프롬프트에 넣는 표기. 기존 프롬프트 문자열과 한 글자도 달라지면 안 되므로
// JSON.stringify의 기본 들여쓰기(배열을 여러 줄로 펼침) 대신 과목당 한 줄로 직접 만든다
export const SUBJECT_UNITS_JSON =
  '{\n' +
  Object.entries(SUBJECT_UNITS)
    .map(([subject, units]) => `  ${JSON.stringify(subject)}: [${units.map((u) => JSON.stringify(u)).join(', ')}]`)
    .join(',\n') +
  '\n}'

// 비교 전 공백만 지운다. "총 론"과 "총론"은 같은 단원이지만, 그 이상 느슨하게 풀면
// (구분자·괄호까지 지우면) 서로 다른 단원이 같은 것으로 뭉개질 수 있다
function normalizeUnit(unit: string): string {
  return unit.replace(/\s+/g, '')
}

/**
 * 이 단원 값이 가리키는 정식 단원. 없으면 null.
 *
 * 정확 일치를 먼저 본다. 그다음에만 과목명 접두어를 떼고 한 번 더 본다 —
 * 모델이 행정법의 "총론"을 "행정법총론"으로 적어 보내는 일이 있는데, 프롬프트가 금지한
 * 형태이긴 해도 어느 단원을 말하는지는 분명하다.
 *
 * 순서가 뒤바뀌면 안 된다. "민법총칙"은 민법의 정식 단원인데, 접두어부터 떼면 "총칙"이
 * 되어 목록에 없는 값이 되어버린다.
 *
 * 접두어를 뗀 나머지가 비면(단원이 과목명 그 자체이면) 인정하지 않는다.
 * 프롬프트가 따로 금지하고 있는 형태이고, 어느 단원인지도 알 수 없다.
 */
export function canonicalUnit(subject: Subject, unit: string | undefined): string | null {
  if (!unit?.trim()) return null
  const list = SUBJECT_UNITS[subject] ?? []
  const key = normalizeUnit(unit)

  const exact = list.find((u) => normalizeUnit(u) === key)
  if (exact) return exact

  const prefix = normalizeUnit(subject)
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  if (!rest) return null
  return list.find((u) => normalizeUnit(u) === rest) ?? null
}

export function isValidUnit(subject: Subject, unit: string | undefined): boolean {
  return canonicalUnit(subject, unit) !== null
}
