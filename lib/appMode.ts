export type AppMode = 'law' | 'general'

const KEY = 'exampass_mode'

export function getAppMode(): AppMode {
  if (typeof window === 'undefined') return 'law'
  return localStorage.getItem(KEY) === 'general' ? 'general' : 'law'
}

export function setAppMode(mode: AppMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, mode)
}
