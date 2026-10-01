import { EXAMPASS_ENTRY_ENABLED } from './featureFlags'

export type AppMode = 'law' | 'general'

const KEY = 'exampass_mode'

export function getAppMode(): AppMode {
  if (typeof window === 'undefined') return 'law'
  // 모드 전환 진입점이 닫혀 있는 동안은 저장된 값이 뭐든 LawPass로 고정한다.
  // ExamPass가 일반 모드로 열려 있던 시절 'general'로 맞춰 둔 브라우저가 있으면,
  // 진입점(그 값을 되돌릴 유일한 UI)이 같이 닫혀 있어 그 브라우저는 영영
  // ExamPass로 뜬다 — 계정이 아니라 이 브라우저의 localStorage에 박혀 있어서다
  if (!EXAMPASS_ENTRY_ENABLED) return 'law'
  return localStorage.getItem(KEY) === 'general' ? 'general' : 'law'
}

export function setAppMode(mode: AppMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, mode)
}
