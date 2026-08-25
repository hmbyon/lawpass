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
  lines.push(
    `total=${review.total} unknownYear=${review.skippedUnknownYear} ` +
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

// ── 실행 ────────────────────────────────────────────────────────

const update = process.argv.includes('--update')

const fixtureReport = FIXTURES.map((f) => {
  const review = buildParseReview(f.questions)
  invariants(f, review)
  return render(f, review)
}).join('\n\n')

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

if (update) {
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  writeFileSync(SNAPSHOT, report)
  console.log(`스냅샷을 갱신했습니다: ${SNAPSHOT}`)
} else {
  let previous: string | null = null
  try {
    previous = readFileSync(SNAPSHOT, 'utf8')
  } catch {
    failures.push(`스냅샷이 없습니다. --update로 먼저 만들어주세요: ${SNAPSHOT}`)
  }
  if (previous !== null && previous !== report) {
    const before = previous.split('\n')
    const after = report.split('\n')
    const diff: string[] = []
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (before[i] !== after[i]) {
        diff.push(`  ${i + 1}행`)
        diff.push(`    - ${before[i] ?? '(없음)'}`)
        diff.push(`    + ${after[i] ?? '(없음)'}`)
      }
    }
    failures.push(`스냅샷과 다릅니다:\n${diff.join('\n')}`)
  }
}

if (failures.length > 0) {
  console.error(`\n실패 ${failures.length}건:\n`)
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log(
  `통과: fixture ${FIXTURES.length}개, 순서 케이스 ${ORDER_CASES.length}개, ` +
    `불변식 이상 없음${update ? '' : ', 스냅샷 일치'}`
)
