import type { Question } from './types'

/**
 * 문제가 어느 시험에서 나온 것인지 한 줄로 적는다.
 *
 * 저장된 값은 examType('변호사시험'|'모의고사')·year·sourceFile 셋뿐이다. 회차도 시행월도
 * 따로 저장되지 않으므로, 회차는 연도에서 역산하고 시행월은 파일명에서 읽는다.
 * 스키마를 늘리지 않아 이미 저장된 문제에도 그대로 적용된다.
 */

// 변호사시험 제1회가 2012년. route.ts 프롬프트가 회차를 검산할 때 쓰는 것과 같은 관례다
const FIRST_BAR_EXAM_YEAR = 2011

/**
 * 파일명에서 모의고사 시행월을 읽는다. 변시 모의고사는 6·8·10월 세 차례뿐인데
 * 부르는 이름이 갈린다 — "6모", "6월 모의시험", "1차 모의고사"(1차=6월).
 *
 * 세 규칙 모두 '모'나 '모의'라는 글자를 요구한다. 그게 없으면 "민법 6문제"나
 * "6월 특강"까지 6월 모의고사로 읽힌다. 앞자리에 숫자가 더 붙는 경우도 막는다 —
 * "16회 모의"의 16을 6으로 읽으면 안 된다
 */
export function examMonthOf(sourceFile: string | undefined): 6 | 8 | 10 | null {
  const s = sourceFile ?? ''
  // "6모" — 뒤에 '의'가 오면 "6모의고사"가 아니라 다른 말일 수 있어 제외한다
  const short = /(?:^|[^0-9])(6|8|10)\s*모(?![의])/.exec(s)
  if (short) return Number(short[1]) as 6 | 8 | 10
  const spelled = /(6|8|10)\s*월\s*모의/.exec(s)
  if (spelled) return Number(spelled[1]) as 6 | 8 | 10
  const ordinal = /([123])\s*차\s*모의/.exec(s)
  if (ordinal) return ([6, 8, 10] as const)[Number(ordinal[1]) - 1]
  return null
}

/** 변호사시험 회차. 연도를 모르면 null */
export function barExamRound(year: number): number | null {
  if (!year || year <= FIRST_BAR_EXAM_YEAR) return null
  return year - FIRST_BAR_EXAM_YEAR
}

/**
 * 파일명이 문구에 없는 정보를 더 갖고 있는가.
 *
 * "6모"라는 파일명은 "2024년 6모" 옆에 괄호로 또 적을 이유가 없다. 그런데 "유니온 6모객"의
 * '유니온'은 같은 회차의 다른 판본과 가르는 유일한 단서라 버리면 안 된다.
 * 그래서 문구가 이미 담은 토막(연도·월·시험 이름)을 지워 보고, 남는 글자가 있으면 붙인다
 */
function addsInfo(sourceFile: string, year: number, month: number | null): boolean {
  let rest = sourceFile
  if (month) {
    rest = rest
      .replace(/(?:^|[^0-9])(6|8|10)\s*모(?![의])/g, ' ')
      .replace(/(6|8|10)\s*월\s*모의(고사|시험)?/g, ' ')
      .replace(/([123])\s*차\s*모의(고사|시험)?/g, ' ')
  }
  rest = rest
    .replace(/모의(고사|시험)?/g, ' ')
    .replace(/변호사시험|변시/g, ' ')
    .replace(/제?\s*\d+\s*회/g, ' ')
    .replace(/(20\d{2}|\d{2})\s*년?도?/g, ' ')
    // 객관식·주관식 표기는 판본을 가르는 정보가 아니다
    .replace(/객관식|주관식|[객주]\b/g, ' ')
  if (year) rest = rest.replace(new RegExp(String(year), 'g'), ' ')
  return rest.replace(/[\s.,_\-()[\]]/g, '').length > 0
}

/**
 * 출처 한 줄. 정보가 없으면 그만큼만 줄여 적는다 —
 * 모르는 자리를 '미상' 같은 말로 채우면 줄만 길어지고 읽는 데 도움이 안 된다
 */
export function sourceLabel(q: Pick<Question, 'examType' | 'year' | 'sourceFile'>): string {
  const file = (q.sourceFile ?? '').trim()

  if (q.examType === '변호사시험') {
    const round = barExamRound(q.year)
    const base = round ? `${round}회 변시` : '변시'
    return file && addsInfo(file, q.year, null) ? `${base}(${file})` : base
  }

  const month = examMonthOf(file)
  if (month) {
    const base = q.year ? `${q.year}년 ${month}모` : `${month}모`
    return file && addsInfo(file, q.year, month) ? `${base}(${file})` : base
  }
  // 월을 못 읽었으면 파일명이 유일한 단서다. 연도라도 있으면 앞에 세운다
  if (q.year) return file ? `${q.year}년 모의고사(${file})` : `${q.year}년 모의고사`
  return file || '모의고사'
}

export interface SourceBucket {
  label: string
  questions: Question[]
}

/**
 * 출처별로 묶는다. 판례 하나가 여러 회차에 걸쳐 나오는 것이 이 화면의 핵심이라,
 * 문제번호만 늘어놓으면 어느 시험 것인지 알 수 없다.
 *
 * 순서는 문제를 만난 순서를 따르고, 묶음 안은 문제번호순으로 세운다
 */
export function groupBySource(questions: Question[]): SourceBucket[] {
  const buckets = new Map<string, Question[]>()
  for (const q of questions) {
    const label = sourceLabel(q)
    const found = buckets.get(label)
    if (found) found.push(q)
    else buckets.set(label, [q])
  }
  return Array.from(buckets.entries()).map(([label, list]) => ({
    label,
    questions: [...list].sort((a, b) => Number(a.no) - Number(b.no)),
  }))
}
