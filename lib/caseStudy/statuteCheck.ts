// 상대 경로: check:case-statute-check 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { parseBlockHtml } from './answerFormats'
import type { CaseAttempt, StatuteMark } from './solve'

/**
 * 사례형 조문 점검 — 모범답안의 조문 표시(mark.law)가 내 답안에 들어 있는지 글자로만 맞춰 본다(AI·네트워크 없음).
 * 점수가 아니라 빠진 조문을 찾는 것이 목적이다
 */

export interface StatuteRef {
  law: string | null // 정규화한 법명. 없으면 앞서 나온 법명을 이어받고, 그것도 없으면 null(미지정)
  explicit: boolean // 법명이 그 자리에 적혀 있었는가(이어받은 것이면 false)
  art: number
  branch: number | null // 제X조의N
  para: number | null
  item: number | null
}

export type StatuteStatus = StatuteMark
// 시도 문서에 문항마다 덧붙이는 선택 필드. auto 는 직접 고칠 때의 자동 판정 사본, manual 이 직접 고친 값
export type StatuteCheckRecord = NonNullable<CaseAttempt['statuteChecks']>[string]

// 약칭 → 법명. 모범답안과 내 답안을 같은 이름으로 모으기만 하면 되므로 정식 명칭이 아니어도 된다
const ALIAS: Record<string, string> = {
  민소: '민사소송법', 민소법: '민사소송법', 민집: '민사집행법', 민집법: '민사집행법',
  형소: '형사소송법', 형소법: '형사소송법', 행소: '행정소송법', 행소법: '행정소송법',
  헌재법: '헌법재판소법', 행심법: '행정심판법', 행절법: '행정절차법', 국배법: '국가배상법', 지자법: '지방자치법',
  주임법: '주택임대차보호법', 상임법: '상가건물임대차보호법', 상가임대차법: '상가건물임대차보호법',
  특가법: '특정범죄가중처벌법', 특경법: '특정경제범죄가중처벌법', 폭처법: '폭력행위처벌법',
  성폭법: '성폭력처벌법', 정통망법: '정보통신망법', 공선법: '공직선거법', 선거법: '공직선거법', 도교법: '도로교통법',
}
// '법'으로 끝나지만 법명이 아닌 낱말
const NOT_LAW = new Set(['위법', '적법', '불법', '방법', '합법', '편법', '입법', '탈법', '사법', '공법', '해법', '용법', '어법', '문법'])

// 뒤돌아보기((?<!…))는 쓰지 않는다 — 아이패드 사파리 16.3 이하에서 정규식째 문법 오류가 난다.
// 가장 왼쪽에서 시작하는 일치가 이기므로 법명은 어차피 붙어 있는 한글 낱말 전체로 잡힌다
const LAW = String.raw`(같은\s?법|동법|상가건물\s?임대차보호법|민소|형소|행소|민집|[가-힣]+법)(?![가-힣])`
const PARA = String.raw`(?:\s?(?:제\s?)?(\d+)\s?항(?![소변고공])|\s?([①-⑳]))`
const REF = new RegExp(
  `(?:${LAW}\\s?)?` +
    // 조 번호 자리: 같은 조 / 제N조 / §N / 앞 조문의 다른 항('제1항, 제2항'의 '제2항')
    String.raw`(?:(같은\s?조)|(?:제\s?)?(\d+)\s?조(?![원명건례치])|§\s?(\d+)(?:\s?조)?|(?:제\s?)?(\d+)\s?항(?![소변고공]))` +
    String.raw`(?:\s?의\s?(\d+))?` +
    `${PARA}?` +
    String.raw`(?:\s?(?:제\s?)?(\d+)\s?호(?![주출칭]))?`,
  'g'
)

function canonLaw(raw: string): string {
  const s = raw.replace(/\s/g, '')
  return ALIAS[s] ?? s
}

interface Ctx {
  law: string | null
  last: StatuteRef | null
}
const newCtx = (): Ctx => ({ law: null, last: null })

/** 글자에서 조문 언급을 순서대로 뽑는다. at = 조 번호가 시작하는 자리(모범답안에서 어느 조문 표시 안인지 가를 때 쓴다) */
function scanRefs(text: string, ctx: Ctx): { ref: StatuteRef; at: number }[] {
  const out: { ref: StatuteRef; at: number }[] = []
  for (const m of text.matchAll(REF)) {
    const [whole, lawRaw, sameArt, artNo, secNo, paraOnly, branch, paraNo, circled, itemNo] = m
    let law = ctx.law
    let explicit = false
    if (lawRaw) {
      const name = lawRaw.replace(/\s/g, '')
      if (name === '같은법' || name === '동법') {
        explicit = ctx.last?.explicit ?? false
      } else if (!NOT_LAW.has(name)) {
        law = canonLaw(name)
        explicit = true
        ctx.law = law
      }
    }
    let art: number
    let br: number | null = branch ? Number(branch) : null
    if (sameArt || paraOnly) {
      if (!ctx.last) continue
      art = ctx.last.art
      br = ctx.last.branch
      law = ctx.last.law
      explicit = ctx.last.explicit
    } else {
      art = Number(artNo ?? secNo)
    }
    const para = paraOnly ? Number(paraOnly) : paraNo ? Number(paraNo) : circled ? circled.charCodeAt(0) - 0x2460 + 1 : null
    const ref: StatuteRef = { law, explicit, art, branch: br, para, item: itemNo ? Number(itemNo) : null }
    // 조 번호 자리 — 법명과 그 뒤 빈칸을 건너뛴 곳
    const rest = lawRaw ? whole.slice(whole.indexOf(lawRaw) + lawRaw.length) : whole
    out.push({ ref, at: (m.index ?? 0) + whole.length - rest.trimStart().length })
    ctx.last = ref
  }
  return out
}

export const statuteKey = (r: StatuteRef) => `${r.law ?? ''}|${r.art}|${r.branch ?? ''}|${r.para ?? ''}|${r.item ?? ''}`

export function statuteLabel(r: StatuteRef): string {
  return [
    r.law ? `${r.law} ` : '',
    `제${r.art}조`,
    r.branch ? `의${r.branch}` : '',
    r.para ? ` 제${r.para}항` : '',
    r.item ? ` 제${r.item}호` : '',
  ].join('')
}

export interface ModelStatutes {
  items: { key: string; ref: StatuteRef }[] // 점검할 조문(같은 조문은 한 번)
  marks: string[][][] // [블록][그 블록의 조문 표시 순서] = 그 표시 안의 조문 키들
}

/**
 * 모범답안 블록 html(sanitize 를 거친 것)에서 조문 표시 안의 조문을 뽑는다.
 * 법명 이어받기는 표시 밖 글자까지 문항 전체에 걸쳐 앞에서부터 한다
 */
export function modelStatutes(blockHtmls: string[]): ModelStatutes {
  const ctx = newCtx()
  const seen = new Map<string, StatuteRef>()
  const marks = blockHtmls.map((html) => {
    const { text, formats } = parseBlockHtml(html)
    const laws = formats.filter((f) => f.tag === 'mark' && f.className === 'law')
    const keys: string[][] = laws.map(() => [])
    for (const { ref, at } of scanRefs(text, ctx)) {
      const li = laws.findIndex((f) => f.start <= at && at < f.end)
      if (li < 0) continue
      const key = statuteKey(ref)
      if (!seen.has(key)) seen.set(key, ref)
      if (!keys[li].includes(key)) keys[li].push(key)
    }
    return keys
  })
  return { items: [...seen].map(([key, ref]) => ({ key, ref })), marks }
}

/** 내 답안(소문항 칸들)의 조문 언급. 법명 이어받기는 칸을 넘어 이어진다 */
export function answerRefs(texts: string[]): StatuteRef[] {
  const ctx = newCtx()
  return texts.flatMap((t) => scanRefs(t, ctx).map((x) => x.ref))
}

/**
 * 판정. 조 번호(가지번호 포함)가 같고 법명이 어긋나지 않으면 그 조문을 쓴 것으로 보고,
 * 모범답안에 항·호가 있으면 그것까지 같아야 ok, 아니면 partial. 법명은 양쪽 다 그 자리에 적혀 있을 때만 비교한다
 */
export function judgeStatutes(items: ModelStatutes['items'], mine: StatuteRef[]): Record<string, StatuteStatus> {
  const out: Record<string, StatuteStatus> = {}
  for (const { key, ref } of items) {
    const same = mine.filter(
      (r) =>
        r.art === ref.art &&
        r.branch === ref.branch &&
        !(ref.explicit && r.explicit && ref.law !== null && r.law !== null && ref.law !== r.law)
    )
    const exact = same.some((r) => (ref.para === null || r.para === ref.para) && (ref.item === null || r.item === ref.item))
    out[key] = exact ? 'ok' : same.length > 0 ? 'partial' : 'missing'
  }
  return out
}

const CYCLE: StatuteStatus[] = ['ok', 'partial', 'missing']
export const nextStatus = (s: StatuteStatus): StatuteStatus => CYCLE[(CYCLE.indexOf(s) + 1) % CYCLE.length]

/** sanitize 를 거친 html 의 조문 표시(mark.law)마다 닫는 태그 바로 뒤에 insert(표시 순서)를 넣는다 */
export function insertAfterLawMarks(html: string, insert: (i: number) => string): string {
  let out = ''
  let n = 0
  const stack: (number | null)[] = []
  for (const m of html.matchAll(/<(\/?)mark\b([^>]*)>|<[^>]*>|[^<]+|</g)) {
    out += m[0]
    if (m[1] === '') {
      stack.push(/class="\s*law\s*"/.test(m[2] ?? '') ? n++ : null)
    } else if (m[1] === '/') {
      const i = stack.pop()
      if (i !== undefined && i !== null) out += insert(i)
    }
  }
  return out
}
