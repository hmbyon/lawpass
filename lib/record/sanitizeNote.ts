/**
 * 기록형 정리본 html 조각용 화이트리스트 sanitizer. 사례형 sanitizeCaseHtml 과 같은 방식이다 —
 * 문자열 치환이 아니라 DOMParser 로 실제 트리를 만들어 걷는다(text/html 파싱은 스크립트를 실행하지 않는다).
 *
 * 남기는 것: <b> <u> <i> <s> <br>, <mark>(class 없음 또는 g·law·case·res), <span class="c1"~"c5">,
 * <p>(class 는 al-c·al-r 만, 그 밖이면 속성 없는 <p>). 속성은 위의 class 하나뿐이다. 그 밖의 태그는 벗기고 글자만 남기고, 스크립트류는 내용째 버린다
 */

const PLAIN_TAGS = new Set(['b', 'u', 'i', 's'])
const MARK_CLASSES = new Set(['g', 'law', 'case', 'res'])
const SPAN_CLASSES = new Set(['c1', 'c2', 'c3', 'c4', 'c5'])
const P_CLASSES = new Set(['al-c', 'al-r'])
// lib/caseStudy/sanitize.ts 의 DROP_WITH_CONTENT 와 같은 목록
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'svg', 'math',
])
const TEXT_NODE = 3
const ELEMENT_NODE = 1

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function walk(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === TEXT_NODE) {
      out += escapeText(child.textContent ?? '')
      return
    }
    if (child.nodeType !== ELEMENT_NODE) return // 주석 등
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (DROP_WITH_CONTENT.has(tag)) return
    if (tag === 'br') {
      out += '<br>'
      return
    }
    const inner = walk(el)
    const cls = el.getAttribute('class')
    if (PLAIN_TAGS.has(tag)) {
      out += `<${tag}>${inner}</${tag}>`
    } else if (tag === 'mark' && !cls) {
      out += `<mark>${inner}</mark>`
    } else if (tag === 'mark' && MARK_CLASSES.has(cls!)) {
      out += `<mark class="${cls}">${inner}</mark>`
    } else if (tag === 'span' && cls && SPAN_CLASSES.has(cls)) {
      out += `<span class="${cls}">${inner}</span>`
    } else if (tag === 'p') {
      // 표 셀 안의 문단 경계. 정렬 class 만 남긴다
      out += cls && P_CLASSES.has(cls) ? `<p class="${cls}">${inner}</p>` : `<p>${inner}</p>`
    } else {
      out += inner
    }
  })
  return out
}

export function sanitizeNote(html: string): string {
  // DOMParser 가 없는 곳(서버 렌더)에서는 아무것도 그리지 않는다 — 걸러지지 않은 원문을 내보내지 않는다
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html ?? ''}`, 'text/html')
  return walk(doc.body)
}
