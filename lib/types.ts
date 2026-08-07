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
  dominantCause: CauseType | null
  createdAt: number
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
