/**
 * 카드 html 필드용 화이트리스트 sanitizer.
 *
 * 남기는 것: <mark class="law|case|res">, <u>, <b>, <br> — 속성은 mark 의 class 하나뿐.
 * 그 밖의 태그는 벗겨내고 글자만 남긴다(p·div·li 는 경계에 <br> 하나). 스크립트류는 내용까지 버린다.
 * 문자열 치환이 아니라 DOMParser 로 실제 트리를 만들어 걷는다 — 정규식은 깨진 태그·
 * 속성 안의 '>' 같은 경우를 놓친다. text/html 파싱은 스크립트를 실행하지 않는다
 */

import type { Card, CaseIndex } from './types'
import { normalizeCaseNumber } from '../caseDigest'

const MARK_CLASSES = new Set(['law', 'case', 'res'])
const PLAIN_TAGS = new Set(['u', 'b'])
const BLOCK_TAGS = new Set(['p', 'div', 'li'])
// 글자로 남겨도 의미가 없거나(스타일·스크립트 원문) 위험한 것은 내용째 버린다
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'svg', 'math',
])

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function walk(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.textContent ?? '')
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return // 주석 등
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (DROP_WITH_CONTENT.has(tag)) return
    if (tag === 'br') {
      out += '<br>'
      return
    }
    const inner = walk(el)
    if (tag === 'mark') {
      const cls = el.getAttribute('class')?.trim() ?? ''
      out += MARK_CLASSES.has(cls) ? `<mark class="${cls}">${inner}</mark>` : inner
    } else if (PLAIN_TAGS.has(tag)) {
      out += `<${tag}>${inner}</${tag}>`
    } else if (BLOCK_TAGS.has(tag)) {
      // notes 는 <p> 여러 개로 온다. 태그는 버리되 문단 경계는 줄바꿈으로 살린다
      out += inner && el.nextSibling ? `${inner}<br>` : inner
    } else {
      out += inner
    }
  })
  return out
}

export function sanitizeCaseHtml(html: string): string {
  // DOMParser 가 없는 곳(서버 렌더)에서는 아무것도 그리지 않는다 — 걸러지지 않은 원문을 내보내지 않는다
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  return walk(doc.body)
}

// ── 판례번호 목록(cases, 색인 v1.1) ───────────────────────────────────
// 색인·카드에 실려 Firestore 로 가고, 나중에 판례 화면이 사건번호로 쓴다. 판례번호는 짧은 정해진
// 형식이라 글자 종류를 좁혀 받는다 — HTML 조각이나 긴 문장이 섞여 들어오면 그 항목만 버린다

export const CASES_MAX_LEN = 40
export const CASES_MAX_PER_PROBLEM = 50
export const CASES_MAX_PER_CARD = 200
// 숫자·한글·공백·하이픈·쉼표만 ("95다8713", "2017도16593-1", "2007다37394, 37400")
const CASE_CHARS = /^[0-9가-힣\s,-]+$/

type Warn = (message: string) => void

/** 문자열 배열만 받아 trim·빈값 제거·길이/문자/개수 제한을 건다. 배열이 아니면 undefined(필드를 버린다) */
export function sanitizeCaseList(value: unknown, max: number, where: string, warn: Warn): string[] | undefined {
  if (!Array.isArray(value)) {
    warn(`${where}: cases 가 배열이 아니라 버렸습니다`)
    return undefined
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      warn(`${where}: 문자열이 아닌 판례번호를 버렸습니다 (${String(JSON.stringify(item)).slice(0, 20)})`)
      continue
    }
    const s = item.trim()
    if (!s) continue
    if (s.length > CASES_MAX_LEN) {
      warn(`${where}: ${CASES_MAX_LEN}자를 넘는 판례번호를 버렸습니다 (${s.slice(0, 20)}…)`)
      continue
    }
    if (!CASE_CHARS.test(s)) {
      warn(`${where}: 허용하지 않는 문자가 든 판례번호를 버렸습니다 (${s})`)
      continue
    }
    out.push(s)
  }
  if (out.length > max) {
    warn(`${where}: 판례번호가 ${out.length}개라 앞 ${max}개만 남겼습니다`)
    out.length = max
  }
  return out
}

// 필드가 있을 때만 손댄다. 버릴 때는 키를 지운다 — Firestore 는 undefined 값을 쓰지 못한다
function cleanCases(o: { cases?: unknown }, max: number, where: string, warn: Warn) {
  if (!('cases' in o)) return
  const v = sanitizeCaseList(o.cases, max, where, warn)
  if (v === undefined) delete o.cases
  else o.cases = v
}

/** 가져온 색인의 카드·문항 cases 를 제자리에서 정리하고 경고를 돌려준다. v1(필드 없음)은 그대로 통과 */
export function sanitizeIndexCases(index: CaseIndex): string[] {
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)
  for (const c of index.cards) {
    cleanCases(c, CASES_MAX_PER_CARD, `색인 ${c.id}`, warn)
    for (const p of c.problems ?? []) cleanCases(p, CASES_MAX_PER_PROBLEM, `색인 ${p.id}`, warn)
  }
  return warnings
}

/** 카드 문서의 카드·문항 cases 를 제자리에서 정리하고 경고를 돌려준다 */
export function sanitizeCardCases(card: Card): string[] {
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)
  cleanCases(card, CASES_MAX_PER_CARD, `카드 ${card.id}`, warn)
  for (const p of card.problems ?? []) cleanCases(p, CASES_MAX_PER_PROBLEM, `카드 ${p.id}`, warn)
  return warnings
}

/** 가져오기 요약용: 판례가 달린 색인 카드 수와 판례 종류 수(정규화 key 기준). 판례가 하나도 없으면 v1 형식이다 */
export function indexCaseStats(index: CaseIndex): { cards: number; cases: number } {
  const keys = new Set<string>()
  let cards = 0
  for (const c of index.cards) {
    const all = [...(c.cases ?? []), ...(c.problems ?? []).flatMap((p) => p.cases ?? [])]
    if (all.length > 0) cards++
    for (const n of all) keys.add(normalizeCaseNumber(n))
  }
  return { cards, cases: keys.size }
}
