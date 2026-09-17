import type { ExamType, Question, Subject } from './types'
import { SUBJECT_UNITS } from './units'

/**
 * 외부에서 만든 문제 JSON 을 저장할 수 있는 Question 으로 바꾼다.
 *
 * 앱의 PDF 파싱은 모델 출력을 gemini.ts 가 받아 Question 으로 옮기는데, 이 경로는 그 변환을
 * 거치지 않는다. 그래서 여기서 **저장 전에** 모양을 확인한다 — 예전에는 JSON.parse 결과를
 * 그대로 addQuestions 에 넘겨, passage 가 빠진 항목 하나가 검토 화면을 통째로 멈추게 할 수 있었다.
 *
 * 원칙:
 *  - 틀린 값은 **고치지 않고 알린다.** 하나라도 걸리면 아무것도 저장하지 않는다
 *  - id·addedAt 은 모델이 아니라 프로그램이 붙이는 값이라 외부 JSON 에 없는 것이 정상이다.
 *    gemini.ts 가 하듯 여기서 만든다
 *  - 과목·시험 구분은 문제마다 JSON 에 적힌 것을 쓴다. 한 파일에 여러 과목이 섞일 수 있다.
 *    **값이 없을 때만** 화면에서 고른 값으로 채우고, 적힌 값이 허용 밖이면 오류로 알린다
 */

const LABELS = ['①', '②', '③', '④', '⑤']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']

export interface ImportFallback {
  /** 화면에서 고른 과목. 하나만 골랐을 때만 채움값으로 쓴다 — 여럿이면 어느 것인지 모른다 */
  subjects: string[]
  examTypes: ExamType[]
  /** 허용 과목. null 이면 비어 있지만 않으면 받는다 (일반수험 모드는 과목이 자유 입력이다) */
  allowedSubjects: readonly string[] | null
}

export interface ImportResult {
  questions: Question[]
  /** 사람에게 보여줄 문제점. 하나라도 있으면 questions 는 비어 있다 */
  errors: string[]
}

export const LAW_SUBJECTS = Object.keys(SUBJECT_UNITS) as Subject[]

/** 배열, { questions: [...] }, 단일 객체를 모두 받는다 */
function itemsOf(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const inner = (parsed as { questions?: unknown }).questions
    if (Array.isArray(inner)) return inner
    return [parsed]
  }
  return null
}

/**
 * 값이 없는가. 키가 아예 없는 것뿐 아니라 null·빈 문자열도 '적힌 값이 없다'로 본다 —
 * 어느 쪽이든 과목을 말해 주는 정보가 없어, 채워도 덮어쓰는 것이 아니다
 */
const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function importQuestionsJson(text: string, fallback: ImportFallback, now: number = Date.now()): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { questions: [], errors: [`JSON 형식이 아닙니다: ${e instanceof Error ? e.message : String(e)}`] }
  }

  const items = itemsOf(parsed)
  if (!items) return { questions: [], errors: ['문제 배열을 찾지 못했습니다 (배열 또는 { "questions": [...] } 이어야 합니다)'] }
  if (items.length === 0) return { questions: [], errors: ['문제가 하나도 없습니다'] }

  const onlySubject = fallback.subjects.length === 1 ? fallback.subjects[0] : null
  const onlyExamType = fallback.examTypes.length === 1 ? fallback.examTypes[0] : null
  const subjectOk = (s: unknown): s is string =>
    typeof s === 'string' && s.trim() !== '' && (fallback.allowedSubjects === null || fallback.allowedSubjects.includes(s))

  const errors: string[] = []
  const questions: Question[] = []

  items.forEach((raw, i) => {
    const problems: string[] = []
    if (!isObj(raw)) {
      errors.push(`${i + 1}번째 항목: 객체가 아닙니다`)
      return
    }
    // 어느 문제인지 사람이 찾을 수 있게 번호를 함께 적는다
    const where = typeof raw.no === 'number' ? `${i + 1}번째 항목(${raw.no}번)` : `${i + 1}번째 항목`

    if (typeof raw.no !== 'number' || !Number.isFinite(raw.no)) problems.push(`no 가 숫자가 아닙니다 (${JSON.stringify(raw.no)})`)
    if (typeof raw.year !== 'number' || !Number.isFinite(raw.year)) problems.push(`year 가 숫자가 아닙니다 (${JSON.stringify(raw.year)})`)
    if (typeof raw.passage !== 'string' || !raw.passage.trim()) problems.push('passage 가 없거나 비어 있습니다')

    if (!Array.isArray(raw.choices)) {
      problems.push('choices 가 배열이 아닙니다')
    } else {
      raw.choices.forEach((c, ci) => {
        if (!isObj(c) || typeof c.label !== 'string' || typeof c.text !== 'string') {
          problems.push(`choices[${ci}] 가 {label, text} 모양이 아닙니다`)
        }
      })
    }

    if (typeof raw.answer !== 'string' || !LABELS.includes(raw.answer)) {
      problems.push(`answer 는 ①~⑤ 중 하나여야 합니다 (${JSON.stringify(raw.answer)})`)
    }
    // 해설이 없는 문제는 흔하다. 키가 아예 없는 것도 '없음'으로 받는다
    if (raw.explanation !== undefined && raw.explanation !== null && typeof raw.explanation !== 'string') {
      problems.push('explanation 은 문자열이거나 null 이어야 합니다')
    }

    // 과목·시험 구분은 '값이 없음'과 '값이 틀림'을 가른다.
    //  - 없으면 화면에서 하나만 고른 값으로 채운다
    //  - 적혀 있는데 허용 밖이면 채우지 않고 알린다. 합본에는 다른 과목이 섞여 있을 수 있어,
    //    '민사법' 같은 값을 화면에서 고른 '민법'으로 조용히 덮으면 민사소송법·상법 문제가
    //    민법으로 들어간다. 그건 틀린 값을 고친 것이 아니라 새 오류를 만든 것이다
    let subject: string | null = null
    if (isBlank(raw.subject)) {
      if (onlySubject) subject = onlySubject
      else problems.push('subject 가 없습니다 — 화면에서 과목을 하나만 고르면 그 값으로 채웁니다')
    } else if (subjectOk(raw.subject)) {
      subject = raw.subject
    } else {
      problems.push(`subject '${String(raw.subject)}' 은(는) 허용 값이 아닙니다 (${(fallback.allowedSubjects ?? []).join('/')})`)
    }

    let examType: ExamType | null = null
    if (isBlank(raw.examType)) {
      if (onlyExamType) examType = onlyExamType
      else problems.push('examType 이 없습니다 — 화면에서 시험 구분을 하나만 고르면 그 값으로 채웁니다')
    } else if (typeof raw.examType === 'string' && EXAM_TYPES.includes(raw.examType as ExamType)) {
      examType = raw.examType as ExamType
    } else {
      problems.push(`examType '${String(raw.examType)}' 은(는) 허용 값이 아닙니다 (변호사시험/모의고사)`)
    }

    if (problems.length > 0) {
      errors.push(`${where}: ${problems.join(' · ')}`)
      return
    }

    const no = raw.no as number
    const year = raw.year as number
    const { id: _ignoredId, addedAt: _ignoredAddedAt, ...rest } = raw
    questions.push({
      ...(rest as Partial<Question>),
      // gemini.ts 와 같은 모양으로 만들되 순번을 붙인다. 한 번에 여러 문제를 같은 시각에 만들므로
      // 시각만으로는 같은 번호의 두 문제(합본의 과목별 1번 등)가 같은 id 를 갖게 된다
      id: `${subject}_${examType}_${year}_${no}_${now}_${i}`,
      no,
      subject: subject as Subject,
      examType: examType as ExamType,
      year,
      passage: raw.passage as string,
      choices: (raw.choices as { label: string; text: string }[]).map((c) => ({ label: c.label, text: c.text })),
      answer: raw.answer as string,
      explanation: (raw.explanation as string | null | undefined) ?? null,
      addedAt: now,
    })
  })

  if (errors.length > 0) return { questions: [], errors }
  return { questions, errors: [] }
}
