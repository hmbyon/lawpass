/**
 * 카드 html 필드용 화이트리스트 sanitizer.
 *
 * 남기는 것: <mark class="law|case|res">, <u>, <b>, <br> — 속성은 mark 의 class 하나뿐.
 * 그 밖의 태그는 벗겨내고 글자만 남긴다. 스크립트류는 내용까지 버린다.
 * 문자열 치환이 아니라 DOMParser 로 실제 트리를 만들어 걷는다 — 정규식은 깨진 태그·
 * 속성 안의 '>' 같은 경우를 놓친다. text/html 파싱은 스크립트를 실행하지 않는다
 */

const MARK_CLASSES = new Set(['law', 'case', 'res'])
const PLAIN_TAGS = new Set(['u', 'b'])
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
