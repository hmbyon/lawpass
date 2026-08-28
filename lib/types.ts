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
  // 모델이 과목을 판정하지 못했고 후보가 둘 이상이라 첫 후보에 임시로 담은 경우에만 true.
  // 연도 미상(year=0)과 같은 취지다 — 버리지 않고 눈에 띄게 남겨 사람이 고치게 한다
  subjectUnsure?: boolean
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
  choiceIsCorrectStatement?: Record<string, boolean>  // 선지(①②③④⑤) 문장 자체의 참/거짓. 정답 여부(answer)와는 별개
  choiceExplanations?: Record<string, string | ExplanationBlock[]>  // 선지별(①②③④⑤) 원문 해설 그대로. string은 블록 구조 도입 이전 데이터
  choiceExplanationSummaries?: Record<string, string>  // 선지별 AI 요약 (원문인 choiceExplanations와 별개)
  subChoiceExplanations?: Record<string, string>  // ㄱㄴㄷㄹ 보기 항목별 한 줄 설명
  subItems?: SubItem[]  // 하위 보기 항목 (구조화 추출). 없으면 지문 정규식 파싱으로 폴백
  passageTable?: TableBlock[]  // 지문 안의 표/서식. 표가 없는 문제는 생략 (앞면·뒷면처럼 여러 개일 수 있어 배열)
  // 이 문제가 확인된 원본 PDF의 페이지 구간 (1-based, 양끝 포함).
  // 문제 하나가 정확히 몇 쪽인지가 아니라 "이 구간 안에 있었다"는 뜻이다 —
  // Gemini에 보낸 청크의 범위를 그대로 적기 때문이다. 청크는 보통 1~6쪽이라
  // 결번 재파싱에서 다시 보낼 구간을 잡기에 충분하다.
  // 페이지를 알 수 없는 경로(URI 업로드)나 이 필드 도입 이전 데이터에는 없다
  pageFrom?: number
  pageTo?: number
  // 공유받은 문제집에서 온 문항임을 밝히는 표시 (pools/{poolId}).
  // 혜민이 발행할 때 '사본에만' 심는다 — 자기 문제에는 붙지 않는다.
  // 회수해도 오답노트·세션에 남는 사본이 어디서 왔는지 이 값으로 알 수 있어야,
  // 나중에 정리 정책을 바꿀 여지가 생긴다 (docs/shared-pool-design.md §4.3)
  poolId?: string
}

export interface ErrorAnalysis {
  핵심개념: string
  관련조문: string
  관련판례?: string // 관련 판례가 없거나 불확실하면 비어 있다 (화면에서 섹션 자체가 숨겨짐)
  오답원인: {
    // 새 구조: 가장 유력한 원인 하나만 판정해 깊이 분석한다
    판정?: CauseType
    원인명?: string
    상세분석?: string
    // 구버전 구조 (읽기 호환용). 새로 분석하면 채워지지 않는다
    가설A?: string
    가설B?: string
    가설C?: string
    선학습적용실패?: string
  }
  원인상세: string
  개념요약: string
  혼동주의: string
  체크포인트: string
  위험도: number // 1-5
}

export type CauseType = 'A' | 'B' | 'C' | 'study'

export const CAUSE_LABELS: Record<CauseType, string> = {
  A: '개념부족',
  B: '암기혼동',
  C: '지문오독',
  study: '선학습 적용 실패',
}

// 신·구 구조를 모두 흡수해 "원인 하나"로 정규화한다.
// 옛 데이터는 dominantCause(또는 가장 긴 가설)를 골라 그 텍스트만 보여준다
export function resolveErrorCause(
  analysis: ErrorAnalysis,
  dominantCause?: CauseType | null
): { cause: CauseType; 원인명: string; 상세분석: string } | null {
  const 원인 = analysis.오답원인
  if (!원인) return null

  if (원인.판정) {
    return {
      cause: 원인.판정,
      원인명: 원인.원인명?.trim() || CAUSE_LABELS[원인.판정],
      상세분석: 원인.상세분석?.trim() || analysis.원인상세 || '',
    }
  }

  // ── 구버전 데이터 ──
  const 후보: { cause: CauseType; text: string }[] = [
    { cause: 'A', text: 원인.가설A ?? '' },
    { cause: 'B', text: 원인.가설B ?? '' },
    { cause: 'C', text: 원인.가설C ?? '' },
  ]
  if (원인.선학습적용실패 && 원인.선학습적용실패 !== 'null' && 원인.선학습적용실패 !== '-') {
    후보.push({ cause: 'study', text: 원인.선학습적용실패 })
  }

  const picked =
    후보.find((c) => c.cause === dominantCause) ??
    후보.reduce((a, b) => (a.text.length >= b.text.length ? a : b), 후보[0])

  if (!picked || !picked.text.trim()) return null
  return { cause: picked.cause, 원인명: CAUSE_LABELS[picked.cause], 상세분석: picked.text }
}

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
  manuallyAddedToMemo?: boolean // 자동 조건과 무관하게 사용자가 직접 D-1 암기장에 넣은 문제
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
  adminReply?: string   // 관리자 답글
  repliedAt?: number    // 답글 등록 시각
  replyReadByUser?: boolean  // 사용자가 답글을 확인했는지 (미설정이면 안 읽음)
}
