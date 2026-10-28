/**
 * 사례형 조문 점검(lib/caseStudy/statuteCheck) 검증 (check:case-statute-check).
 * 다른 check:* 처럼 tsc 로 CommonJS 로 떨궈 node 로 돈다.
 * CASE_JSON_DIR(카드 JSON 폴더)이나 아래 기본 폴더가 있으면 실제 모범답안 전체에서 조문 추출을 돌려 본다
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  answerRefs, insertAfterLawMarks, judgeStatutes, modelStatutes, nextStatus, statuteLabel,
} from '../lib/caseStudy/statuteCheck'

const law = (s: string) => `<mark class="law">${s}</mark>`
// 모범답안 블록들과 내 답안 → 모범답안 조문 라벨별 판정
function judge(blocks: string[], mine: string | string[]) {
  const model = modelStatutes(blocks)
  const res = judgeStatutes(model.items, answerRefs(Array.isArray(mine) ? mine : [mine]))
  return Object.fromEntries(model.items.map((x) => [statuteLabel(x.ref), res[x.key]]))
}

// ── 1. 표기 변형 ─────────────────────────────────────────────
for (const mine of ['제355조', '355조', '§355', '§ 355', '형법 제355조', '형법 355조']) {
  assert.deepEqual(judge([`횡령죄(${law('형법 제355조')})`], `${mine}에 따라`), { '형법 제355조': 'ok' }, mine)
}
for (const mine of ['제355조 제1항', '제355조①', '355조 1항', '§355①', '355조1항']) {
  assert.deepEqual(judge([law('형법 제355조 제1항')], mine), { '형법 제355조 제1항': 'ok' }, mine)
}
assert.deepEqual(judge([law('제244조의2')], '제244조의 2 위반'), { '제244조의2': 'ok' })
assert.deepEqual(judge([law('제244조의2')], '제244조 위반'), { '제244조의2': 'missing' }, '가지번호가 다르면 다른 조문')
assert.deepEqual(judge([law('제32조 제1항 제3호')], '제32조 제1항 제3호'), { '제32조 제1항 제3호': 'ok' })
assert.deepEqual(judge([law('제32조 제1항 제3호')], '제32조 제1항 제2호'), { '제32조 제1항 제3호': 'partial' })

// ── 2. 약칭 ─────────────────────────────────────────────────
assert.deepEqual(judge([law('민사소송법 제202조의2')], '민소법 제202조의2'), { '민사소송법 제202조의2': 'ok' })
assert.deepEqual(judge([law('민사소송법 제218조')], '민소 제218조'), { '민사소송법 제218조': 'ok' })
assert.deepEqual(judge([law('형사소송법 제312조 제4항')], '형소법 312조 4항'), { '형사소송법 제312조 제4항': 'ok' })
assert.deepEqual(judge([law('행정소송법 제12조')], '행소법 제12조'), { '행정소송법 제12조': 'ok' })
assert.deepEqual(judge([law('헌법재판소법 제68조 제2항')], '헌재법 제68조 제2항'), { '헌법재판소법 제68조 제2항': 'ok' })
assert.deepEqual(judge([law('헌재법 제68조')], '헌법재판소법 제68조'), { '헌법재판소법 제68조': 'ok' })

// ── 3. 법명 ─────────────────────────────────────────────────
assert.deepEqual(judge([law('민법 제750조')], '형법 제750조'), { '민법 제750조': 'missing' }, '법명이 둘 다 적혀 있고 다르면 다른 조문')
assert.deepEqual(judge([law('민법 제750조')], '제750조'), { '민법 제750조': 'ok' }, '내 답안에 법명이 없으면 조 번호로 인정')
// 모범답안 법명 이어받기(표시 밖 글자도 본다) — 이어받은 법명은 내 답안 법명과 비교하지 않는다
assert.deepEqual(judge(['민법 제390조에 따라', law('제750조')], '형법 제750조'), { '민법 제750조': 'ok' })
assert.deepEqual(judge([law('같은 법 제402조')], '제402조'), { '제402조': 'ok' }, '앞선 법명이 없으면 미지정')
// 내 답안도 법명을 이어받는다
// 이어받은 법명은 '붙어 있는' 법명이 아니라 비교하지 않는다
assert.deepEqual(judge([law('민법 제750조')], '형법 제30조, 제750조'), { '민법 제750조': 'ok' })
assert.deepEqual(judge([law('민법 제750조')], ['형법 제30조', '민법 제390조 및 제750조']), { '민법 제750조': 'ok' })
// '위법'·'방법' 같은 낱말은 법명이 아니다
assert.deepEqual(judge([law('민법 제750조')], '위법 제750조'), { '민법 제750조': 'ok' })

// ── 4. 항·호 불일치, 같은 조 ─────────────────────────────────────
assert.deepEqual(judge([law('제260조 제1항')], '제260조 제2항'), { '제260조 제1항': 'partial' })
assert.deepEqual(judge([law('제260조 제1항')], '제260조'), { '제260조 제1항': 'partial' })
assert.deepEqual(judge([law('제260조')], '제260조 제2항'), { '제260조': 'ok' }, '모범답안에 항이 없으면 조만 맞으면 된다')
assert.deepEqual(judge([law('제18조 제1항'), law('같은 조 제3항 단서')], '제18조 제3항'), {
  '제18조 제1항': 'partial', '제18조 제3항': 'ok',
})
assert.deepEqual(judge([law('제157조, 제129조')], '제129조'), { '제157조': 'missing', '제129조': 'ok' })
assert.deepEqual(judge([law('제18조 제1항'), law('제2항')], '제18조 제2항'), { '제18조 제1항': 'partial', '제18조 제2항': 'ok' })
assert.deepEqual(judge([law('제18조')], '제18조 제1항, 제2항'), { '제18조': 'ok' })
// '항소'·'조원' 은 조문이 아니다
assert.equal(answerRefs(['1조원을 2항소했다']).length, 0)

// ── 5. 중복 조문, 조문 없는 모범답안 ───────────────────────────────
{
  const m = modelStatutes([`${law('민법 제750조')}에 의하면`, `다시 ${law('민법 제750조')} 및 ${law('제750조')}`])
  assert.equal(m.items.length, 1, '같은 조문은 한 번만 점검')
  assert.deepEqual(m.marks, [[[m.items[0].key]], [[m.items[0].key], [m.items[0].key]]], '점은 나온 곳마다')
  const none = modelStatutes(['<mark class="res">결론</mark>', '조문이 없는 블록'])
  assert.deepEqual(none.items, [])
  assert.deepEqual(none.marks, [[], []])
  assert.deepEqual(judgeStatutes(none.items, answerRefs(['제1조'])), {})
}

// ── 6. 점 넣기·순환 ─────────────────────────────────────────────
assert.equal(
  insertAfterLawMarks(`<mark class="res">${law('제1조')}에 따라</mark> <u>x</u> ${law('제2조')}`, (i) => `[${i}]`),
  `<mark class="res">${law('제1조')}[0]에 따라</mark> <u>x</u> ${law('제2조')}[1]`
)
assert.equal(nextStatus('ok'), 'partial')
assert.equal(nextStatus('partial'), 'missing')
assert.equal(nextStatus('missing'), 'ok')

// ── 7. 실제 카드 데이터 ─────────────────────────────────────────
const DEFAULT_DIR = path.join(
  os.homedir(),
  'Library/CloudStorage/OneDrive-개인/05 SKALA/+. 나만의 웹사이트 만들기/LawPass AI/사례형 정리/산출물/업로드용/JSON'
)
const dir = process.env.CASE_JSON_DIR || DEFAULT_DIR
if (!fs.existsSync(dir)) {
  console.log(`카드 JSON 폴더가 없어 실제 데이터 점검은 건너뜀 (${dir})`)
} else {
  let problems = 0
  let marks = 0
  let emptyMarks = 0
  let refs = 0
  let unknownLaw = 0
  const emptySamples: string[] = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== '_index.json')) {
    const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const p of card.problems ?? []) {
      const blocks: string[] = (p.answer?.blocks ?? []).map((b: { html: string }) => b.html)
      if (blocks.length === 0) continue
      problems++
      const m = modelStatutes(blocks)
      // 점 넣기가 표시 수와 맞는지
      blocks.forEach((html, bi) => {
        let n = 0
        insertAfterLawMarks(html, () => (n++, ''))
        assert.equal(n, m.marks[bi].length, `${p.id} 블록 ${bi}: 조문 표시 수가 어긋난다`)
        m.marks[bi].forEach((keys, li) => {
          marks++
          if (keys.length === 0) {
            emptyMarks++
            const t = [...html.matchAll(/<mark class="law">([^]*?)<\/mark>/g)][li]?.[1]
            if (t && emptySamples.length < 12) emptySamples.push(t)
          }
        })
      })
      refs += m.items.length
      unknownLaw += m.items.filter((x) => x.ref.law === null).length
    }
  }
  console.log(`문항 ${problems}개 · 조문 표시 ${marks}개 · 점검할 조문(문항별 중복 제외) ${refs}개`)
  console.log(`법명 미지정 조문 ${unknownLaw}개 · 조문을 못 읽은 표시 ${emptyMarks}개`)
  if (emptySamples.length) console.log(`  못 읽은 표시 예: ${emptySamples.map((s) => JSON.stringify(s)).join(', ')}`)
}

console.log('check:case-statute-check 통과')
