import type { AppMode } from './appMode'

/**
 * 문제집(출처) 표시 이름의 "내 계정에서만 보이는" 별칭.
 *
 * 실제 데이터(Question.sourceFile)는 건드리지 않는다 — 합치기(mergeSourceFiles)와 발행본
 * 연결(admin-pool-panel.tsx의 poolOf)이 모두 sourceFile 문자열 일치에 의존하므로, 그 값을
 * 바꾸면 다른 기능이 깨진다. 그래서 여기서는 "화면에 뭐라고 적을지"만 로컬(localStorage)에
 * 따로 적어 둔다. 계정(브라우저)마다 따로 저장되므로 내가 바꿔도 다른 사람 화면은 그대로다.
 *
 * 관리자 계정이 처음 붙인 이름(sourceFile 그대로, 또는 합치기 때 지은 이름)이 모두의
 * 기본값이고, 그 뒤 각자 여기서 바꾸는 것은 그 계정에만 반영된다.
 */
const STORAGE_PREFIX = 'lawpass_source_labels_'

function storageKey(mode: AppMode): string {
  return `${STORAGE_PREFIX}${mode}`
}

function readOverrides(mode: AppMode): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(mode))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeOverrides(mode: AppMode, overrides: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify(overrides))
  } catch {
    // 저장 실패(용량 초과 등)는 조용히 무시한다 — 표시 이름이 없어도 기능에는 지장 없다
  }
}

/** 이 계정에서 sourceFile에 붙인 별칭이 있으면 그걸, 없으면 fallback(원래 이름)을 돌려준다 */
export function getSourceLabel(mode: AppMode, sourceFile: string, fallback: string): string {
  if (!sourceFile) return fallback
  const overrides = readOverrides(mode)
  return overrides[sourceFile] ?? fallback
}

/** 별칭을 저장한다. 빈 문자열이거나 원래 이름(sourceFile)과 같으면 별칭을 지운다(기본값으로 복귀) */
export function setSourceLabel(mode: AppMode, sourceFile: string, label: string) {
  if (!sourceFile) return
  const trimmed = label.trim()
  const overrides = readOverrides(mode)
  if (!trimmed || trimmed === sourceFile) {
    delete overrides[sourceFile]
  } else {
    overrides[sourceFile] = trimmed
  }
  writeOverrides(mode, overrides)
}
