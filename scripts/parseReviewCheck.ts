/**
 * buildParseReview 회귀 검증 하네스.
 *
 * 이 프로젝트에는 테스트 러너가 없다. 의존성을 늘리지 않으려고 tsc로 CommonJS로 한 번
 * 떨궈서 node로 그냥 돌린다 (package.json의 check:parse-review).
 *
 * 하는 일은 둘이다.
 *  1) 고정 입력(fixture)을 buildParseReview에 넣고, 결과를 사람이 읽을 수 있는 줄로 찍어
 *     scripts/__snapshots__/parse-review.txt 와 비교한다. 다르면 실패한다.
 *  2) 언제나 성립해야 하는 불변식을 단언한다.
 *
 * 스냅샷에 찍는 필드는 '번호 연속성 판정에 쓰이는 값'만으로 일부러 좁혀 두었다.
 * 그룹핑 방식을 회차 기준에서 번호 런 기준으로 바꾸는 동안, 회차별 문제집(fixture 1~3)의
 * 이 줄들이 한 글자도 변하지 않는 것이 곧 "기존 케이스에 영향 없음"의 증거가 된다.
 * 런 식별자처럼 새로 생기는 필드는 여기 찍지 않는다 (별도 스냅샷으로 뺀다).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Question, Subject, ExamType } from '../lib/types'
import {
  buildParseReview,
  orderForRuns,
  UNKNOWN_YEAR,
  type PagedItem,
  type ParseReview,
} from '../lib/parseReview'

const SNAPSHOT = join(process.cwd(), 'scripts/__snapshots__/parse-review.txt')
// 런 분할로 새로 생긴 필드만 따로 본다 (위 스냅샷을 오염시키지 않으려고 파일을 나눴다)
const RUN_SNAPSHOT = join(process.cwd(), 'scripts/__snapshots__/parse-review-runs.txt')

// ── fixture 만들기 ──────────────────────────────────────────────

interface Spec {
  no: number
  year: number
  subject: Subject
  examType: ExamType
  unit?: string
  page?: number // 없으면 pageFrom/pageTo를 넣지 않는다 (옛 데이터 재현)
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n++) out.push(n)
  return out
}

function without(nos: number[], drop: number[]): number[] {
  return nos.filter((n) => !drop.includes(n))
}

/**
 * 한 덩어리(회차 하나, 또는 단원 하나)의 문제들.
 * year에 배열을 주면 번호 순서대로 돌려 쓴다 — 한 덩어리 안에 여러 연도가 섞인 단원별 문제집 재현용.
 */
function block(o: {
  nos: number[]
  year: number | number[]
  subject?: Subject
  examType?: ExamType
  unit?: string
  startPage?: number // 없으면 페이지 정보 없는 문제가 된다
  perPage?: number // 한 쪽에 몇 문제 (기본 2)
}): Spec[] {
  const perPage = o.perPage ?? 2
  return o.nos.map((no, i) => ({
    no,
    year: Array.isArray(o.year) ? o.year[i % o.year.length] : o.year,
    subject: o.subject ?? '민법',
    examType: o.examType ?? '변호사시험',
    unit: o.unit,
    page: o.startPage === undefined ? undefined : o.startPage + Math.floor(i / perPage),
  }))
}

/** 저장 배열 순서 = 이 배열의 순서. 옛 데이터 폴백이 기대는 것이 바로 이 순서다 */
function questions(sourceFile: string | undefined, specs: Spec[]): Question[] {
  return specs.map((s, i) => {
    const q: Question = {
      id: `${sourceFile ?? 'nofile'}#${i}`,
      no: s.no,
      subject: s.subject,
      examType: s.examType,
      year: s.year,
      unit: s.unit ?? '민법총칙',
      passage: `${sourceFile ?? '?'} ${s.year}년 ${s.no}번 지문`,
      choices: [],
      answer: '①',
      explanation: null,
      addedAt: 0,
      sourceFile,
    }
    if (s.page !== undefined) {
      q.pageFrom = s.page
      q.pageTo = s.page
    }
    return q
  })
}

// ── fixture 목록 ────────────────────────────────────────────────
// 1~3은 지금 정상 동작 중인 회차별 문제집. 이 셋의 출력이 회귀 감시 대상이다.
// 4~7은 지금 잘못 나오는 케이스. 단계가 진행되면서 이 줄들은 바뀌어야 한다.

interface Fixture {
  name: string
  note: string
  questions: Question[]
}

const FIXTURES: Fixture[] = [
  {
    name: '1. 회차별 정상',
    note: '한 파일에 2022~2024 세 회차, 각 1~40번. 페이지 순서대로.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022, startPage: 1 }),
      ...block({ nos: range(1, 40), year: 2023, startPage: 21 }),
      ...block({ nos: range(1, 40), year: 2024, startPage: 41 }),
    ]),
  },
  {
    name: '2. 회차별 + 중간 결번',
    note: '2023 회차에서 17·18번이 빠졌다. 파싱 누락으로 잡혀야 한다.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022, startPage: 1 }),
      ...block({ nos: without(range(1, 40), [17, 18]), year: 2023, startPage: 21 }),
      ...block({ nos: range(1, 40), year: 2024, startPage: 41 }),
    ]),
  },
  {
    name: '3. 회차별 + 앞뒤 잘림',
    note: '2024 회차가 5~35번만 있다. 앞 4개·뒤 5개가 잘린 것으로 잡혀야 한다.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022, startPage: 1 }),
      ...block({ nos: range(1, 40), year: 2023, startPage: 21 }),
      ...block({ nos: range(5, 35), year: 2024, startPage: 41 }),
    ]),
  },
  {
    name: '4. 단원별 (연도 섞임)',
    note: '민법총칙 1~30번, 물권법 1~35번. 각 단원 안에서 연도가 섞인다. 연도로 묶으면 번호가 뒤엉킨다.',
    questions: questions('민법-단원별.pdf', [
      ...block({ nos: range(1, 30), year: [2021, 2022, 2023], unit: '민법총칙', startPage: 1 }),
      ...block({ nos: range(1, 35), year: [2021, 2022, 2023], unit: '물권법', startPage: 16 }),
    ]),
  },
  {
    name: '5. 옛 데이터 (페이지 정보 없음)',
    note: 'fixture 1과 같은 구성인데 pageFrom/pageTo가 없다. 저장 배열 순서만이 단서다.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022 }),
      ...block({ nos: range(1, 40), year: 2023 }),
      ...block({ nos: range(1, 40), year: 2024 }),
    ]),
  },
  {
    name: '6. 페이지 정보 섞임',
    note: '2023 회차만 페이지를 안다 (1단계 이후 그 구간만 다시 파싱한 문제집).',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022 }),
      ...block({ nos: range(1, 40), year: 2023, startPage: 21 }),
      ...block({ nos: range(1, 40), year: 2024 }),
    ]),
  },
  {
    name: '7. 연도 미상 반쪽',
    note: '1~25번은 2023년, 26~50번은 연도 미상. 지금은 미상 쪽이 검사에서 통째로 빠진다.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 25), year: 2023, startPage: 1 }),
      ...block({ nos: range(26, 50), year: UNKNOWN_YEAR, startPage: 14 }),
    ]),
  },
  {
    name: '8. 단원별 (단원마다 문항 수·연도 다름)',
    note:
      '민법총칙 30문(2021), 물권법 20문(2022), 채권총론 45문(2023). 단원끼리 문항 수가 다른 건 정상인데, ' +
      '서로를 형제 회차로 보면 문항 수가 적은 단원에 뒷잘림 오경고가 뜬다.',
    questions: questions('민법-단원별-혼합.pdf', [
      ...block({ nos: range(1, 30), year: 2021, unit: '민법총칙', startPage: 1 }),
      ...block({ nos: range(1, 20), year: 2022, unit: '물권법', startPage: 16 }),
      ...block({ nos: range(1, 45), year: 2023, unit: '채권총론', startPage: 26 }),
    ]),
  },
  {
    name: '9. 낱개 런',
    note:
      '두 회차 사이에 5번 한 문제가 끼어 있다 (번호 오독이거나 다른 회차에서 딸려 온 문제). ' +
      '앞뒤 어느 쪽과도 이어지지 않아 런이 셋으로 갈리고, 가운데 런은 번호가 하나뿐이라 검사에서 빠진다.',
    questions: questions('변시-민법-기출.pdf', [
      ...block({ nos: range(1, 40), year: 2022, startPage: 1 }),
      ...block({ nos: [5], year: 2023, startPage: 21 }),
      ...block({ nos: range(1, 40), year: 2024, startPage: 22 }),
    ]),
  },
  {
    name: '10. 발췌본 (회차마다 이 단원 문제만)',
    note:
      '세 회차에서 이 단원에 해당하는 문제만 골라 담았다. 어느 런도 1번부터 시작하지 않는다. ' +
      '"모든 런은 1번부터"라는 전제로 세면 앞부분 결번이 무더기로 잡힌다.',
    questions: questions('민법총칙-발췌.pdf', [
      ...block({ nos: [5, 8, 9, 10, 11, 12, 15, 16, 17], year: 2014, startPage: 1 }),
      ...block({ nos: [3, 4, 9, 20, 21, 22, 23, 24, 25, 26], year: 2015, startPage: 6 }),
      ...block({ nos: [2, 7, 8, 13, 14, 19, 20], year: 2016, startPage: 11 }),
    ]),
  },
]

// ── 순서 결정 케이스 (orderForRuns) ─────────────────────────────
// 런을 자르기 전에 문제를 원본 순서로 세우는 규칙만 따로 시험한다.
// 여기서는 번호도 연도도 보지 않는다 — 오로지 페이지와 저장 배열 순서뿐이다

interface OrderItem extends PagedItem {
  label: string
}

interface OrderCase {
  name: string
  note: string
  items: OrderItem[] // 배열 순서 = 저장 배열 순서
  expect: string // 기대하는 결과 순서
}

/** p('A', 3) → 3쪽 / p('A', 10, 15) → 10~15쪽 / p('A') → 페이지 모름 */
function p(label: string, from?: number, to?: number): OrderItem {
  const item: OrderItem = { label }
  if (from !== undefined) {
    item.pageFrom = from
    item.pageTo = to ?? from
  }
  return item
}

function showItem(i: OrderItem): string {
  if (i.pageFrom === undefined) return `${i.label}(-)`
  return i.pageTo === i.pageFrom ? `${i.label}(${i.pageFrom})` : `${i.label}(${i.pageFrom}~${i.pageTo})`
}

const ORDER_CASES: OrderCase[] = [
  {
    name: '전부 페이지 있음',
    note: '저장 순서가 원본과 어긋나 있어도 페이지 순으로 바로 세운다.',
    items: [p('A', 3), p('B', 1), p('C', 2)],
    expect: 'B C A',
  },
  {
    name: '전부 페이지 없음 (옛 데이터)',
    note: '물려받을 값이 모두 같아져 저장 배열 순서가 그대로 남는다. 이게 옛 데이터 폴백이다.',
    items: [p('A'), p('B'), p('C')],
    expect: 'A B C',
  },
  {
    name: '페이지 정보 섞임',
    note: '아는 것끼리는 페이지 순, 모르는 것은 저장 순서상 직전 문제 바로 뒤에 붙는다.',
    items: [p('A', 1), p('B'), p('C', 3), p('D'), p('E', 2)],
    expect: 'A B E C D',
  },
  {
    name: '같은 페이지에 여러 문제',
    note: '한 쪽에 여러 문제가 있으면 저장 순서를 흔들지 않는다.',
    items: [p('A', 5), p('B', 5), p('C', 5)],
    expect: 'A B C',
  },
  {
    name: '넓은 청크 뒤에 페이지 모르는 문제',
    note:
      'pageTo까지 물려받지 않으면 B가 (10,10)이 되어 정작 자기 앞의 A(10~15)를 제치고 나선다. ' +
      '기대값이 A B C인 것이 그 방지책이 살아 있다는 뜻이다.',
    items: [p('A', 10, 15), p('B'), p('C', 12)],
    expect: 'A B C',
  },
  {
    name: '맨 앞이 페이지 모르는 문제',
    note: '물려받을 앞 문제가 없으면 0쪽으로 두어 저장 순서 맨 앞자리를 지킨다.',
    items: [p('A'), p('B'), p('C', 5)],
    expect: 'A B C',
  },
]

// ── 출력 ────────────────────────────────────────────────────────

const MAX_NOS_SHOWN = 12

function nums(list: number[]): string {
  if (list.length === 0) return '[]'
  const head = list.slice(0, MAX_NOS_SHOWN).join(',')
  return list.length > MAX_NOS_SHOWN ? `[${head} +${list.length - MAX_NOS_SHOWN}]` : `[${head}]`
}

function render(f: Fixture, review: ParseReview): string {
  const lines: string[] = []
  lines.push(`### ${f.name}`)
  lines.push(`# ${f.note}`)
  // 낱개 런은 있을 때만 찍는다. 없을 때도 찍으면 기존 fixture의 줄이 전부 바뀌어,
  // '회차별 케이스는 그대로'를 스냅샷 diff로 보이는 이 하네스의 쓸모가 준다
  const singletons = review.singletonRuns > 0 ? ` singletons=${review.singletonRuns}` : ''
  lines.push(
    `total=${review.total} unknownYear=${review.skippedUnknownYear}${singletons} ` +
      `groups=${review.groups.length} hasWarning=${review.hasWarning}`
  )
  if (review.groups.length === 0) lines.push('  (그룹 없음)')
  for (const g of review.groups) {
    lines.push(
      `  ${g.subject}|${g.examType}|${g.year} count=${g.count} ${g.min}~${g.max} ` +
        `head=${g.headMissing} interior=${nums(g.interior)} ` +
        `expMax=${g.expectedMax ?? '-'} tail=${g.tailMissing} sparse=${g.sparse} ok=${g.ok}`
    )
  }
  lines.push(`  units: ${review.units.map((u) => `${u.unit}=${u.count}${u.valid ? '' : '!'}`).join(' ')}`)
  lines.push(
    `  years: ${review.years
      .map((y) => `${y.year === UNKNOWN_YEAR ? '미상' : y.year}=${y.count}${y.problem ? `(${y.problem})` : ''}`)
      .join(' ')}`
  )
  return lines.join('\n')
}

// 런 분할로 새로 생긴 필드는 여기 따로 찍는다.
// 위 스냅샷을 오염시키지 않아야 회차별 케이스의 무변경을 그대로 증명할 수 있다
function renderRuns(f: Fixture, review: ParseReview): string {
  const lines = [`### ${f.name}`]
  if (review.groups.length === 0) lines.push('  (런 없음)')
  for (const g of review.groups) {
    const pages = g.pageFrom === null ? '쪽 모름' : `${g.pageFrom}~${g.pageTo}쪽`
    lines.push(
      `  ${g.runId} count=${g.count} ${g.min}~${g.max} ${pages} ` +
        `year=${g.year === UNKNOWN_YEAR ? '미상' : g.year}${g.yearMixed ? '(섞임)' : ''} ` +
        `expMin=${g.expectedMin ?? '-'} file=${g.sourceFile ?? '-'}`
    )
  }
  return lines.join('\n')
}

function renderOrder(c: OrderCase, got: string): string {
  return [
    `- ${c.name}`,
    `  # ${c.note}`,
    `  입력: ${c.items.map(showItem).join(' ')}`,
    `  결과: ${got}`,
  ].join('\n')
}

// ── 불변식 ──────────────────────────────────────────────────────
// 그룹핑 방식이 바뀌어도 이건 언제나 참이어야 한다

const failures: string[] = []

function check(cond: boolean, message: string) {
  if (!cond) failures.push(message)
}

function invariants(f: Fixture, review: ParseReview) {
  const where = (msg: string) => `[${f.name}] ${msg}`
  // 화면 key로 쓰이므로 겹치면 안 된다. 회차별로 묶던 시절엔 한 파일에 같은 연도가
  // 두 번 나오면 key가 겹쳤는데, 런 식별자는 그럴 일이 없어야 한다
  const ids = new Set(review.groups.map((g) => g.runId))
  check(ids.size === review.groups.length, where('runId가 겹친다'))
  for (const g of review.groups) {
    check(g.count === g.nos.length, where(`count(${g.count}) != nos.length(${g.nos.length})`))
    check(g.nos.length >= 2, where(`그룹에 번호가 ${g.nos.length}개뿐`))
    check(g.min === g.nos[0], where(`min(${g.min}) != nos[0](${g.nos[0]})`))
    check(g.max === g.nos[g.nos.length - 1], where(`max(${g.max}) != nos 마지막`))
    check(
      g.nos.every((n, i, arr) => i === 0 || arr[i - 1] < n),
      where('nos가 오름차순이 아님')
    )
    check(
      g.ok === (g.interior.length === 0 && g.headMissing === 0 && g.tailMissing === 0),
      where('ok가 결번 상태와 어긋남')
    )
    check(
      g.pages.every((p) => p.from <= p.to),
      where('pages에 from > to인 항목이 있음')
    )
  }
}

// ── 실데이터 대조 ───────────────────────────────────────────────
// npm run check:parse-review -- --data ./questions.json
//
// 브라우저 localStorage에서 꺼낸 저장 배열을 그대로 넣어, 지금 코드가 무엇을 내놓는지 본다.
// fixture는 사람이 지어낸 것이라 실제 문제집의 생김새를 다 담지 못한다.
// 스냅샷과는 무관하다 — 비교하지 않고 찍기만 하고 끝낸다

function runOnRealData(path: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.error(`파일을 읽지 못했습니다: ${path}\n${String(err)}`)
    process.exit(1)
  }
  // localStorage 값 그대로(배열)든, {questions: [...]} 로 감싼 것이든 받는다
  const list = (
    Array.isArray(parsed) ? parsed : ((parsed as { questions?: unknown }).questions ?? [])
  ) as Question[]
  if (!Array.isArray(list) || list.length === 0) {
    console.error('문제 배열을 찾지 못했습니다. localStorage의 lawpass_questions_law 값을 그대로 넣어주세요')
    process.exit(1)
  }

  const review = buildParseReview(list)
  const files = Array.from(new Set(list.map((q) => q.sourceFile ?? '(파일 미상)')))
  // 결번으로 지목된 번호를 전부 센다. 오탐이 줄었는지 견줄 수 있는 하나의 숫자다
  const flagged = review.groups.reduce(
    (sum, g) => sum + g.interior.length + g.headMissing + g.tailMissing,
    0
  )

  console.log(`파일: ${files.join(', ')}`)
  console.log(render({ name: path, note: '실데이터', questions: list }, review))
  console.log(renderRuns({ name: path, note: '', questions: list }, review))
  console.log(`\n결번으로 지목된 번호: 총 ${flagged}개 (경고 있는 런 ${review.groups.filter((g) => !g.ok).length}개)`)
  process.exit(0)
}

// ── 실행 ────────────────────────────────────────────────────────

const dataFlag = process.argv.indexOf('--data')
if (dataFlag >= 0) {
  const path = process.argv[dataFlag + 1]
  if (!path) {
    console.error('--data 뒤에 JSON 파일 경로를 적어주세요')
    process.exit(1)
  }
  runOnRealData(path)
}

const update = process.argv.includes('--update')

const reviews = FIXTURES.map((f) => {
  const review = buildParseReview(f.questions)
  invariants(f, review)
  return { f, review }
})

const fixtureReport = reviews.map(({ f, review }) => render(f, review)).join('\n\n')
const runReport = reviews.map(({ f, review }) => renderRuns(f, review)).join('\n\n')

const orderReport = ORDER_CASES.map((c) => {
  const before = c.items.map((i) => i.label).join(' ')
  const got = orderForRuns(c.items)
    .map((i) => i.label)
    .join(' ')
  check(got === c.expect, `[순서: ${c.name}] 기대 "${c.expect}" != 실제 "${got}"`)
  // 원본 배열을 건드리지 않아야 한다 — 호출한 쪽의 저장 순서가 곧 폴백 근거이기 때문
  check(
    c.items.map((i) => i.label).join(' ') === before,
    `[순서: ${c.name}] orderForRuns가 입력 배열을 뒤섞었다`
  )
  return renderOrder(c, got)
}).join('\n\n')

const report = `${fixtureReport}\n\n### 순서 결정 (orderForRuns)\n\n${orderReport}\n`

function compare(path: string, content: string) {
  if (update) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    console.log(`스냅샷을 갱신했습니다: ${path}`)
    return
  }
  let previous: string | null = null
  try {
    previous = readFileSync(path, 'utf8')
  } catch {
    failures.push(`스냅샷이 없습니다. --update로 먼저 만들어주세요: ${path}`)
    return
  }
  if (previous === content) return
  const before = previous.split('\n')
  const after = content.split('\n')
  const diff: string[] = []
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) {
      diff.push(`  ${i + 1}행`)
      diff.push(`    - ${before[i] ?? '(없음)'}`)
      diff.push(`    + ${after[i] ?? '(없음)'}`)
    }
  }
  failures.push(`${path} 스냅샷과 다릅니다:\n${diff.join('\n')}`)
}

compare(SNAPSHOT, report)
compare(RUN_SNAPSHOT, `${runReport}\n`)

if (failures.length > 0) {
  console.error(`\n실패 ${failures.length}건:\n`)
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log(
  `통과: fixture ${FIXTURES.length}개, 순서 케이스 ${ORDER_CASES.length}개, ` +
    `불변식 이상 없음${update ? '' : ', 스냅샷 일치'}`
)
