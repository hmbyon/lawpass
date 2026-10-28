'use client'

/**
 * 사례형 AI 점검용 Gemini API 키 — 이 기기 브라우저(localStorage)에만 사용자별로 둔다.
 * Firestore·서버·로그·동기화·내보내기에는 절대 넣지 않는다. 키는 여기 함수로만 읽고 쓴다(다른 곳에서 localStorage 를 직접 읽지 말 것).
 * PDF 탭의 기존 키(lawpass_api_key)와는 별개다.
 *
 * 계정 전환(clearAccountData)과 '전체 데이터 초기화'는 lawpass 접두어 키를 모두 지우므로 이 키도 함께 지워진다 —
 * 다음 사용자에게 남지 않게 하려는 것이라 그대로 둔다
 */

// 점검에 쓸 모델. 앱의 PDF 분석 서버 라우트(app/api/analyze)가 실제로 쓰고 있는 이름과 같다.
// 연결 테스트가 이 모델로 요청을 보내므로, 이름이 틀리면 테스트가 '모델을 찾을 수 없음'으로 알려 준다
export const GEMINI_MODEL = 'gemini-3.1-flash-lite'

const API = 'https://generativelanguage.googleapis.com/v1beta'
const storageKey = (uid: string) => `lawpass_gemini_key_${uid}`

export function getGeminiKey(uid: string): string | null {
  try {
    return localStorage.getItem(storageKey(uid)) || null
  } catch {
    return null
  }
}

/** 저장했으면 true. 저장소가 막힌 브라우저(사생활 보호 모드 등)면 false */
export function setGeminiKey(uid: string, key: string): boolean {
  try {
    localStorage.setItem(storageKey(uid), key)
    return true
  } catch {
    return false
  }
}

export function removeGeminiKey(uid: string): boolean {
  try {
    localStorage.removeItem(storageKey(uid))
    return true
  } catch {
    return false
  }
}

/** 화면 표시용 — 앞 4글자와 끝 4글자만 */
export function maskGeminiKey(key: string): string {
  return key.length <= 8 ? '•'.repeat(key.length) : `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}`
}

export type GeminiTestResult = { ok: true } | { ok: false; reason: string }

/**
 * 연결 테스트 — GEMINI_MODEL 에 아주 짧은 요청을 한 번 보낸다(출력 1토큰).
 * 키는 주소(쿼리)가 아니라 헤더(x-goog-api-key)로 보낸다. 응답 본문·키는 어디에도 남기지 않는다
 */
export async function testGeminiKey(key: string): Promise<GeminiTestResult> {
  let res: Response
  try {
    res = await fetch(`${API}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
    })
  } catch {
    return { ok: false, reason: '네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.' }
  }
  if (res.ok) return { ok: true }
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } }
    detail = [body.error?.status, body.error?.message, ...(body.error?.details ?? []).map((d) => d.reason)].join(' ')
  } catch {
    // 본문이 없어도 상태 코드로 가른다
  }
  if (res.status === 429) return { ok: false, reason: '사용 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 요금제·한도를 확인해 주세요.' }
  if (/API_KEY_INVALID|API key not valid/i.test(detail) || res.status === 401) {
    return { ok: false, reason: '키가 올바르지 않습니다. 복사한 키를 다시 확인해 주세요.' }
  }
  if (res.status === 403) {
    return { ok: false, reason: '이 키로는 Gemini API를 쓸 수 없습니다. 키의 사용 제한이나 API 사용 설정을 확인해 주세요.' }
  }
  if (res.status === 404) return { ok: false, reason: `점검에 쓰는 모델(${GEMINI_MODEL})을 찾을 수 없습니다. 앱 업데이트가 필요합니다.` }
  if (res.status >= 500) return { ok: false, reason: 'Gemini 서버에 문제가 있습니다. 잠시 뒤 다시 시도해 주세요.' }
  return { ok: false, reason: `요청이 거절되었습니다 (${res.status}).` }
}
