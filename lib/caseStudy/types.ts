/**
 * 사례형 카드 데이터 (schema 1). 구조·경로는 docs/case-study-design.md.
 * 카드 내용은 저장소에 두지 않는다 — 관리자가 가져오기 화면으로 Firestore 에 올린다
 */

export type CaseSubject = string

// 모범답안 한 줄. h1 = Ⅰ.Ⅱ. 큰목차, h2 = 소목차, p = 본문.
// html 은 mark(law|case|res)·u·b·br 만 쓴다 — 렌더 전에 sanitize.ts 를 반드시 거친다
export interface Block {
  t: 'h1' | 'h2' | 'p'
  lv?: 'l2' | 'l3'
  pts?: string
  html: string
}

export interface Problem {
  id: string // '10d-1#1' — 2단계 풀이·채점 기록의 키로 그대로 쓴다
  kind: '변시' | '모의'
  exam: number | string // 변시는 11~15, 모의는 '26.1' 형태
  examLabel: string
  qno: string // '제2문의 2'
  sub: string // '문1' 또는 ''
  points: number
  // 있으면 답안이 다른 카드에 있다. 그때 brief/question/answer 는 없다
  stubFor?: { card: string; problem: string }
  note?: string
  brief?: string[]
  question?: { paragraphs: string[]; ask: string }
  answer?: { source: string; blocks: Block[] }
  // 이 문항 모범답안이 인용한 판례번호, 원문 표기 그대로(v1.1). 정규화는 caseDigest.normalizeCaseNumber.
  // v1 데이터에는 없다 — 읽을 때 [] 로 채운다(lib/firebaseServices/caseStudy.ts)
  cases?: string[]
}

export interface Card {
  schema: 1
  id: string
  subject: CaseSubject
  category: string
  chapter: string
  order: [number, number]
  title: string
  pages: string
  meta: string
  problems: Problem[]
  notes: string[]
  source: string
  cases: string[]
  statutes: string[]
}

// 색인의 stubFor 는 실제 _index.json 에서 문항 id 문자열('4-2#3')로 온다. 카드 쪽 모양({card, problem})도 받는다
export type IndexProblem = Pick<Problem, 'id' | 'kind' | 'exam' | 'qno' | 'points' | 'cases'> & {
  sub?: string
  stubFor?: Problem['stubFor'] | string
}

export interface IndexCard {
  id: string
  subject: CaseSubject
  category: string
  chapter: string
  order: [number, number]
  title: string
  pages: string
  // 이 카드가 인용한 판례번호(v1.1, 원문 표기). v1 색인에는 없다
  cases?: string[]
  problems: IndexProblem[]
}

// _index.json
export interface CaseIndex {
  schema: 1
  cards: IndexCard[]
}
