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
  '형법': ['총론', '각론', '특별형법'],
  '형사소송법': ['수사', '공소', '공판', '증거', '상소'],
  '헌법': ['총론', '기본권', '통치구조'],
  '행정법': ['총론', '각론'],
}

// 프롬프트에 넣는 표기. 기존 프롬프트 문자열과 한 글자도 달라지면 안 되므로
// JSON.stringify의 기본 들여쓰기(배열을 여러 줄로 펼침) 대신 과목당 한 줄로 직접 만든다
export const SUBJECT_UNITS_JSON =
  '{\n' +
  Object.entries(SUBJECT_UNITS)
    .map(([subject, units]) => `  ${JSON.stringify(subject)}: [${units.map((u) => JSON.stringify(u)).join(', ')}]`)
    .join(',\n') +
  '\n}'

export function isValidUnit(subject: Subject, unit: string | undefined): boolean {
  if (!unit?.trim()) return false
  return (SUBJECT_UNITS[subject] ?? []).includes(unit.trim())
}
