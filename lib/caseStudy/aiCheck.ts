// 상대 경로: check:case-ai-check 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { answerField, parseBlockHtml, textHash } from './answerFormats'
import { boxesOf, type AiVerdict, type CaseAttempt } from './solve'
import type { Problem } from './types'
import { GEMINI_API, GEMINI_MODEL, GEMINI_NETWORK_ERROR, geminiErrorReason, getGeminiKey } from '../geminiKey'

/**
 * 사례형 AI 점검 — 제출한 답안에 모범답안의 판례 취지·결론이 담겼는지 Gemini 로 본다. 점수는 매기지 않는다.
 *  1) extractAiItems: 모범답안에서 점검 항목(판례 = mark.case 가 든 문장, 결론 = mark.res 가 든 문장)을 뽑는다
 *  2) runAiCheck: 항목을 묶음(25개)마다 한 번 Gemini 에 보내고, 응답을 이 기기에서 검증해 기록을 만든다
 * 화면·저장은 여기서 하지 않는다
 */

export type AiItemKind = 'case' | 'res'

export interface AiCheckItem {
  key: string // '{블록 field}:{kind}:{시작}-{끝}' — 형광펜 숨김 키(hiddenKey)와 같은 블록 번호+글자 해시+구간 방식
  kind: AiItemKind
  block: number
  text: string // 모범답안 원문(표시가 든 문장, 내용이 모자라면 문단)
  focus: string[] // 결론: 칠해진 부분. 판례는 비어 있다
}

export type { AiVerdict }
// 시도 문서의 선택 필드 aiChecks[문항 id] 의 형태(타입은 solve.ts 의 CaseAttempt 에 있다. 저장은 2단계에서 연결)
export type AiCheckRecord = NonNullable<CaseAttempt['aiChecks']>[string]
export type AiItemResult = AiCheckRecord['items'][string]

export const AI_BATCH_SIZE = 25
export const AI_TIMEOUT_MS = 60_000

// ── 1. 점검 항목 ─────────────────────────────────────────────

const OPEN = '([（「『“‘'
const CLOSE = ')]）」』”’'

/** 블록 글자를 문장 구간으로 나눈다. 괄호·따옴표 안의 마침표와 숫자 뒤 마침표(날짜 '2023. 12. 19.', 번호 '1.')는 문장 끝이 아니다 */
export function sentenceRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let depth = 0
  const push = (end: number) => {
    let s = start
    while (s < end && /\s/.test(text[s])) s++
    let e = end
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e > s) out.push([s, e])
    start = end
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1)
    if (c === '\n') push(i + 1)
    else if ('.?!。'.includes(c) && depth === 0 && !/\d/.test(text[i - 1] ?? '')) push(i + 1)
  }
  push(text.length)
  return out
}

// 판례 인용만 있고 취지가 없는 글인가 — 괄호 안(인용)을 빼고 한글이 10자도 안 남으면 그렇다
const thin = (s: string) => s.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^가-힣]/g, '').length < 10

/** 문항 하나의 모범답안 블록 html(sanitize 를 거친 것)에서 점검 항목을 뽑는다 */
export function extractAiItems(blockHtmls: string[]): AiCheckItem[] {
  const parsed = blockHtmls.map((html) => parseBlockHtml(html))
  const out: AiCheckItem[] = []
  const seen = new Set<string>()
  parsed.forEach(({ text, formats }, bi) => {
    const field = answerField(bi, text)
    const sentences = sentenceRanges(text)
    const covering = (s: number, e: number) => sentences.filter(([a, b]) => a < Math.max(e, s + 1) && b > s)
    // 같은 문장·같은 종류는 한 항목으로 모은다
    const groups = new Map<string, { kind: AiItemKind; range: [number, number]; focus: string[] }>()
    for (const f of formats) {
      if (f.tag !== 'mark' || (f.className !== 'case' && f.className !== 'res')) continue
      const kind = f.className
      const hit = covering(f.start, f.end)
      let range: [number, number] = hit.length ? [hit[0][0], hit[hit.length - 1][1]] : [0, text.length]
      if (kind === 'case' && thin(text.slice(...range))) {
        // 인용만 따로 떨어진 문장이면 앞 문장까지, 그래도 모자라면 문단 전체
        const i = sentences.findIndex(([a]) => a === range[0])
        if (i > 0 && !thin(text.slice(sentences[i - 1][0], range[1]))) range = [sentences[i - 1][0], range[1]]
        else range = [0, text.length]
      }
      const id = `${kind}:${range[0]}-${range[1]}`
      const g = groups.get(id) ?? { kind, range, focus: [] }
      if (kind === 'res') g.focus.push(text.slice(f.start, f.end))
      groups.set(id, g)
    }
    for (const [id, g] of groups) {
      const key = `${field}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      let body = text.slice(...g.range)
      // 문단 전체도 인용뿐이면('[참조 판례] 대법원 …') 바로 앞 블록 글을 앞에 붙여 취지를 함께 보낸다
      if (g.kind === 'case' && thin(body) && bi > 0) body = `${parsed[bi - 1].text}\n${body}`
      out.push({ key, kind: g.kind, block: bi, text: body, focus: g.focus })
    }
  })
  return out
}

export function chunkItems<T>(items: T[], size = AI_BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ── 2. 답안 해시 ─────────────────────────────────────────────

export const answerHashOf = (texts: string[]) => textHash(texts.join('\u0001'))

/** 점검한 뒤 내 답안이 바뀌었으면 true(오래된 결과) */
export const isAiCheckStale = (record: Pick<AiCheckRecord, 'answerHash'>, texts: string[]) =>
  record.answerHash !== answerHashOf(texts)

// ── 3. Gemini 호출 ───────────────────────────────────────────

export const AI_CHECK_PROMPT = `너는 변호사시험 사례형 답안을 점검하는 도우미다. 점수는 매기지 않는다. 각 항목의 모범답안 문장(판례 취지·결론)과 같은 내용이 수험생 답안에 있는지만 비교한다.

가장 중요한 규칙:
- 모범답안은 정답이다. 법리나 판례가 실제로 옳은지는 판단하지 않는다.
- 네가 아는 법률 지식으로 수험생 답안을 평가하지 말고, 항목의 모범답안 문장(판례 취지·결론)과 같은 내용이 수험생 답안에 있는지만 비교한다.
- note에는 입력으로 받은 모범답안 문장과 수험생 답안에 있는 내용만 쓴다. 입력에 없는 판례·법리·전원합의체 등을 인용하거나 지어내지 않는다.
- 소제목은 그 문장이 어느 쟁점에 속하는지 알려 주는 정보이고, 판정은 해당 쟁점에 대한 답안 내용으로만 한다. 다른 쟁점에 대한 답안 내용과 섞지 않는다.

입력(JSON): 문제, 수험생 답안, 점검 항목 목록. 항목마다 key, 종류, 모범답안 문장이 있고, 소제목이 있으면 소제목이, 결론 항목에는 결론 부분이 따로 있다.

종류별 판단 기준:
- 판례 취지: 모범답안 문장에 인용된 판례의 취지(법리·판단 기준)가 답안에 담겼는지 본다. 판례 번호·선고일·법원명은 판단에 쓰지 않는다. 수험생은 판례 번호를 쓰지 않으므로 번호가 없다는 이유로 누락이라 하지 않는다.
- 결론: 결론 부분과 같은 방향의 결론이 수험생 답안에 (해당 쟁점에 대해) 적혀 있으면 담김. 방향이 같지만 일부 요소가 빠졌으면 부분. 해당 쟁점이나 결론이 답안에 없거나 방향이 반대면 누락. 방향이 반대인 경우가 아니면 법리의 옳고 그름을 이유로 누락으로 하지 않는다. 방향은 성립/불성립, 인정/부정, 인용/기각/각하, 적법/위법, 유효/무효, 위헌/합헌, 처분의 내용 등이다.

판정(verdict):
- "담김": 같은 취지 또는 같은 방향의 결론이 해당 쟁점에 대한 답안에 있다. 표현이 달라도 의미가 같으면 담김이다.
- "부분": 일부만 있거나, 방향은 같지만 일부 요소(요건·대상·범위 등)가 빠졌다.
- "누락": 해당 쟁점이나 그 내용이 답안에 없거나, 결론의 방향이 모범답안과 반대다.

evidence: 판정의 근거가 된 답안 속 문장을 답안에서 한 글자도 바꾸지 말고 그대로 옮긴다. 누락이면 빈 문자열("")로 둔다.
note: "모범답안은 ~, 답안은 ~" 형식으로 두 가지를 비교하는 한국어 한 줄.

입력의 모든 항목에 대해 key 를 그대로 돌려준다. 입력에 없는 key 를 만들지 않는다.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          verdict: { type: 'STRING', enum: ['담김', '부분', '누락'] },
          evidence: { type: 'STRING' },
          note: { type: 'STRING' },
        },
        required: ['key', 'verdict', 'evidence', 'note'],
      },
    },
  },
  required: ['items'],
}

export type AiCheckError = 'no-key' | 'network' | 'timeout' | 'aborted' | 'http' | 'format'
export type AiCheckOutcome = { ok: true; record: AiCheckRecord } | { ok: false; code: AiCheckError; message: string }

const KIND_LABEL: Record<AiItemKind, string> = { case: '판례 취지', res: '결론' }
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 블록마다 그 블록 바로 앞의 h1/h2 제목 글자(없으면 ''). types 는 blockHtmls 와 같은 순서의 블록 종류 */
export function headingsOf(types: (string | undefined)[], blockHtmls: string[]): string[] {
  let cur = ''
  return blockHtmls.map((html, i) => {
    const h = cur
    if (types[i] === 'h1' || types[i] === 'h2') cur = squash(parseBlockHtml(html).text)
    return h
  })
}

/**
 * 한 묶음의 요청 본문. 문제·내 답안·모범답안 문장(과 모범답안의 소제목) 외에는 아무것도 넣지 않는다.
 * key 는 짧은 번호(k1…)로 바꿔 보낸다. headings 는 블록 번호 → 소제목(headingsOf)
 */
export function buildRequest(question: string, answer: string, batch: AiCheckItem[], headings: string[] = []) {
  const input = {
    문제: question,
    답안: answer,
    항목: batch.map((it, i) => ({
      key: `k${i + 1}`,
      종류: KIND_LABEL[it.kind],
      ...(headings[it.block] ? { 소제목: headings[it.block] } : {}),
      모범답안: it.text,
      ...(it.kind === 'res' ? { 결론부분: it.focus.join(' / ') } : {}),
    })),
  }
  return {
    systemInstruction: { parts: [{ text: AI_CHECK_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(input, null, 1) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  }
}

/**
 * 응답 검증(이 기기에서). 응답에 없는 항목·모르는 key·형식이 틀린 항목은 '확인불가'.
 * 담김·부분인데 evidence 가 내 답안에 (공백을 정리하고) 들어 있지 않으면 지어낸 근거로 보고 '확인불가'
 */
export function validateResponse(raw: unknown, batch: AiCheckItem[], answer: string): Record<string, AiItemResult> {
  const mine = squash(answer)
  const rows = (raw as { items?: unknown })?.items
  const byShort = new Map<string, Record<string, unknown>>()
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const k = (r as { key?: unknown })?.key
      if (typeof k === 'string' && !byShort.has(k)) byShort.set(k, r as Record<string, unknown>)
    }
  }
  const out: Record<string, AiItemResult> = {}
  batch.forEach((it, i) => {
    const r = byShort.get(`k${i + 1}`)
    if (!r) {
      out[it.key] = { verdict: '확인불가', evidence: '', note: '응답에 이 항목이 없습니다' }
      return
    }
    const { verdict, evidence, note } = r
    if (!['담김', '부분', '누락'].includes(verdict as string) || typeof evidence !== 'string' || typeof note !== 'string') {
      out[it.key] = { verdict: '확인불가', evidence: '', note: '응답 형식이 맞지 않습니다' }
      return
    }
    if (verdict === '누락') {
      out[it.key] = { verdict: '누락', evidence: '', note }
      return
    }
    const ev = squash(evidence)
    if (!ev || !mine.includes(ev)) {
      out[it.key] = { verdict: '확인불가', evidence: '', note: `근거 문장이 내 답안에 없습니다(AI 판정: ${verdict})` }
      return
    }
    out[it.key] = { verdict: verdict as AiVerdict, evidence, note }
  })
  return out
}

class FormatError extends Error {}

async function callBatch(key: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${GEMINI_API}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    throw e instanceof DOMException && e.name === 'AbortError' ? e : new TypeError('network')
  }
  if (!res.ok) throw Object.assign(new Error(await geminiErrorReason(res)), { http: true })
  try {
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return JSON.parse(text)
  } catch {
    throw new FormatError()
  }
}

/**
 * 문항 하나를 점검한다. 키는 getGeminiKey 로만 가져온다. 항목이 AI_BATCH_SIZE 를 넘을 때만 여러 번 부른다.
 * 묶음마다 60초 제한, JSON 을 못 읽으면 그 묶음만 한 번 더 보낸다. signal 로 밖에서 멈출 수 있다
 */
export async function runAiCheck(opts: {
  uid: string
  problem: Problem
  answers: string[] // 이 문항의 내 답안 칸들
  blockHtmls: string[] // 모범답안 블록 html(sanitize 를 거친 것 — 항목 키가 화면의 블록 field 와 맞게)
  signal?: AbortSignal
}): Promise<AiCheckOutcome> {
  const key = getGeminiKey(opts.uid)
  if (!key) return { ok: false, code: 'no-key', message: '설정에서 API 키를 먼저 저장하세요' }

  const items = extractAiItems(opts.blockHtmls)
  const q = opts.problem.question
  const question = q ? [...q.paragraphs, q.ask].filter(Boolean).join('\n') : ''
  const labels = boxesOf(opts.problem).map((b, i, all) => b.label || (all.length > 1 ? `소문항 ${i + 1}` : ''))
  const answer = opts.answers.map((t, i) => (labels[i] ? `[${labels[i]}]\n${t}` : t)).join('\n\n')

  const headings = headingsOf((opts.problem.answer?.blocks ?? []).map((b) => b.t), opts.blockHtmls)

  const results: Record<string, AiItemResult> = {}
  for (const batch of chunkItems(items)) {
    const body = buildRequest(question, answer, batch, headings)
    let raw: unknown
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        ctl.abort()
      }, AI_TIMEOUT_MS)
      const stop = () => ctl.abort()
      opts.signal?.addEventListener('abort', stop)
      try {
        if (opts.signal?.aborted) ctl.abort()
        raw = await callBatch(key, body, ctl.signal)
        break
      } catch (e) {
        if (e instanceof FormatError) {
          if (attempt === 0) continue
          return { ok: false, code: 'format', message: 'AI 응답을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }
        }
        if (e instanceof DOMException && e.name === 'AbortError') {
          return timedOut
            ? { ok: false, code: 'timeout', message: 'AI 응답이 60초 안에 오지 않았습니다. 잠시 뒤 다시 시도해 주세요.' }
            : { ok: false, code: 'aborted', message: '점검을 멈췄습니다' }
        }
        if ((e as { http?: boolean }).http) return { ok: false, code: 'http', message: (e as Error).message }
        return { ok: false, code: 'network', message: GEMINI_NETWORK_ERROR }
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', stop)
      }
    }
    Object.assign(results, validateResponse(raw, batch, answer))
  }
  return {
    ok: true,
    record: { model: GEMINI_MODEL, checkedAt: Date.now(), answerHash: answerHashOf(opts.answers), items: results },
  }
}
