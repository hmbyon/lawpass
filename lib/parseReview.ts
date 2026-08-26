import type { Question, Subject } from './types'
import { SUBJECT_UNITS, isValidUnit } from './units'

// 결번 목록이 길어지면 UI가 감당하지 못하므로 표시 개수를 제한한다
const MAX_MISSING_SHOWN = 20
// 번호가 하나뿐이면 연속성을 논할 수 없다
const MIN_COUNT_FOR_GAP_CHECK = 2
// 앞뒤가 잘렸는지는 번호만으로는 알 수 없다. 같은 과목·시험구분의 다른 회차가
// 이만큼 있으면 그 회차들의 첫 번호·마지막 번호를 기준으로 삼는다
const MIN_SIBLINGS_FOR_EDGE = 2
// 형제들의 마지막 번호가 이 비율을 넘게 벌어져 있으면 "이 시험은 몇 번까지"라는
// 전제 자체가 없는 것이다. 단원별 문제집이 그렇다 — 단원마다 문항 수가 다른 게 정상이다.
// 그럴 땐 추정을 포기한다 (UI가 '마지막 번호는 확인 불가'로 밝힌다)
const TAIL_SPREAD_RATIO = 0.2

// 연도를 확인하지 못한 문제는 year가 0으로 저장된다 (gemini.ts의 resolveYear)
export const UNKNOWN_YEAR = 0
// 한 연도가 이 비율을 넘으면 "쏠림"으로 본다. 여러 회차 기출 모음이라면 파싱 오류 신호다
const YEAR_DOMINANT_RATIO = 0.7
// 변호사시험 제1회가 2012년. 그 이전 연도는 기출로 존재하지 않는다
const EARLIEST_YEAR = 2010

// 한 문제가 확인된 원본 PDF 구간. Question.pageFrom/pageTo를 번호별로 모은 것
export interface QuestionPage {
  no: number
  from: number
  to: number
}

/**
 * 빠진 번호 한 덩어리와 그에 대한 판정.
 *
 * 결번을 낱개 번호가 아니라 덩어리로 보는 이유는, 판정 근거가 덩어리 단위로만 생기기 때문이다.
 * "6,7번이 없다"는 사실만으로는 유실인지 발췌인지 알 수 없지만,
 * "5번은 1쪽, 8번은 2쪽" 이라는 사실을 보태면 갈린다 — 6·7번이 들어갈 쪽이 없다.
 */
export interface Gap {
  kind: 'head' | 'interior' | 'tail'
  from: number // 빠진 첫 번호
  to: number // 빠진 마지막 번호
  // excerpt  애초에 실리지 않은 번호로 보임 (빠진 자리에 빈 쪽이 없다)
  // suspect  파싱에서 놓친 것으로 보임 (빈 쪽이 있거나, 형제 회차가 더 있다)
  // unknown  페이지 기록이 없어 판단할 수 없음. 조용히 넘기지 않고 그대로 남긴다
  verdict: 'excerpt' | 'suspect' | 'unknown'
  reason: string // 왜 그렇게 봤는지. 화면에 그대로 나간다
  // suspect일 때 다시 파싱할 쪽 구간. 양끝 문제가 있던 쪽까지 포함한다
  // (한 쪽에 여러 문제가 실리므로 빈 쪽만 보내면 경계에 걸친 문제를 놓친다)
  pageFrom?: number
  pageTo?: number
}

// 한 '번호 런'의 연속성 점검 결과.
//
// 예전에는 과목·시험구분·연도(= 회차)로 묶었다. 회차별 기출 문제집에서는 그게 맞았지만
// 단원별 문제집에서는 무너진다. 한 단원 안에 여러 해의 문제가 1번부터 다시 번호를 달고
// 섞여 들어오기 때문에, 연도로 묶으면 번호가 뒤엉켜 있지도 않은 결번이 무더기로 뜬다.
//
// 그래서 이제는 연도를 묶는 기준에서 뺐다. 파일 안에서 페이지 순으로 세운 뒤,
// 번호가 뒤로 돌아가는 자리에서 자른다. 그 한 토막이 런이고, 회차별 문제집에서는
// 런이 곧 회차가 되므로 기존 동작이 그대로 유지된다.
//
// 결번은 "범위 안 결번"만 보지 않는다. 존재하는 번호에서 min/max를 뽑으면 앞뒤가
// 통째로 잘린 경우는 애초에 범위에 들어오지 않아 조용히 넘어가기 때문이다
export interface GroupCheck {
  runId: string // 런의 고유 식별자 (화면 key·재파싱 대상 구분용)
  runIndex: number // 이 파일·과목·시험구분 안에서 몇 번째 런인지 (0부터)
  subject: Subject
  examType: string
  // 이 런에서 가장 많이 나온 연도. **표시용일 뿐 묶는 기준이 아니다.**
  // 단원별 문제집처럼 한 런에 여러 해가 섞이면 yearMixed가 참이 된다
  year: number
  yearMixed: boolean // 런 안에 연도가 둘 이상
  count: number
  min: number
  max: number
  nos: number[] // 실제로 확인된 번호 (오름차순) — 재파싱할 페이지를 추정할 때 쓴다
  // 페이지를 아는 문제만 번호순으로. 페이지 기록 도입 이전에 파싱된 문제집은 비어 있다
  pages: QuestionPage[]
  pageFrom: number | null // 이 런에서 확인된 가장 이른 쪽
  pageTo: number | null // 가장 늦은 쪽
  sourceFile: string | null // 이 런이 나온 파일. 런은 정의상 한 파일에서만 나온다
  interior: number[] // min~max 사이에서 빠진 번호 (전체)
  // 빠진 번호를 덩어리로 묶고 하나하나 판정한 것. head·interior·tail을 한 종류로 다룬다.
  // interior 필드와 같은 사실을 다르게 보여줄 뿐이라 둘은 언제나 아귀가 맞아야 한다
  gaps: Gap[]
  expectedMin: number | null // 형제 런들로 추정한 첫 번호. null이면 '몇 번부터인지 알 수 없음'
  headMissing: number // expectedMin부터 min-1번까지 몇 개가 없는지 (근거가 없으면 0)
  expectedMax: number | null // 형제 런들로 추정한 마지막 번호
  tailMissing: number // expectedMax까지 몇 개가 없는지
  // 이 런을 한마디로. 예전의 sparse(결번 비율)를 대신한다.
  // 비율은 애초에 틀린 도구였다 — 런으로 자르고 나면 발췌본도 국소적으로는 촘촘해서
  // 어떤 비율을 잡아도 발췌와 유실이 갈리지 않는다. 이제는 덩어리별 판정을 모아서 정한다
  //   ok       빠진 번호가 없음
  //   excerpt  빠진 번호는 있으나 전부 '애초에 안 실린 것'으로 판정됨 (경고 아님)
  //   unknown  판단 근거가 없는 덩어리가 있음 (조용히 넘기지 않는다)
  //   suspect  파싱에서 놓친 것으로 보이는 덩어리가 있음
  verdict: 'ok' | 'excerpt' | 'unknown' | 'suspect'
  ok: boolean // verdict === 'ok'. 빠진 번호가 하나도 없다는 뜻
}

export interface UnitCount {
  subject: Subject
  unit: string
  count: number
  valid: boolean // 해당 과목의 유효 단원 목록에 있는 값인지
  questions: Question[]
}

export interface YearCount {
  year: number // 0이면 연도 미상
  count: number
  ratio: number
  questions: Question[]
  problem: 'unknown' | 'future' | 'tooOld' | null
}

export interface ParseReview {
  total: number
  groups: GroupCheck[]
  // 연도를 확인하지 못한 문항 수.
  // 예전에는 이 문제들을 결번 검사에서 통째로 뺐다. 연도가 그룹을 나누는 기준이었기 때문인데,
  // 런으로 자르는 지금은 연도가 기준이 아니므로 뺄 이유가 없다. 오히려 빼면 그 번호들이
  // 가짜 결번으로 잡히거나(사이사이 섞인 경우) 검사 자체가 반쪽이 된다(뒤쪽이 통째로 미상인 경우).
  // 이제는 함께 검사하고, 이 수는 '연도를 지정해달라'는 안내로만 쓴다
  unknownYearCount: number
  // 번호가 하나뿐이라 연속성을 논할 수 없어 검사에서 뺀 런의 수.
  // 이걸 세지 않으면 '많이 잃을수록 조용해지는' 함정으로 되돌아간다
  singletonRuns: number
  // 같은 문제가 두 벌 저장된 것. 문제 id → 그 무리의 크기.
  // 2026-08-24 이전에는 병합 키에 연도가 들어 있어서, 같은 문제를 두 청크가 다른 연도로
  // 판정하면 후보 자체가 갈려 비교조차 되지 않은 채 두 번 저장됐다. 지금 코드는 같은 사고를
  // 내지 않지만 이미 쌓인 것은 저절로 사라지지 않는다. 사람이 찾아 지울 수 있게 표시만 한다
  duplicateIds: Record<string, number>
  units: UnitCount[]
  years: YearCount[]
  yearDominant: YearCount | null // 70% 이상을 차지하는 연도 (있을 때만)
  hasWarning: boolean
}

// 같은 문제인지 보는 최소 규칙. store.ts의 isSameQuestion과 같은 판정이지만,
// 이 파일은 localStorage를 건드리지 않는 순수 모듈로 두려고 일부러 옮겨 적었다.
// (규칙을 바꿀 일이 생기면 두 곳을 함께 고쳐야 한다)
const MIN_PASSAGE_FOR_PREFIX = 40

function sameText(a: Question, b: Question): boolean {
  const pa = a.passage.replace(/\s+/g, ' ').trim()
  const pb = b.passage.replace(/\s+/g, ' ').trim()
  if (pa === pb) return true
  const [shorter, longer] = pa.length <= pb.length ? [pa, pb] : [pb, pa]
  return shorter.length >= MIN_PASSAGE_FOR_PREFIX && longer.startsWith(shorter)
}

/**
 * 같은 문제가 두 벌 저장된 것을 찾는다.
 *
 * 번호만으로는 안 된다 — 회차별 문제집은 회차마다 1번부터 다시 시작하므로 같은 번호가
 * 여러 벌 있는 게 정상이다. 그래서 과목·시험구분·번호가 같은 것들 중에서 **지문까지 같은**
 * 것들만 한 무리로 묶는다.
 */
function findDuplicates(questions: Question[]): Record<string, number> {
  const byNo = new Map<string, Question[]>()
  for (const q of questions) {
    const no = Number(q.no)
    if (!Number.isFinite(no) || no <= 0) continue
    const key = `${q.subject}|${q.examType}|${no}`
    const list = byNo.get(key)
    if (list) list.push(q)
    else byNo.set(key, [q])
  }

  const out: Record<string, number> = {}
  for (const list of byNo.values()) {
    if (list.length < 2) continue
    const clusters: Question[][] = []
    for (const q of list) {
      const found = clusters.find((c) => c.some((o) => sameText(o, q)))
      if (found) found.push(q)
      else clusters.push([q])
    }
    for (const c of clusters) {
      if (c.length < 2) continue
      for (const q of c) out[q.id] = c.length
    }
  }
  return out
}

// 파일명이 없는 문제들끼리는 한 덩어리로 본다. 파일을 모른다는 것 자체가 하나의 출처다
const NO_SOURCE_FILE = '(파일 미상)'

// 런을 나누는 첫 단계. 연도는 들어가지 않는다 — 그게 이번 변경의 핵심이다
function bucketKey(q: Question) {
  return `${q.sourceFile ?? NO_SOURCE_FILE}|${q.subject}|${q.examType}`
}

// 하한(lower median). 형제가 둘이면 작은 쪽을 택해 과하게 경고하지 않는다
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function missingBetween(present: Set<number>, from: number, to: number): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n++) if (!present.has(n)) out.push(n)
  return out
}

// 순서를 정하는 데 필요한 것만 요구한다. 덕분에 Question을 짓지 않고도 시험할 수 있다
export interface PagedItem {
  pageFrom?: number
  pageTo?: number
}

/**
 * 번호 런을 자르기 전에, 문제들을 '원본 PDF에서 놓여 있던 순서'로 세운다.
 *
 * 기준은 파싱 때 기록된 페이지다. 그런데 페이지를 모르는 문제가 섞일 수 있다 —
 * 페이지 기록 도입 이전에 파싱된 문제집이거나, 페이지를 알 수 없는 경로로 들어온 경우다.
 * 그런 문제를 맨 뒤로 밀거나 맨 앞에 세우면 없던 번호 역행이 생겨 런이 엉뚱하게 잘린다.
 *
 * 그래서 페이지가 없는 문제는 **저장 배열 순서상 바로 앞 문제의 페이지를 물려받는다.**
 * 저장 배열 순서는 addQuestions가 파싱한 순서 그대로 밀어 넣은 것이라, 페이지 기록이
 * 없던 시절에도 사실상 원본 순서다. 규칙 하나로 세 경우가 다 풀린다.
 *   - 전부 페이지 있음 → 순수 페이지 순
 *   - 전부 페이지 없음 → 물려받을 값이 모두 같아져 저장 배열 순서 그대로 (옛 데이터 폴백)
 *   - 섞임            → 아는 것끼리는 페이지 순, 모르는 것은 직전 문제 바로 뒤
 *
 * 물려받을 때 pageFrom뿐 아니라 pageTo까지 함께 가져간다. from만 물려받으면
 * 10~15쪽 청크 다음에 온 '페이지 모르는 문제'가 (10,10)이 되어 정작 그 청크(10,15)보다
 * 앞서는 뒤집힘이 생긴다.
 *
 * 원본 배열은 건드리지 않고 새 배열을 돌려준다.
 */
export function orderForRuns<T extends PagedItem>(list: T[]): T[] {
  // 저장 순서대로 훑으며 '지금까지 확인된 마지막 페이지'를 흘려보낸다
  let carriedFrom = 0
  let carriedTo = 0
  const keyed = list.map((item, index) => {
    if (item.pageFrom !== undefined) {
      carriedFrom = item.pageFrom
      carriedTo = item.pageTo ?? item.pageFrom
    }
    return { item, index, from: carriedFrom, to: carriedTo }
  })

  // index를 마지막 기준으로 두어, 같은 페이지 안에서는 저장 순서가 그대로 유지된다
  keyed.sort((a, b) => a.from - b.from || a.to - b.to || a.index - b.index)
  return keyed.map((k) => k.item)
}

/**
 * 이 런의 뒷부분이 잘렸는지 견줄 형제 런들의 마지막 번호.
 *
 * 회차 기준으로 묶던 시절에는 "같은 과목·시험구분의 다른 연도"면 곧 다른 회차였다.
 * 런 기준에서는 그렇지 않다. 단원별 문제집의 각 단원도 여기 걸려들어, 문항 수가 다른
 * 단원끼리 서로를 회차로 착각한다 (30문·20문·45문이면 20문짜리에 뒷잘림 경고가 뜬다).
 *
 * 그래서 연도가 하나로 정해지는 런만 형제로 인정한다. 여러 해가 섞인 런은 회차가 아니라
 * 단원 토막일 가능성이 높고, 그런 토막끼리는 문항 수를 견줄 근거가 없다.
 */
function siblingsOf(r: Run, runs: Run[]): Run[] {
  if (r.yearMixed || r.year === UNKNOWN_YEAR) return []
  return runs.filter(
    (o) =>
      o.subject === r.subject &&
      o.examType === r.examType &&
      !o.yearMixed &&
      o.year !== UNKNOWN_YEAR &&
      o.year !== r.year
  )
}

// 형제가 충분하고, 그 형제들이 서로 비슷할 때만 마지막 번호를 추정한다
function estimateExpectedMax(siblingMaxes: number[]): number | null {
  if (siblingMaxes.length < MIN_SIBLINGS_FOR_EDGE) return null
  const low = Math.min(...siblingMaxes)
  const high = Math.max(...siblingMaxes)
  if (high - low > low * TAIL_SPREAD_RATIO) return null
  return lowerMedian(siblingMaxes)
}

/**
 * 이 런이 몇 번부터 시작해야 하는지.
 *
 * 예전에는 묻지도 않고 1번이라고 봤다 (headMissing = min - 1). 회차별 기출에서는 맞지만
 * 발췌본에서는 틀린 전제다 — 한 회차에서 이 단원 문제만 골라 담으면 5번부터 시작하는 게 정상이다.
 * 실제 문제집에서 결번으로 지목된 173개 중 126개가 이 전제 하나에서 나왔다.
 *
 * 뒷부분(expectedMax)은 이미 '형제가 있고 고를 때만' 추정하도록 고쳤는데 앞부분만 무조건이었다.
 * 그 비대칭을 없앤다. 형제들의 과반이 1번부터 시작할 때만 이 런도 1번부터일 것으로 본다.
 * 회차별 문제집은 모든 회차가 1번부터라 그대로 걸리고, 발췌본은 시작 번호가 제각각이라 빠져나간다.
 */
function estimateExpectedMin(siblingMins: number[]): number | null {
  if (siblingMins.length < MIN_SIBLINGS_FOR_EDGE) return null
  const startAtOne = siblingMins.filter((m) => m === 1).length
  return startAtOne * 2 >= siblingMins.length ? 1 : null
}

/**
 * 빠진 번호를 덩어리로 묶고 하나하나 판정한다.
 *
 * 가운데 결번(interior)은 **페이지가 답을 갖고 있다.** 파싱은 쪽 단위로 실패하므로
 * 정말 놓친 문제가 있으면 그 자리에 빈 쪽이 남는다. 반대로 애초에 실리지 않은 번호라면
 * 앞뒤 문제의 쪽이 맞붙어 있어 들어갈 자리가 없다.
 *
 * 앞뒤 결번(head·tail)은 페이지로 못 가린다. 원래 있었어야 할 문제는 어느 쪽에도 흔적을
 * 남기지 않기 때문이다. 대신 이쪽은 이미 형제 런이라는 근거를 통과해야만 만들어진다
 * (headMissing은 6a, tailMissing은 4a에서 그렇게 고쳤다). 그래서 바로 suspect로 본다.
 */
function buildGaps(
  nos: number[],
  pages: QuestionPage[],
  expectedMin: number | null,
  headMissing: number,
  expectedMax: number | null,
  tailMissing: number
): Gap[] {
  const gaps: Gap[] = []

  if (headMissing > 0 && expectedMin !== null) {
    gaps.push({
      kind: 'head',
      from: expectedMin,
      to: nos[0] - 1,
      verdict: 'suspect',
      reason: `다른 회차는 ${expectedMin}번부터 시작합니다`,
    })
  }

  const pageOf = new Map(pages.map((p) => [p.no, p]))
  for (let i = 1; i < nos.length; i++) {
    const before = nos[i - 1]
    const after = nos[i]
    if (after - before <= 1) continue
    const from = before + 1
    const to = after - 1
    const pa = pageOf.get(before)
    const pb = pageOf.get(after)

    if (!pa || !pb) {
      gaps.push({
        kind: 'interior',
        from,
        to,
        verdict: 'unknown',
        reason: '페이지 기록이 없어 판단할 수 없습니다',
      })
      continue
    }
    const emptyPages = pb.from - pa.to - 1
    if (emptyPages > 0) {
      gaps.push({
        kind: 'interior',
        from,
        to,
        verdict: 'suspect',
        reason: `${pa.to + 1}~${pb.from - 1}쪽이 비어 있습니다`,
        pageFrom: pa.from,
        pageTo: pb.to,
      })
    } else {
      gaps.push({
        kind: 'interior',
        from,
        to,
        verdict: 'excerpt',
        reason:
          pa.to === pb.from
            ? `${pa.to}쪽 안에 나란히 있어 들어갈 자리가 없습니다`
            : `${pa.to}쪽과 ${pb.from}쪽이 붙어 있어 들어갈 자리가 없습니다`,
      })
    }
  }

  if (tailMissing > 0 && expectedMax !== null) {
    gaps.push({
      kind: 'tail',
      from: nos[nos.length - 1] + 1,
      to: expectedMax,
      verdict: 'suspect',
      reason: `다른 회차는 ${expectedMax}번까지 있습니다`,
    })
  }

  return gaps
}

// 런 하나. GroupCheck를 만들기 전 단계 — 형제 런의 마지막 번호를 참조해야 해서 둘로 나눠 둔다
interface Run {
  runId: string
  runIndex: number
  sourceFile: string | null
  subject: Subject
  examType: string
  year: number
  yearMixed: boolean
  nos: number[]
  pages: QuestionPage[]
}

function makeRun(key: string, runIndex: number, list: Question[]): Run {
  const head = list[0]
  const nos = Array.from(new Set(list.map((q) => Number(q.no)))).sort((a, b) => a - b)

  // 번호별 페이지 구간. 같은 번호의 판본이 여럿이면 더 좁은 쪽을 택한다
  // (store.ts의 병합 규칙과 같은 원칙 — 좁을수록 정확한 정보다)
  const pageByNo = new Map<number, { from: number; to: number }>()
  for (const q of list) {
    const no = Number(q.no)
    if (q.pageFrom === undefined || q.pageTo === undefined) continue
    const prev = pageByNo.get(no)
    if (!prev || q.pageTo - q.pageFrom < prev.to - prev.from) {
      pageByNo.set(no, { from: q.pageFrom, to: q.pageTo })
    }
  }
  const pages: QuestionPage[] = Array.from(pageByNo.entries())
    .map(([no, p]) => ({ no, from: p.from, to: p.to }))
    .sort((a, b) => a.no - b.no)

  // 연도는 이제 묶는 기준이 아니라 이 런이 무엇인지 알려주는 이름표다
  const yearCount = new Map<number, number>()
  for (const q of list) {
    const y = Number.isFinite(q.year) ? q.year : UNKNOWN_YEAR
    if (y === UNKNOWN_YEAR) continue
    yearCount.set(y, (yearCount.get(y) ?? 0) + 1)
  }
  // 최빈 연도. 같은 수라면 이른 해를 택해 결과가 실행마다 흔들리지 않게 한다
  const year =
    Array.from(yearCount.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? UNKNOWN_YEAR

  return {
    runId: `${key}#${runIndex}`,
    runIndex,
    sourceFile: head.sourceFile ?? null,
    subject: head.subject,
    examType: head.examType,
    year,
    yearMixed: yearCount.size > 1,
    nos,
    pages,
  }
}

/**
 * 한 버킷(파일·과목·시험구분)을 원본 순서로 세운 뒤 번호 런으로 자른다.
 *
 * 자르는 자리는 오직 하나, **번호가 뒤로 돌아가는 지점**이다.
 * 번호가 앞으로 건너뛰는 것은 자르지 않는다 — 그게 바로 우리가 찾으려는 결번이기 때문이다.
 * 여기서 같이 잘라버리면 유실이 다시 조용해진다.
 */
function cutRuns(key: string, list: Question[]): Run[] {
  const runs: Run[] = []
  let current: Question[] = []
  let lastNo = 0

  const close = () => {
    if (current.length === 0) return
    runs.push(makeRun(key, runs.length, current))
    current = []
    lastNo = 0
  }

  for (const q of orderForRuns(list)) {
    const no = Number(q.no)
    // 번호를 못 읽은 문제는 런을 잇지도 자르지도 않는다. 연속성을 논할 근거가 없다
    if (!Number.isFinite(no) || no <= 0) continue
    // 같은 번호가 잇달아 나오면 같은 문제의 다른 판본으로 보고 흡수한다 (병합이 놓친 몫).
    // 여기서 자르면 낱개 런만 늘어난다
    if (no < lastNo) close()
    current.push(q)
    lastNo = no
  }
  close()
  return runs
}

// 저장된 문제들로부터 검토 결과를 만든다.
// 청크 겹침으로 생긴 중복은 addQuestions가 이미 병합했으므로 여기서 다시 다루지 않는다
export function buildParseReview(questions: Question[]): ParseReview {
  // ── A. 번호 연속성 ──
  const unknownYearCount = questions.filter((q) => (q.year || UNKNOWN_YEAR) === UNKNOWN_YEAR).length
  const duplicateIds = findDuplicates(questions)

  // 파일·과목·시험구분으로 먼저 나눈다. 이때 저장 배열 순서를 그대로 유지해야
  // orderForRuns의 옛 데이터 폴백이 근거를 잃지 않는다.
  // 연도 미상도 함께 넣는다 — 연도는 더 이상 나누는 기준이 아니고, 빼면 그 자리가
  // 가짜 결번이 되거나 검사가 반쪽이 된다
  const byBucket = new Map<string, Question[]>()
  for (const q of questions) {
    const key = bucketKey(q)
    const list = byBucket.get(key)
    if (list) list.push(q)
    else byBucket.set(key, [q])
  }

  // 런 목록을 먼저 만든다 (형제 런의 마지막 번호를 참조해야 하므로 2단계로 나눈다).
  // 번호가 하나뿐인 런은 연속성을 논할 수 없어 빼되, 몇 개를 뺐는지는 세어 화면에 밝힌다
  const allRuns = Array.from(byBucket.entries()).flatMap(([key, list]) => cutRuns(key, list))
  const runs = allRuns.filter((r) => r.nos.length >= MIN_COUNT_FOR_GAP_CHECK)
  const singletonRuns = allRuns.length - runs.length

  // 덩어리 판정을 런 하나의 결론으로 모은다. 무거운 쪽이 이긴다 —
  // 발췌로 보이는 덩어리가 아무리 많아도 유실 의심이 하나 있으면 그 런은 유실 의심이다
  const runVerdict = (gaps: Gap[]): GroupCheck['verdict'] => {
    if (gaps.length === 0) return 'ok'
    if (gaps.some((g) => g.verdict === 'suspect')) return 'suspect'
    if (gaps.some((g) => g.verdict === 'unknown')) return 'unknown'
    return 'excerpt'
  }

  const groups: GroupCheck[] = runs.map((r) => {
    const min = r.nos[0]
    const max = r.nos[r.nos.length - 1]
    const present = new Set(r.nos)
    const interior = missingBetween(present, min, max)

    // 앞뒤 잘림은 같은 시험의 다른 회차와 견줘야만 보인다.
    // 견줄 런이 없거나 서로 들쭉날쭉하면 판단 근거가 없어 검사하지 않는다 (UI에서 그 사실을 밝힌다)
    const sibs = siblingsOf(r, runs)
    const expectedMin = estimateExpectedMin(sibs.map((o) => o.nos[0]))
    const expectedMax = estimateExpectedMax(sibs.map((o) => o.nos[o.nos.length - 1]))

    const headMissing = expectedMin !== null && min > expectedMin ? min - expectedMin : 0
    const tailMissing = expectedMax !== null && expectedMax > max ? expectedMax - max : 0

    const gaps = buildGaps(r.nos, r.pages, expectedMin, headMissing, expectedMax, tailMissing)
    const verdict = runVerdict(gaps)

    return {
      runId: r.runId,
      runIndex: r.runIndex,
      subject: r.subject,
      examType: r.examType,
      year: r.year,
      yearMixed: r.yearMixed,
      count: r.nos.length,
      min,
      max,
      nos: r.nos,
      sourceFile: r.sourceFile,
      pages: r.pages,
      pageFrom: r.pages.length > 0 ? Math.min(...r.pages.map((p) => p.from)) : null,
      pageTo: r.pages.length > 0 ? Math.max(...r.pages.map((p) => p.to)) : null,
      interior,
      gaps,
      expectedMin,
      headMissing,
      expectedMax,
      tailMissing,
      verdict,
      ok: verdict === 'ok',
    }
  })
  // 화면에서는 원본을 넘길 때와 같은 순서로 읽히는 게 낫다.
  // runIndex가 이미 그 순서다 — 런은 페이지 순으로 세운 뒤 잘랐기 때문이다.
  // 여기서 pageFrom으로 다시 정렬하면 안 된다. 페이지를 아는 런만 앞으로 튀어나와,
  // 일부만 다시 파싱한 문제집에서 순서가 뒤엉킨다
  groups.sort(
    (a, b) =>
      (a.sourceFile ?? NO_SOURCE_FILE).localeCompare(b.sourceFile ?? NO_SOURCE_FILE, 'ko') ||
      a.subject.localeCompare(b.subject, 'ko') ||
      a.examType.localeCompare(b.examType, 'ko') ||
      a.runIndex - b.runIndex
  )

  // ── B. 단원 분포. 과목이 섞여 있을 수 있으므로 과목+단원으로 묶는다 ──
  const byUnit = new Map<string, UnitCount>()
  for (const q of questions) {
    const unit = q.unit?.trim() || '(단원 없음)'
    const key = `${q.subject}|${unit}`
    const row = byUnit.get(key)
    if (row) {
      row.count++
      row.questions.push(q)
    } else {
      byUnit.set(key, {
        subject: q.subject,
        unit,
        count: 1,
        valid: isValidUnit(q.subject, q.unit),
        questions: [q],
      })
    }
  }
  const units = Array.from(byUnit.values()).sort(
    (a, b) => b.count - a.count || a.unit.localeCompare(b.unit, 'ko')
  )

  // ── 연도 분포 ──
  const thisYear = new Date().getFullYear()
  const byYear = new Map<number, YearCount>()
  for (const q of questions) {
    const year = Number.isFinite(q.year) ? q.year : UNKNOWN_YEAR
    const row = byYear.get(year)
    if (row) {
      row.count++
      row.questions.push(q)
    } else {
      byYear.set(year, {
        year,
        count: 1,
        ratio: 0,
        questions: [q],
        problem:
          year === UNKNOWN_YEAR ? 'unknown' : year > thisYear ? 'future' : year < EARLIEST_YEAR ? 'tooOld' : null,
      })
    }
  }
  const years = Array.from(byYear.values()).sort((a, b) => b.year - a.year)
  for (const row of years) row.ratio = questions.length > 0 ? row.count / questions.length : 0
  // 미상은 "쏠림" 판정에서 제외한다. 그건 별도 문제로 이미 표시된다
  const yearDominant =
    years.find((y) => y.year !== UNKNOWN_YEAR && y.ratio >= YEAR_DOMINANT_RATIO) ?? null

  return {
    total: questions.length,
    groups,
    unknownYearCount,
    singletonRuns,
    duplicateIds,
    units,
    years,
    yearDominant,
    hasWarning:
      // 발췌로 판정된 런은 경고가 아니다. 반대로 판단 보류는 경고로 친다 —
      // 근거가 없다는 이유로 넘어가면 '많이 잃을수록 조용해지는' 그 함정이 다시 열린다
      groups.some((g) => g.verdict === 'suspect' || g.verdict === 'unknown') ||
      unknownYearCount > 0 ||
      Object.keys(duplicateIds).length > 0 ||
      singletonRuns > 0 ||
      units.some((u) => !u.valid) ||
      years.some((y) => y.problem !== null) ||
      yearDominant !== null,
  }
}

// 덩어리가 가리키는 번호들. 화면 표시와 재파싱 요청에 쓴다
export function gapNumbers(gap: Gap): number[] {
  const out: number[] = []
  for (let n = gap.from; n <= gap.to; n++) out.push(n)
  return out
}

// 덩어리를 사람이 읽는 번호 표기로. 한 개짜리는 물결표를 붙이지 않는다
export function gapLabel(gap: Gap): string {
  return gap.from === gap.to ? `${gap.from}번` : `${gap.from}~${gap.to}번`
}

// 앞·중간·뒤에서 빠진 번호를 한 줄로 모은다. 재파싱 대상 구간을 잡을 때 쓴다
export function allMissing(g: GroupCheck): number[] {
  const head = Array.from({ length: g.headMissing }, (_, i) => i + 1)
  const tail =
    g.tailMissing > 0 && g.expectedMax !== null
      ? Array.from({ length: g.tailMissing }, (_, i) => g.max + 1 + i)
      : []
  return [...head, ...g.interior, ...tail]
}

// 빠진 번호가 있을 만한 페이지 구간을, 기록된 실제 페이지로 좁힌다.
//
// 결번의 앞뒤 이웃 문제가 몇 쪽에 있었는지 알면 빠진 문제는 반드시 그 사이에 있다.
// 이때는 추정이 아니라 확정이다 (exact = true).
//
// 회차의 앞이나 뒤가 통째로 빠진 경우에는 한쪽 이웃이 없다. 그쪽만 어림하는데,
// 기준은 문서 전체가 아니라 **이 회차 안의 페이지 밀도**다.
// (예전 estimatePageRange는 "이 회차 번호 중 몇 번째"를 "문서 전체의 몇 %"로 환산해
//  242쪽 문서에서 111쪽을 내놓았다. 회차가 문서 어디에 있는지 모르는 채 계산했기 때문이다)
export function gapPageRange(
  pages: QuestionPage[],
  missing: number[],
  totalPages: number
): { from: number; to: number; exact: boolean } | null {
  if (pages.length === 0 || missing.length === 0 || totalPages <= 0) return null

  const first = Math.min(...missing)
  const last = Math.max(...missing)
  const prev = [...pages].reverse().find((p) => p.no < first)
  const next = pages.find((p) => p.no > last)

  const roundFrom = Math.min(...pages.map((p) => p.from))
  const roundTo = Math.max(...pages.map((p) => p.to))
  // 이 회차의 문제 하나가 차지하는 쪽수. 회차가 한 쪽에 여러 문제여도 최소 1쪽은 잡는다
  const perQuestion = Math.max(1, (roundTo - roundFrom + 1) / pages.length)

  // 이웃이 없는 쪽은 "몇 문제를 건너뛰어야 하는가"로 거리를 잰다.
  // 빠진 번호만 세면 안 된다 — 그 사이에 '파싱은 됐지만 페이지를 모르는' 문제가 있으면
  // 그만큼을 빠뜨려 범위가 짧아진다. 번호 거리로 재면 그 문제들도 자연히 포함된다
  const below = Math.max(0, pages[0].no - first)
  const above = Math.max(0, last - pages[pages.length - 1].no)

  const from = prev
    ? prev.from
    : Math.max(1, roundFrom - Math.ceil(below * perQuestion) - 1)
  const to = next
    ? next.to
    : Math.min(totalPages, roundTo + Math.ceil(above * perQuestion) + 1)

  return { from, to: Math.max(from, to), exact: Boolean(prev && next) }
}

// 결번 목록을 화면에 넣을 문자열로. 너무 길면 뒤를 접는다
export function formatMissing(missing: number[]): string {
  const shown = missing.slice(0, MAX_MISSING_SHOWN).join(', ')
  return missing.length > MAX_MISSING_SHOWN
    ? `${shown} 외 ${missing.length - MAX_MISSING_SHOWN}개`
    : shown
}

// 연도 수정 드롭다운에 넣을 후보. 최신 연도가 위로 오게 한다
export function yearOptions(): number[] {
  const thisYear = new Date().getFullYear()
  const out: number[] = []
  for (let y = thisYear; y >= EARLIEST_YEAR; y--) out.push(y)
  return out
}

// 특정 단원이 "소수라 의심스러운지". 전체의 20% 미만이면서 최다 단원이 따로 있을 때만 표시한다.
// 고르게 섞인 파일에서 모든 단원에 경고가 붙는 것을 막는다
export function isMinorUnit(row: UnitCount, review: ParseReview): boolean {
  if (review.units.length < 2) return false
  const top = review.units[0].count
  return row.count < top && row.count / review.total < 0.2
}

export function unitOptionsFor(subject: Subject): string[] {
  return SUBJECT_UNITS[subject] ?? []
}
