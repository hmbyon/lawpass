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

// 지문 안의 표/서식 (약속어음 앞면·뒷면, 계약서 양식, 등기부등본 등)
export interface TableRow {
  cells: string[] // 한 행의 칸들. 1칸(전체폭) / 2칸(항목·값) / 4칸(좌우 2단) 모두 가능
}

export interface TableBlock {
  title?: string // 예: "약속어음 앞면". 원본에 제목이 없으면 생략
  rows: TableRow[]
}

// 해설 본문 구성 블록. lawBox는 원본에서 테두리/배경으로 구분된 조문 인용 블록
export interface ExplanationBlock {
  type: 'text' | 'lawBox'
  title?: string // lawBox 제목 (예: "어음법 제17조(인적 항변의 절단)"). 원본에 표제가 없으면 생략
  content: string
}

// PDF 원본에서 구조화해 추출한 하위 보기 항목 (ㄱㄴㄷㄹ, 가나다라, 1·2·3 등 라벨은 원본 표기 그대로)
export interface SubItem {
  label: string
  text: string
  isCorrect: boolean
  explanation: string | ExplanationBlock[] // 원본 해설 그대로. string은 블록 구조 도입 이전 데이터
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
  choiceExplanations?: Record<string, string | ExplanationBlock[]>  // 선지별(①②③④⑤) 원문 해설 그대로. string은 블록 구조 도입 이전 데이터
  choiceExplanationSummaries?: Record<string, string>  // 선지별 AI 요약 (원문인 choiceExplanations와 별개)
  subChoiceExplanations?: Record<string, string>  // ㄱㄴㄷㄹ 보기 항목별 한 줄 설명
  subItems?: SubItem[]  // 하위 보기 항목 (구조화 추출). 없으면 지문 정규식 파싱으로 폴백
  passageTable?: TableBlock[]  // 지문 안의 표/서식. 표가 없는 문제는 생략 (앞면·뒷면처럼 여러 개일 수 있어 배열)
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
