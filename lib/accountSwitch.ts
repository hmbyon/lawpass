'use client'

import type { AppMode } from '@/lib/appMode'
import { clearPdfCache } from '@/lib/pdfCache'

/**
 * 한 브라우저에서 계정이 바뀔 때 이전 계정의 흔적을 치운다.
 *
 * 저장 키에 uid가 없어서(lawpass_questions_law 처럼 고정된 이름) 계정을 바꿔도 로컬
 * 데이터가 그대로 남는다. 남아 있기만 하면 화면이 이상한 정도지만, 미동기화 상태였다면
 * sync.ts의 resolveList가 "로컬이 최신"으로 보고 원격에 합쳐 올린다 — 앞 계정의 문제가
 * 새 계정의 Firestore 트리에 실제로 올라간다(재현 확인).
 *
 * 그래서 병합이 일어나기 전에, 로그인 직후 여기서 먼저 끊는다.
 * 저장 키 자체에 uid를 넣는 근본 해결은 별개의 일이다.
 */

const LAST_UID_KEY = 'lawpass_last_uid'
const MODES: AppMode[] = ['law', 'general']

// 계정과 무관한 화면 설정. 지우면 로그인할 때마다 테마가 초기화되고 튜토리얼이 다시 뜬다
const KEEP_KEYS = new Set([
  LAST_UID_KEY,
  'lawpass_theme',
  'lawpass_onboarding_dismissed',
  'lawpass_api_info_open',
])

export function getLastUid(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LAST_UID_KEY)
}

export function rememberUid(uid: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LAST_UID_KEY, uid)
  } catch (e) {
    console.error('[accountSwitch] 마지막 uid 기록 실패', e)
  }
}

/**
 * 이전과 다른 계정으로 들어왔는가.
 *
 * 기록이 아예 없으면(이 기능이 생기기 전부터 쓰던 사람, 첫 로그인) '바뀌지 않았다'로 본다.
 * 모른다는 이유로 지우면, 이 버전을 처음 켜는 모든 사용자의 로컬 데이터를 날리게 된다
 */
export function isAccountSwitch(uid: string): boolean {
  const last = getLastUid()
  return last !== null && last !== uid
}

/**
 * 아직 올리지 못한 변경이 남아 있는 모드. 지우기 전에 사람에게 물어야 하는 근거다.
 *
 * 플래그만 보지 않는다 — 플래그는 없을 때도 '대기 중'으로 읽히므로(store.ts의
 * hasPendingSync), 데이터가 하나도 없는 깨끗한 브라우저에서도 경고가 뜬다
 */
export function unsyncedModes(): AppMode[] {
  if (typeof window === 'undefined') return []
  return MODES.filter((mode) => {
    if (localStorage.getItem(`lawpass_pending_sync_${mode}`) === '0') return false
    return MODES_DATA_KEYS.some((base) => {
      const raw = localStorage.getItem(`${base}_${mode}`)
      return raw !== null && raw !== '[]' && raw !== 'null'
    })
  })
}

// 올릴 대상이 되는 데이터. 이것들이 비어 있으면 미동기화라 해도 잃을 것이 없다
const MODES_DATA_KEYS = [
  'lawpass_questions',
  'lawpass_wrong_notes',
  'lawpass_saved_session',
  'lawpass_saved_study_sessions',
]

/**
 * 이전 계정의 로컬 데이터를 전부 지운다.
 *
 * 키를 하나하나 적지 않고 접두어로 훑는다. 설정의 '전체 데이터 초기화'와 같은 방식이고,
 * 나중에 키가 하나 늘었을 때 여기에 적는 것을 잊어도 함께 지워진다 — 빠뜨리면 그게
 * 그대로 다음 사용자에게 새는 자리가 된다. 남길 것만 KEEP_KEYS에 적는다.
 *
 * IndexedDB의 PDF 원본까지 지운다. 앞 사용자가 올린 시험지가 그대로 남아 있으면 안 된다
 */
export function clearAccountData() {
  if (typeof window === 'undefined') return
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('lawpass') && !KEEP_KEYS.has(key)) localStorage.removeItem(key)
  }
  // 실패해도 로그인 흐름을 막지 않는다 (지우지 못했다는 사실은 콘솔에 남는다)
  void clearPdfCache()
}
