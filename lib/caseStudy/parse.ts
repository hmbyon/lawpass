import type { Card, CaseIndex } from '@/lib/caseStudy/types'
import { sanitizeCardCases, sanitizeIndexCases } from '@/lib/caseStudy/sanitize'

// warnings: 파일은 받되 일부 항목(cases)을 버렸다는 알림. 저장을 막지 않는다
export type ParsedFile =
  | { kind: 'index'; name: string; index: CaseIndex; warnings: string[] }
  | { kind: 'card'; name: string; card: Card; warnings: string[] }

// 가져오기 전 최소 검증. 형식이 어긋난 파일은 저장하지 않고 사유를 돌려준다(throw)
export function parseCaseFile(name: string, text: string): ParsedFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('JSON 형식이 아닙니다')
  }
  const obj = data as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('최상위가 객체가 아닙니다')
  if (obj.schema !== 1) throw new Error(`schema 가 1 이 아닙니다 (${String(obj.schema)})`)
  if (name === '_index.json') {
    if (!Array.isArray(obj.cards)) throw new Error('cards 배열이 없습니다')
    if (obj.cards.some((c) => typeof (c as { id?: unknown })?.id !== 'string')) throw new Error('id 없는 색인 항목이 있습니다')
    const index = obj as unknown as CaseIndex
    return { kind: 'index', name, index, warnings: sanitizeIndexCases(index) }
  }
  if (typeof obj.id !== 'string' || !obj.id) throw new Error('id 가 없습니다')
  // Firestore 문서 id 로 쓰므로 '/' 가 들어가면 경로가 갈라진다
  if (obj.id.includes('/')) throw new Error(`id 에 '/' 가 들어 있습니다 (${obj.id})`)
  if (!Array.isArray(obj.problems)) throw new Error('problems 배열이 없습니다')
  const card = obj as unknown as Card
  return { kind: 'card', name, card, warnings: sanitizeCardCases(card) }
}

// 일괄 쓰기 단위로 나눈다. 건수와 바이트 둘 다 넘지 않게 — 항목 하나가 예산을 넘으면 그것만 단독 묶음이다
export function chunkForBatch<T>(items: T[], maxOps: number, maxBytes: number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let bytes = 0
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).length
    if (cur.length > 0 && (cur.length >= maxOps || bytes + size > maxBytes)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(item)
    bytes += size
  }
  if (cur.length > 0) out.push(cur)
  return out
}
