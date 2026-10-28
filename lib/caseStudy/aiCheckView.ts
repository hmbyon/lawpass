// 상대 경로: check:case-ai-check-ui 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { parseBlockHtml } from './answerFormats'
import type { AiCheckItem, AiCheckRecord, AiVerdict } from './aiCheck'

/**
 * AI 점검 결과를 모범답안 화면에 붙이는 순수 함수(화면·저장 없음).
 * 점은 항목의 블록·구간 안에서 처음 나오는 같은 종류의 표시(mark.case / mark.res) 바로 뒤에 단다
 */

const RANGE = /:(case|res):(\d+)-(\d+)$/

/**
 * 항목 → 점 자리. 반환: 블록 번호 → '{종류}:{그 블록에서 그 종류 표시의 순서}' → 항목 키들.
 * 구간 안에 그 종류 표시가 없으면(카드가 고쳐진 경우 등) 점을 달지 않는다
 */
export function aiDotTargets(blockHtmls: string[], items: AiCheckItem[]): Record<number, Record<string, string[]>> {
  const out: Record<number, Record<string, string[]>> = {}
  const formatsOf = new Map<number, ReturnType<typeof parseBlockHtml>['formats']>()
  for (const it of items) {
    const m = RANGE.exec(it.key)
    if (!m || blockHtmls[it.block] === undefined) continue
    const [, kind, s, e] = m
    if (!formatsOf.has(it.block)) formatsOf.set(it.block, parseBlockHtml(blockHtmls[it.block]).formats)
    const same = formatsOf.get(it.block)!.filter((f) => f.tag === 'mark' && f.className === kind)
    const nth = same.findIndex((f) => f.start >= Number(s) && f.start < Number(e))
    if (nth < 0) continue
    const slot = (out[it.block] ??= {})
    ;(slot[`${kind}:${nth}`] ??= []).push(it.key)
  }
  return out
}

/** sanitize 를 거친 html 의 mark.case·mark.res 마다 닫는 태그 바로 뒤에 insert(종류, 그 종류의 순서)를 넣는다 */
export function insertAfterMarks(html: string, insert: (kind: 'case' | 'res', nth: number) => string): string {
  let out = ''
  const count = { case: 0, res: 0 }
  const stack: ({ kind: 'case' | 'res'; nth: number } | null)[] = []
  for (const m of html.matchAll(/<(\/?)mark\b([^>]*)>|<[^>]*>|[^<]+|</g)) {
    out += m[0]
    if (m[1] === '') {
      const kind = /class="\s*(case|res)\s*"/.exec(m[2] ?? '')?.[1] as 'case' | 'res' | undefined
      stack.push(kind ? { kind, nth: count[kind]++ } : null)
    } else if (m[1] === '/') {
      const top = stack.pop()
      if (top) out += insert(top.kind, top.nth)
    }
  }
  return out
}

/** 최종 판정 — 직접 고친 값이 있으면 그것 */
export const finalVerdict = (r: { verdict: AiVerdict; userVerdict?: AiVerdict }): AiVerdict => r.userVerdict ?? r.verdict

/** 요약: 판례 취지 담김 n/m · 결론 담김 n/m · 확인불가 k (지금 모범답안의 항목 중 결과가 있는 것만 센다) */
export function aiSummary(items: AiCheckItem[], record: AiCheckRecord) {
  const s = { case: { ok: 0, total: 0 }, res: { ok: 0, total: 0 }, unknown: 0, missing: 0 }
  for (const it of items) {
    const r = record.items[it.key]
    if (!r) continue
    const v = finalVerdict(r)
    s[it.kind].total++
    if (v === '담김') s[it.kind].ok++
    if (v === '확인불가') s.unknown++
    if (v === '누락') s.missing++
  }
  return s
}

/** 직접 고친 값을 넣는다. v 가 없거나 자동 판정과 같으면 직접 고친 표시를 지운다(자동 판정으로 되돌리기) */
export function setUserVerdict(record: AiCheckRecord, key: string, v?: AiVerdict): AiCheckRecord {
  const cur = record.items[key]
  if (!cur) return record
  const { userVerdict: _old, ...rest } = cur
  const next = !v || v === cur.verdict ? rest : { ...rest, userVerdict: v }
  return { ...record, items: { ...record.items, [key]: next } }
}

/** 다시 점검하기 전에 확인할 직접 고친 값이 있는가 */
export const hasUserVerdicts = (record: AiCheckRecord) => Object.values(record.items).some((r) => r.userVerdict)
