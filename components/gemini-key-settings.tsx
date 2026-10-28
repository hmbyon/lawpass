'use client'

import { useState } from 'react'
import {
  GEMINI_MODEL, getGeminiKey, maskGeminiKey, removeGeminiKey, setGeminiKey, testGeminiKey,
} from '@/lib/geminiKey'
import { GEMINI_KEY_GUIDE } from '@/lib/geminiKeyGuide'

const BTN = 'text-xs border border-border rounded-lg px-3 py-1.5 transition-colors hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed'

/** 설정 > AI 점검 (Gemini API 키). 키는 이 기기 브라우저에만 저장한다(lib/geminiKey) */
export function GeminiKeySettings({ userId }: { userId: string }) {
  const [saved, setSaved] = useState<string | null>(() => getGeminiKey(userId))
  const [input, setInput] = useState('')
  const [show, setShow] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  function save() {
    const key = input.trim()
    if (!key) return
    if (!setGeminiKey(userId, key)) {
      setMessage({ ok: false, text: '이 브라우저에서는 저장할 수 없습니다' })
      return
    }
    setSaved(key)
    setInput('')
    setShow(false)
    setMessage({ ok: true, text: '저장했습니다' })
  }

  function remove() {
    if (!removeGeminiKey(userId)) {
      setMessage({ ok: false, text: '이 브라우저에서는 저장할 수 없습니다' })
      return
    }
    setSaved(null)
    setMessage({ ok: true, text: '삭제했습니다' })
  }

  // 입력 중인 키가 있으면 그것을, 없으면 저장된 키를 시험한다
  async function test() {
    const key = input.trim() || saved
    if (!key) return
    setTesting(true)
    setMessage(null)
    const r = await testGeminiKey(key)
    setTesting(false)
    setMessage(r.ok ? { ok: true, text: `연결되었습니다 (${GEMINI_MODEL})` } : { ok: false, text: r.reason })
  }

  return (
    <div className="bg-muted rounded-xl p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">AI 점검 (Gemini API 키)</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        답안 내용이 점검을 위해 Google Gemini로 전송됩니다. 키는 이 기기 브라우저에만 저장되고 서버에는 저장되지 않습니다.
      </p>

      {saved && (
        <p className="text-xs text-foreground">
          저장된 키 <span className="font-mono tabular-nums">{maskGeminiKey(saved)}</span>
        </p>
      )}

      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={saved ? '새 키로 바꾸기' : 'API 키 붙여넣기'}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:border-primary/50"
        />
        <button type="button" onClick={() => setShow((v) => !v)} className={BTN} aria-label={show ? '키 가리기' : '키 보기'}>
          {show ? '가리기' : '보기'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={!input.trim()} className={BTN}>
          저장
        </button>
        <button type="button" onClick={test} disabled={testing || !(input.trim() || saved)} className={BTN}>
          {testing ? '확인 중…' : '연결 테스트'}
        </button>
        {saved && (
          <button type="button" onClick={remove} className={`${BTN} text-red-400 border-red-400/30 hover:bg-red-400/10`}>
            삭제
          </button>
        )}
      </div>

      {message && <p className={`text-xs ${message.ok ? 'text-emerald-500' : 'text-red-400'}`}>{message.text}</p>}

      {GEMINI_KEY_GUIDE.trim() && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">API 키 발급 방법</summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-foreground/90">{GEMINI_KEY_GUIDE}</p>
        </details>
      )}
    </div>
  )
}
