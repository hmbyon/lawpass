import type { CaseRef, Question } from './types'

/**
 * 해설에 인용된 판례를 판례 단위로 모은다.
 *
 * 문제는 판례를 여러 개 인용하고, 같은 판례가 여러 문제에 나온다. 그 관계를 뒤집어
 * "이 판례가 몇 문제에 나왔나"로 세우는 것이 이 모듈의 일이다.
 */

// 최근 판례로 볼 기간. 이보다 오래된 것은 목록에서 빼되, 몇 건을 뺐는지는 화면에 남긴다
const RECENT_YEARS = 5

/**
 * 사건번호를 묶음 키로 바꾼다.
 *
 * 같은 판례라도 표기가 갈린다 — "2014다12345", "2014 다 12345", "2014다12345 판결",
 * 앞에 법원이나 선고일이 붙어 오기도 한다. 그대로 키로 쓰면 같은 판례가 여러 줄로 흩어진다.
 *
 * 사건번호의 뼈대는 '연도 + 사건부호 + 일련번호'다(2014다12345, 2019헌바13).
 * 그 세 토막을 뽑아 붙이는 것이 가장 확실하다. 뽑히지 않으면(형식이 다른 표기) 공백만
 * 지우고 그대로 쓴다 — 못 알아본 것을 억지로 합치면 다른 판례가 한 줄로 뭉친다.
 *
 * 지문 정규화(passageMatch.ts)와 달리 여기서는 글자를 지운다. 사건번호는 자연어가 아니라
 * 정해진 형식이라, 뼈대만 같으면 같은 판례로 봐도 안전하다
 */
const CASE_NUMBER = /(\d{4})\s*([가-힣]{1,4})\s*(\d+)/

export function normalizeCaseNumber(caseNumber: string): string {
  const m = CASE_NUMBER.exec(caseNumber ?? '')
  if (m) return `${m[1]}${m[2]}${m[3]}`
  return (caseNumber ?? '').replace(/\s+/g, '')
}

/** 선고일 문자열에서 연도만 뽑는다 ("2015. 3. 12." → 2015). 못 읽으면 null */
export function decidedYear(decidedDate: string | undefined): number | null {
  const m = /(\d{4})/.exec(decidedDate ?? '')
  if (!m) return null
  const year = Number(m[1])
  return year >= 1900 && year <= 2100 ? year : null
}

export interface CaseGroup {
  key: string // 정규화한 사건번호
  caseNumber: string // 화면에 보여줄 표기 (가장 먼저 만난 것)
  decidedDate?: string
  court?: string
  summary: string // 대표 요지. 문제마다 조금씩 다르게 요약될 수 있어 가장 긴 것을 쓴다
  otherSummaries: number // 대표와 다른 요지가 몇 개 더 있는지
  year: number | null
  questions: Question[] // 이 판례를 인용한 문제들
  count: number
}

export interface CaseDigest {
  recent: CaseGroup[] // 최근 5년
  undated: CaseGroup[] // 선고일을 알 수 없는 것
  olderCount: number // 5년보다 오래돼 목록에서 뺀 판례 수
  totalGroups: number // 전체 판례 수 (숨긴 것 포함)
  questionsWithCases: number // 판례가 하나라도 달린 문제 수
}

function pick(list: string[]): { summary: string; otherSummaries: number } {
  const uniq = Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)))
  if (uniq.length === 0) return { summary: '', otherSummaries: 0 }
  // 가장 긴 요약을 대표로 둔다. 짧은 쪽은 대개 앞부분만 적힌 것이다
  const longest = uniq.reduce((best, s) => (s.length > best.length ? s : best), uniq[0])
  return { summary: longest, otherSummaries: uniq.length - 1 }
}

export function buildCaseDigest(questions: Question[], now: Date = new Date()): CaseDigest {
  const groups = new Map<string, { refs: CaseRef[]; questions: Question[] }>()
  let questionsWithCases = 0

  for (const q of questions) {
    if (!q.cases?.length) continue
    questionsWithCases++
    // 한 문제가 같은 판례를 두 번 인용해도 출제횟수는 1이다
    const seen = new Set<string>()
    for (const c of q.cases) {
      const key = normalizeCaseNumber(c.caseNumber)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const found = groups.get(key)
      if (found) {
        found.refs.push(c)
        found.questions.push(q)
      } else {
        groups.set(key, { refs: [c], questions: [q] })
      }
    }
  }

  const all: CaseGroup[] = Array.from(groups.entries()).map(([key, g]) => {
    const { summary, otherSummaries } = pick(g.refs.map((r) => r.summary))
    // 선고일·법원은 비어 있는 사본이 섞이므로, 적혀 있는 것 중 첫 번째를 쓴다
    const decidedDate = g.refs.find((r) => r.decidedDate?.trim())?.decidedDate
    return {
      key,
      caseNumber: g.refs[0].caseNumber,
      decidedDate,
      court: g.refs.find((r) => r.court?.trim())?.court,
      summary,
      otherSummaries,
      year: decidedYear(decidedDate),
      questions: g.questions,
      count: g.questions.length,
    }
  })

  // 많이 나온 판례가 먼저. 같으면 최신 선고일, 그다음 사건번호로 순서를 고정한다
  const byCount = (a: CaseGroup, b: CaseGroup) =>
    b.count - a.count || (b.year ?? 0) - (a.year ?? 0) || a.key.localeCompare(b.key)

  const cutoff = now.getFullYear() - RECENT_YEARS
  const dated = all.filter((g) => g.year !== null)
  return {
    recent: dated.filter((g) => (g.year as number) >= cutoff).sort(byCount),
    undated: all.filter((g) => g.year === null).sort(byCount),
    olderCount: dated.filter((g) => (g.year as number) < cutoff).length,
    totalGroups: all.length,
    questionsWithCases,
  }
}
