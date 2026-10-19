import type { AppMode } from './appMode'
import { normalizeCaseNumber } from './caseDigest'

/**
 * 기출판례 즐겨찾기. 판례 하나는 정규화한 사건번호(CaseGroup.key)로 가리킨다.
 *
 * 실제 데이터는 건드리지 않고 "내가 보고 싶은 판례가 무엇인지"만 이 브라우저(localStorage)에 적는다.
 * 문제집 표시 이름 별칭(sourceLabels)과 같은 방식이라 기기·계정마다 따로 저장된다
 */
const STORAGE_PREFIX = 'lawpass_fav_cases_'

function storageKey(mode: AppMode): string {
  return `${STORAGE_PREFIX}${mode}`
}

export function readFavoriteCases(mode: AppMode): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(storageKey(mode))
    const parsed = raw ? JSON.parse(raw) : []
    const stored = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    // 정규화 규칙이 바뀌면(2자리 연도 판례 "95다8713" → "1995다8713") 옛 key 로는 판례를 못 찾아
    // 즐겨찾기가 사라져 보인다. 읽을 때 새 규칙으로 옮기고 겹친 것은 하나로 합친다.
    // 이미 새 key 면 정규화해도 그대로라 다시 읽어도 결과가 같다(멱등)
    const keys = new Set(stored.map(normalizeCaseNumber))
    if (keys.size !== stored.length || stored.some((k) => !keys.has(k))) writeFavoriteCases(mode, keys)
    return keys
  } catch {
    return new Set()
  }
}

export function writeFavoriteCases(mode: AppMode, keys: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify(Array.from(keys)))
  } catch {
    // 저장 실패(용량 초과 등)는 조용히 무시한다 — 즐겨찾기가 없어도 기능에는 지장 없다
  }
}
