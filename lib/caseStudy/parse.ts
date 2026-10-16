import type { Card, CaseIndex } from '@/lib/caseStudy/types'

export type ParsedFile =
  | { kind: 'index'; name: string; index: CaseIndex }
  | { kind: 'card'; name: string; card: Card }

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
    return { kind: 'index', name, index: obj as unknown as CaseIndex }
  }
  if (typeof obj.id !== 'string' || !obj.id) throw new Error('id 가 없습니다')
  // Firestore 문서 id 로 쓰므로 '/' 가 들어가면 경로가 갈라진다
  if (obj.id.includes('/')) throw new Error(`id 에 '/' 가 들어 있습니다 (${obj.id})`)
  if (!Array.isArray(obj.problems)) throw new Error('problems 배열이 없습니다')
  return { kind: 'card', name, card: obj as unknown as Card }
}
