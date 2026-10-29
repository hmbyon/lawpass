/**
 * 사례형 AI 점검(lib/caseStudy/aiCheck) 검증 (check:case-ai-check). 실제 Gemini 는 부르지 않는다 — fetch 와 localStorage 를 가짜로 바꿔 돈다.
 * CASE_JSON_DIR(카드 JSON 폴더)이나 아래 기본 폴더가 있으면 실제 모범답안 전체에서 항목 추출을 돌려 본다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AI_BATCH_SIZE, AI_CHECK_PROMPT, answerHashOf, buildRequest, chunkItems, extractAiItems, headingsOf, isAiCheckStale, runAiCheck, sentenceRanges,
} from '../lib/caseStudy/aiCheck'
import type { Problem } from '../lib/caseStudy/types'
import type { AiCheckOutcome } from '../lib/caseStudy/aiCheck'

// ── 가짜 브라우저 ─────────────────────────────────────────────
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
const UID = 'u1'
const KEY = 'AIzaTESTKEY0000'
store.set(`lawpass_gemini_key_${UID}`, KEY)

type Reply = { status?: number; json?: unknown; text?: string; throws?: boolean }
let replies: Reply[] = []
const calls: { url: string; headers: Record<string, string>; body: { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] } }[] = []
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
  const r = replies.shift()
  if (!r) throw new Error('예상 밖의 호출')
  if (r.throws) throw new TypeError('Failed to fetch')
  const status = r.status ?? 200
  const payload = r.json ?? { candidates: [{ content: { parts: [{ text: r.text ?? '' }] } }] }
  return new Response(JSON.stringify(payload), { status })
}) as typeof fetch
// 스크립트는 strict 없이 컴파일돼 ok 로 좁혀지지 않는다 — 실패 쪽으로 단언해 꺼낸다
type Failed = Extract<AiCheckOutcome, { ok: false }>
const err = (r: AiCheckOutcome): Failed => {
  assert.equal(r.ok, false, '실패해야 한다')
  return r as Failed
}
const ok = (items: unknown[]) => ({ text: JSON.stringify({ items }) })

const law = (s: string) => `<mark class="law">${s}</mark>`
const cs = (s: string) => `<mark class="case">${s}</mark>`
const res = (s: string) => `<mark class="res">${s}</mark>`

// ── 1. 문장 나누기·항목 추출 ─────────────────────────────────────
assert.deepEqual(
  sentenceRanges('甲은 책임진다(대판 2001. 3. 2. 2000다1). 2023. 12. 19. 당시 乙은 “없다.”고 했다.').length,
  2,
  '괄호·따옴표 안과 숫자 뒤 마침표는 문장 끝이 아니다'
)
const blocks = [
  `유익비 상환범위는 임대인이 선택한다(대판 2002.11.22. ${cs('2001다40381')}). 그러나 ${res('乙은 상환할 필요가 없다')}.`,
  `[참조 판례] 대법원 2021.12.30. 선고 ${cs('2018다268538')} 판결`,
  `판례 번호가 없는 문장에서 ${res('甲의 청구는 기각된다')}(${law('민법 제750조')})고 하며 ${res('乙도 책임 없다')}.`,
  `주주명부에 기재된 자는 주주권을 행사한다(${cs('2015다248342')}). 따라서 ${res('결의는 유효하다')}.`,
]
const items = extractAiItems(blocks)
assert.deepEqual(items.map((x) => [x.block, x.kind]), [[0, 'case'], [0, 'res'], [1, 'case'], [2, 'res'], [3, 'case'], [3, 'res']])
assert.equal(items[0].text, '유익비 상환범위는 임대인이 선택한다(대판 2002.11.22. 2001다40381).')
assert.deepEqual(items[1].focus, ['乙은 상환할 필요가 없다'])
assert.match(items[2].text, /^유익비[^]*\n\[참조 판례\]/, '인용만 있는 문단은 앞 블록 글을 함께 보낸다')
assert.deepEqual(items[3].focus, ['甲의 청구는 기각된다', '乙도 책임 없다'], '판례 번호가 없는 문장도 결론 항목, 같은 문장의 결론은 한 항목')
assert.match(items[0].key, /^a0@[0-9a-z]+:case:\d+-\d+$/)
assert.deepEqual(extractAiItems(['조문만 있는 글']), [])
// 같은 문장에 판례·결론이 겹치면 종류별로 따로
assert.deepEqual(extractAiItems([`판례는 ${res('위법하다')}고 본다(${cs('99두1')}).`]).map((x) => x.kind), ['res', 'case'])

// ── 2. 답안 해시 ───────────────────────────────────────────────
assert.equal(isAiCheckStale({ answerHash: answerHashOf(['a', 'b']) }, ['a', 'b']), false)
assert.equal(isAiCheckStale({ answerHash: answerHashOf(['a', 'b']) }, ['a', 'b ']), true)

// ── 3. 호출 ─────────────────────────────────────────────────
const problem = {
  id: 'p1', points: 30, question: { paragraphs: ['사실관계'], ask: '甲의 청구는 인용될 수 있는가?' },
  answer: { blocks: [] },
} as unknown as Problem
const answers = ['임대인이 선택하는 바에 따라 상환범위가 정해진다.\n따라서  乙은 상환할 필요가 없다.']
const run = (blockHtmls = blocks.slice(0, 1)) => runAiCheck({ uid: UID, problem, answers, blockHtmls })

;(async () => {
  // 정상 + 지어낸 evidence + 항목 누락 + 모르는 key
  replies = [ok([
    { key: 'k1', verdict: '담김', evidence: '임대인이 선택하는 바에 따라 상환범위가 정해진다.', note: '취지 있음' },
    { key: 'k9', verdict: '담김', evidence: '', note: '모르는 key' },
  ])]
  let r = await run()
  assert.ok(r.ok)
  assert.equal(r.record.items[items[0].key].verdict, '담김')
  assert.equal(r.record.items[items[1].key].verdict, '확인불가', '응답에 빠진 항목')
  assert.equal(Object.keys(r.record.items).length, 2, '모르는 key 는 버린다')
  assert.equal(r.record.answerHash, answerHashOf(answers))
  // 요청: 키는 헤더로만, 주소에는 없다. JSON 강제·temperature 0
  const c = calls[calls.length - 1]
  assert.equal(c.headers['x-goog-api-key'], KEY)
  assert.ok(!c.url.includes(KEY) && c.url.includes(':generateContent'))
  const sent = JSON.parse(c.body.contents[0].parts[0].text)
  assert.deepEqual(Object.keys(sent), ['문제', '답안', '항목'])
  assert.equal(sent.항목[1].결론부분, '乙은 상환할 필요가 없다')
  const req = buildRequest('q', 'a', items.slice(0, 1))
  assert.equal(req.generationConfig.temperature, 0)
  assert.equal(req.generationConfig.responseMimeType, 'application/json')

  // 소제목: 소제목 블록이 없으면 필드를 빼고 보낸다
  assert.ok(sent.항목.every((x: Record<string, unknown>) => !('소제목' in x)))
  // 항목 블록 바로 앞의 h1/h2 제목을 소제목으로 보낸다(가까운 제목이 이긴다, 제목 블록 자신은 앞 제목)
  assert.deepEqual(
    headingsOf(['h1', 'p', 'h2', 'p', 'h1', 'p'], ['Ⅰ. 쟁점', 'x', '<b>1.  유익비</b>', 'y', 'Ⅱ. 결론', 'z']),
    ['', 'Ⅰ. 쟁점', 'Ⅰ. 쟁점', '1. 유익비', '1. 유익비', 'Ⅱ. 결론']
  )
  const withHead = {
    ...problem,
    answer: { blocks: [{ t: 'h2', html: '1. 유익비상환청구' }, { t: 'p', html: blocks[0] }] },
  } as unknown as Problem
  replies = [ok([])]
  await runAiCheck({ uid: UID, problem: withHead, answers, blockHtmls: ['1. 유익비상환청구', blocks[0]] })
  const c2 = calls[calls.length - 1]
  const sent2 = JSON.parse(c2.body.contents[0].parts[0].text)
  assert.deepEqual(sent2.항목.map((x: Record<string, unknown>) => x.소제목), ['1. 유익비상환청구', '1. 유익비상환청구'])
  assert.deepEqual(Object.keys(sent2.항목[0]), ['key', '종류', '소제목', '모범답안'])
  // systemInstruction 에 자기 법리로 판정하지 말라는 규칙이 들어 있다
  const sys = c2.body.systemInstruction.parts[0].text
  assert.equal(sys, AI_CHECK_PROMPT)
  for (const rule of [
    '모범답안은 정답이다. 법리나 판례가 실제로 옳은지는 판단하지 않는다.',
    '네가 아는 법률 지식으로 수험생 답안을 평가하지 말고',
    '입력에 없는 판례·법리·전원합의체 등을 인용하거나 지어내지 않는다.',
    '방향이 반대인 경우가 아니면 법리의 옳고 그름을 이유로 누락으로 하지 않는다.',
    '"모범답안은 ~, 답안은 ~" 형식',
    '소제목은 그 문장이 어느 쟁점에 속하는지 알려 주는 정보이고, 판정은 해당 쟁점에 대한 답안 내용으로만 한다',
  ]) assert.ok(sys.includes(rule), `systemInstruction 에 규칙 없음: ${rule}`)

  // 공백만 다른 evidence 는 인정, 내 답안에 없는 evidence 는 확인불가, 누락이면 evidence 를 비운다
  replies = [ok([
    { key: 'k1', verdict: '부분', evidence: '임대인이  선택하는 바에\n따라', note: '' },
    { key: 'k2', verdict: '담김', evidence: '乙은 상환의무가 없다고 썼다', note: '' },
  ])]
  r = await run()
  assert.ok(r.ok)
  assert.equal(r.record.items[items[0].key].verdict, '부분')
  assert.equal(r.record.items[items[1].key].verdict, '확인불가')
  assert.match(r.record.items[items[1].key].note, /근거 문장이 내 답안에 없습니다/)
  replies = [ok([{ key: 'k1', verdict: '누락', evidence: '아무거나', note: '없음' }, { key: 'k2', verdict: '모름', evidence: '', note: '' }])]
  r = await run()
  assert.ok(r.ok)
  assert.deepEqual(r.record.items[items[0].key], { verdict: '누락', evidence: '', note: '없음' })
  assert.equal(r.record.items[items[1].key].verdict, '확인불가', '형식이 틀린 항목')

  // 잘못된 JSON: 한 번만 다시 보낸다
  replies = [{ text: '{"items": [' }, ok([])]
  let before = calls.length
  r = await run()
  assert.ok(r.ok)
  assert.equal(calls.length - before, 2)
  replies = [{ text: 'nope' }, { text: 'nope' }]
  before = calls.length
  r = await run()
  assert.ok(err(r).code === 'format')
  assert.equal(calls.length - before, 2, '재시도는 1회뿐')

  // 오류 분류(연결 테스트와 같은 문구), 키는 문구에 없다
  replies = [{ status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED' } } }]
  r = await run()
  assert.ok(err(r).code === 'http' && /한도/.test(err(r).message))
  replies = [{ status: 401, json: { error: {} } }]
  r = await run()
  assert.ok(/키가 올바르지 않습니다/.test(err(r).message) && !err(r).message.includes(KEY))
  replies = [{ status: 400, json: { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } }]
  r = await run()
  assert.ok(/키가 올바르지 않습니다/.test(err(r).message))
  replies = [{ throws: true }]
  r = await run()
  assert.ok(err(r).code === 'network' && /네트워크/.test(err(r).message))

  // 항목 25개 초과면 나눠 부른다
  const many = Array.from({ length: 30 }, (_, i) => `문장 ${i}의 결론은 ${res(`결론${i}`)}이다.`)
  assert.equal(extractAiItems(many).length, 30)
  assert.deepEqual(chunkItems(extractAiItems(many)).map((b) => b.length), [AI_BATCH_SIZE, 5])
  replies = [ok([]), ok([])]
  before = calls.length
  r = await run(many)
  assert.ok(r.ok)
  assert.equal(calls.length - before, 2)
  assert.equal(Object.keys(r.record.items).length, 30)

  // 키 없음: 호출하지 않는다
  store.delete(`lawpass_gemini_key_${UID}`)
  before = calls.length
  r = await run()
  assert.ok(err(r).code === 'no-key' && err(r).message === '설정에서 API 키를 먼저 저장하세요')
  assert.equal(calls.length, before)

  // ── 4. 실제 카드 데이터 ───────────────────────────────────────
  const DEFAULT_DIR = path.join(
    os.homedir(),
    'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
  )
  const dir = process.env.CASE_JSON_DIR || DEFAULT_DIR
  if (!fs.existsSync(dir)) {
    console.log(`카드 JSON 폴더가 없어 실제 데이터 점검은 건너뜀 (${dir})`)
  } else {
    let problems = 0
    let total = 0
    let max = 0
    let maxId = ''
    let cases = 0
    let wide = 0
    let noHead = 0
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== '_index.json')) {
      const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      for (const p of card.problems ?? []) {
        const htmls: string[] = (p.answer?.blocks ?? []).map((b: { html: string }) => b.html)
        if (htmls.length === 0) continue
        const its = extractAiItems(htmls)
        const heads = headingsOf(p.answer.blocks.map((b: { t: string }) => b.t), htmls)
        noHead += its.filter((x) => !heads[x.block]).length
        assert.equal(new Set(its.map((x) => x.key)).size, its.length, `${p.id}: 항목 키 중복`)
        for (const it of its) assert.ok(it.text.trim(), `${p.id}: 빈 항목`)
        problems++
        total += its.length
        cases += its.filter((x) => x.kind === 'case').length
        wide += its.filter((x) => x.kind === 'case' && x.text.includes('\n')).length
        if (its.length > max) [max, maxId] = [its.length, p.id]
      }
    }
    console.log(`문항 ${problems}개 · 점검 항목 ${total}개(판례 ${cases} · 결론 ${total - cases}) · 문항당 평균 ${(total / problems).toFixed(1)}개 · 최대 ${max}개(${maxId})`)
    console.log(`판례 항목 중 앞 블록 글을 함께 보낸 것 ${wide}개 · 소제목 없이 보내는 항목 ${noHead}개`)
  }
  console.log('check:case-ai-check 통과')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
