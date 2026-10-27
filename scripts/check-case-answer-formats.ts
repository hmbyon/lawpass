/**
 * 사례형 모범답안 블록 html → (글자, 기본 서식 구간) 변환과, 그 구간을 renderHighlighted 의 기본 서식 층으로
 * 그린 결과가 원래 html 과 같은지 검증한다 (check:case-answer-formats).
 * 테스트 러너가 없어서 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돌린다.
 *
 * 카드 데이터는 저장소에 없다. CASE_JSON_DIR(카드 JSON 폴더)이 있으면 그 안의 모범답안 블록 전체를 비교하고,
 * 없으면 아래 기본 폴더를 보고, 그것도 없으면 전체 비교만 건너뛴다(고정 예시는 늘 돈다)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderHighlighted, type Highlight } from '../lib/highlights'
import { answerField, decodeEntities, hiddenKey, parseBlockHtml, textHash } from '../lib/caseStudy/answerFormats'

// 태그·글자 순서로 펼친다(글자는 엔티티를 풀고 이어 붙인다). 같은 구조면 같은 목록이 나온다
function tokens(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const t = decodeEntities(m[4])
      if (out.length && out[out.length - 1].startsWith('#')) out[out.length - 1] += t
      else out.push('#' + t)
      continue
    }
    const tag = m[2].toLowerCase()
    const cls = /class="([^"]*)"/.exec(m[3] ?? '')?.[1]?.trim()
    out.push(m[1] ? `</${tag}>` : `<${tag}${cls ? '.' + cls : ''}>`)
  }
  return out
}

const plain = (html: string) => decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
const draw = (text: string, hs: Highlight[], formats: ReturnType<typeof parseBlockHtml>['formats']) =>
  renderToStaticMarkup(React.createElement('span', null, renderHighlighted(text, 'f', hs, undefined, [], formats)))
const inner = (html: string) => html.replace(/^<span>/, '').replace(/<\/span>$/, '')

// ── 1. 고정 예시 ─────────────────────────────────────────────
{
  const html = '甲은 <mark class="res"><mark class="law">민법 제750조</mark>에 따라</mark> <u>손해배상</u>을 &lt;청구&gt;할 수 <b>있다</b>'
  const { text, formats } = parseBlockHtml(html)
  assert.equal(text, '甲은 민법 제750조에 따라 손해배상을 <청구>할 수 있다')
  assert.deepEqual(
    formats.map((f) => [f.id, f.tag, f.className ?? '']),
    [['res:3-15', 'mark', 'res'], ['law:3-11', 'mark', 'law'], ['u:16-20', 'u', ''], ['b:30-32', 'b', '']]
  )
  // 기본 서식 층만 그리면 원래 구조 그대로(안긴 mark 도 안긴 채)
  assert.deepEqual(tokens(inner(draw(text, [], formats))), tokens(html))
  // 형광펜이 서식 경계에 걸려도 글자는 한 번씩만 나온다
  const hs: Highlight[] = [{ id: 'h1', field: 'f', start: 5, end: 19, color: 'yellow', styles: ['fill'] }]
  assert.equal(plain(draw(text, hs, formats)), text)
  // 괄호는 기존 서식 안에 들어가 그 자리에서 서식이 끊기지 않는다(서식 조각이 하나로 남는다)
  const br: Highlight[] = [{ id: 'k1', field: 'f', start: 6, end: 6, color: 'red', bracket: '[' }]
  const withBr = draw(text, br, formats)
  assert.equal(withBr.match(/<mark class="law">/g)?.length, 1, '괄호 때문에 조문 칠이 둘로 갈렸다')
  assert.match(withBr, /<mark class="law">[^]*hl-bracket[^]*<\/mark>/)
  assert.equal(plain(withBr), text)
  // 같은 범위를 감싼 두 태그는 원래 안긴 순서대로 그린다
  const same = '<u><mark class="res">적법함</mark></u>.'
  assert.deepEqual(tokens(inner(draw(parseBlockHtml(same).text, [], parseBlockHtml(same).formats))), tokens(same))
  // br 은 줄바꿈 글자, 같은 자리 같은 종류는 번호로 가른다(바깥 것이 먼저)
  assert.equal(parseBlockHtml('가<br>나').text, '가\n나')
  assert.deepEqual(parseBlockHtml('<mark class="res"><mark class="res">x</mark></mark>').formats.map((f) => f.id), ['res:0-1#2', 'res:0-1'])
  // 해시·키
  assert.equal(textHash('abc'), textHash('abc'))
  assert.notEqual(textHash('abc'), textHash('abd'))
  assert.match(answerField(3, 'abc'), /^a3@[0-9a-z]+$/)
  assert.equal(hiddenKey('a3@x', 'law:0-2'), 'a3@x:law:0-2')
}

// ── 2. 카드 JSON 의 모범답안 블록 전체 ──────────────────────────────
const DEFAULT_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
)
const dir = process.env.CASE_JSON_DIR || DEFAULT_DIR
if (!fs.existsSync(dir)) {
  console.log(`카드 JSON 폴더가 없어 전체 비교는 건너뜀 (${dir})`)
} else {
  let blocks = 0
  let formats = 0
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== '_index.json')) {
    const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const p of card.problems ?? []) {
      for (const [i, b] of (p.answer?.blocks ?? []).entries()) {
        const parsed = parseBlockHtml(b.html)
        const where = `${p.id} 블록 ${i}`
        assert.equal(parsed.text, plain(b.html), `${where}: 글자가 원문과 다르다`)
        assert.deepEqual(tokens(inner(draw(parsed.text, [], parsed.formats))), tokens(b.html), `${where}: 그린 구조가 원문과 다르다`)
        assert.equal(new Set(parsed.formats.map((x) => x.id)).size, parsed.formats.length, `${where}: 서식 id 중복`)
        blocks++
        formats += parsed.formats.length
      }
    }
  }
  assert.ok(blocks > 0, '모범답안 블록이 하나도 없다')
  console.log(`모범답안 블록 ${blocks}개 · 기본 서식 ${formats}개 — 글자·구조 모두 원문과 같음`)
}

console.log('check:case-answer-formats 통과')
