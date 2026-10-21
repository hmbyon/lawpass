'use client'

import { useEffect, useState } from 'react'
import type { Problem } from '@/lib/caseStudy/types'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { renderHighlighted, type Highlight } from '@/lib/highlights'
import { HighlightEditor } from '@/components/highlight-editor'
import {
  fetchCaseHighlights, saveCaseHighlights, type CaseHighlightRecord,
} from '@/lib/firebaseServices/caseHighlights'

// 이 기기 사본. 선택형 키(lawpass_highlights_*)와 겹치지 않는 이름이라 선택형 동기화 목록에 섞이지 않는다
const localKey = (uid: string | null, mode: string, problemId: string) => `lawpass_casehl_${uid ?? 'guest'}_${mode}_${problemId}`

function readLocal(key: string): CaseHighlightRecord | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as CaseHighlightRecord) : null
  } catch {
    return null
  }
}

function writeLocal(key: string, record: CaseHighlightRecord) {
  try {
    localStorage.setItem(key, JSON.stringify(record))
  } catch {
    // 저장소가 막혀도 원격 저장은 한다
  }
}

/**
 * 사례형 문항의 문제 본문(문단마다 field 하나 + 물음)에 선택형과 같은 형광펜을 붙인다.
 * 표시는 이 기기에 먼저 쓰고 Firestore(caseHighlights)에 올린다. 열 때 원격 것이 더 새것이면 받아서 다시 그린다
 */
export function CaseQuestionText({ p }: { p: Problem }) {
  const mode = getAppMode()
  const uid = auth.currentUser?.uid ?? null
  const key = localKey(uid, mode, p.id)
  // 원격 표시를 받았을 때 편집기를 새로 띄워 다시 읽게 한다
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!uid) return
    let alive = true
    fetchCaseHighlights(uid, mode, p.id)
      .then((remote) => {
        if (!alive) return
        const local = readLocal(key)
        if (remote && (!local || remote.updatedAt > local.updatedAt)) {
          writeLocal(key, remote)
          setVersion((v) => v + 1)
        } else if (local && (!remote || local.updatedAt > remote.updatedAt)) {
          // 지난번에 올리지 못한 이 기기 표시
          saveCaseHighlights(uid, mode, p.id, local).catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [uid, mode, p.id, key])

  const load = () => readLocal(key)?.highlights ?? []
  const save = (highlights: Highlight[]) => {
    const record = { highlights, updatedAt: Date.now() }
    writeLocal(key, record)
    if (uid) saveCaseHighlights(uid, mode, p.id, record).catch(() => {})
  }

  const q = p.question
  if (!q) return null
  return (
    <HighlightEditor key={version} questionId={p.id} load={load} save={save} className="case-hl space-y-3">
      {({ highlights, remove, fieldRef }) => (
        <>
          {q.paragraphs.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">문제 원문</summary>
              <div className="mt-2 space-y-1.5 text-foreground/90 leading-relaxed">
                {q.paragraphs.map((s, i) => (
                  <p key={i} ref={fieldRef(`q_p${i}`)} className="select-text">
                    {renderHighlighted(s, `q_p${i}`, highlights, remove)}
                  </p>
                ))}
              </div>
            </details>
          )}
          {q.ask && (
            <p ref={fieldRef('q_ask')} className="select-text text-[13px] font-medium text-foreground border-l-2 border-primary pl-2.5">
              {renderHighlighted(q.ask, 'q_ask', highlights, remove)}
            </p>
          )}
        </>
      )}
    </HighlightEditor>
  )
}
