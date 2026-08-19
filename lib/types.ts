export type Subject =
  | '민법'
  | '민사소송법'
  | '상법'
  | '형법'
  | '형사소송법'
  | '헌법'
  | '행정법'

export type ExamType = '변호사시험' | '모의고사'

export type QuestionStatus = '헷갈림' | '찍음' | null

export interface Choice {
  label: string // ①②③④⑤
  text: string
}

// PDF 원본에서 구조화해 추출한 하위 보기 항목 (ㄱㄴㄷㄹ, 가나다라, 1·2·3 등 라벨은 원본 표기 그대로)
export interface SubItem {
  label: string
  text: string
  isCorrect: boolean
  explanation: string // 원본 PDF에 적힌 해설 그대로. 원본에 없으면 빈 문자열
  explanationSummary?: string // AI가 생성한 1~2줄 요약 (원문인 explanation과 별개)
}

export interface Question {
  id: string
  no: number
  subject: Subject
  examType: ExamType
  year: number
  unit?: string
  passage: string
  choices: Choice[]
  answer: string // '①'~'⑤'
  explanation: string | null
  // dedup support
  explanations?: string[]
  addedAt: number
  sourceFile?: string  // 업로드한 파일명
  subChoiceAnswers?: Record<string, boolean>  // ㄱㄴㄷㄹ 보기 항목별 O/X (예: { "ㄱ": true, "ㄴ": false })
  choiceExplanations?: Record<string, string>  // 선지별(①②③④⑤) 한 줄 설명
  subChoiceExplanations?: Record<string, string>  // ㄱㄴㄷㄹ 보기 항목별 한 줄 설명
  subItems?: SubItem[]  // 하위 보기 항목 (구조화 추출). 없으면 지문 정규식 파싱으로 폴백
}

export interface ErrorAnalysis {
  핵심개념: string
  관련조문: string
  오답원인: {
    가설A: string
    가설B: string
    가설C: string
    선학습적용실패?: string
  }
  원인상세: string
  개념요약: string
  혼동주의: string
  체크포인트: string
  위험도: number // 1-5
}

export type CauseType = 'A' | 'B' | 'C' | 'study'

export interface WrongNote {
  id: string
  questionId: string
  question: Question
  userAnswer: string
  status: QuestionStatus
  isStudyMode: boolean
  analysis: ErrorAnalysis | null
  analysisHistory: ErrorAnalysis[]
  dominantCause: CauseType | null
  createdAt: number
  memo?: string
  hiddenFields?: string[]
  wrongCount: number
  totalCount: number
  isBookmarked: boolean
  choiceMemos?: Record<string, string>  // 선지별 메모 (키: ①②③④⑤)
}

export interface SessionResult {
  id: string
  mode: 'cbt' | 'study'
  subject: Subject[]
  startedAt: number
  finishedAt: number
  questions: {
    question: Question
    userAnswer: string | null
    status: QuestionStatus
    correct: boolean
  }[]
}

export interface AppState {
  apiKey: string
  questions: Question[]
  wrongNotes: WrongNote[]
}

export type FeedbackType = '버그 신고' | '기능 건의' | '기타'

export interface Feedback {
  id: string
  userId: string
  userEmail: string | null
  type: FeedbackType
  content: string
  createdAt: number
  isRead: boolean
  mode?: import('./appMode').AppMode
}
