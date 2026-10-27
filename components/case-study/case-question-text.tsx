'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Problem } from '@/lib/caseStudy/types'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { renderHighlighted, type Highlight } from '@/lib/highlights'
import { sanitizeCaseHtml } from '@/lib/caseStudy/sanitize'
import { answerField, hiddenKey, parseBlockHtml } from '@/lib/caseStudy/answerFormats'
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

// 모범답안 블록의 들여쓰기 — case-card-view 의 AnswerBlock 과 같다
const INDENT: Record<string, string> = { l2: 'pl-3', l3: 'pl-6' }

/**
 * 사례형 문항의 문제 본문과 모범답안에 선택형과 같은 형광펜을 붙인다(편집기 하나, 문서 하나).
 *  - 문제: 원문 문단마다 field 하나(q_p{i}) + 물음(q_ask)
 *  - 모범답안: 블록마다 field 하나(a{i}@{글자 해시}). 기존 서식(조문·판례 칠, 밑줄, 굵게)은 사용자 형광펜과
 *    섞지 않고 renderHighlighted 의 기본 서식 층으로 원래 태그·클래스 그대로 그린다
 *  - 기존 서식을 누르면 숨긴다 — 카드 데이터는 그대로 두고 숨긴 키 목록(hidden)만 저장한다
 * 표시는 이 기기에 먼저 쓰고 Firestore(caseHighlights)에 올린다. 열 때 원격이 더 새것이면 받아서 다시 그린다
 */
export function CaseQuestionText({ p }: { p: Problem }) {
  const mode = getAppMode()
  const uid = auth.currentUser?.uid ?? null
  const key = localKey(uid, mode, p.id)
  // 원격 표시를 받았을 때 편집기를 새로 띄워 다시 읽게 한다
  const [version, setVersion] = useState(0)
  const [hidden, setHidden] = useState<string[]>(() => readLocal(key)?.hidden ?? [])
  const [toast, setToast] = useState<{ prev: string[] } | null>(null)

  useEffect(() => {
    if (!uid) return
    let alive = true
    fetchCaseHighlights(uid, mode, p.id)
      .then((remote) => {
        if (!alive) return
        const local = readLocal(key)
        if (remote && (!local || remote.updatedAt > local.updatedAt)) {
          writeLocal(key, remote)
          setHidden(remote.hidden ?? [])
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

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(t)
  }, [toast])

  // 형광펜과 숨김은 한 문서다. 이 기기 사본을 기준으로 바뀐 쪽만 덮어 쓴다
  function persist(patch: Partial<CaseHighlightRecord>) {
    const record: CaseHighlightRecord = { highlights: [], ...readLocal(key), ...patch, updatedAt: Date.now() }
    writeLocal(key, record)
    if (uid) saveCaseHighlights(uid, mode, p.id, record).catch(() => {})
  }
  const load = () => readLocal(key)?.highlights ?? []
  const save = (highlights: Highlight[]) => persist({ highlights })

  function updateHidden(next: string[]) {
    setHidden(next)
    persist({ hidden: next })
  }

  // 블록마다 (field, 글자, 기본 서식). 화면에서 읽을 때만 바꾼다
  const blocks = useMemo(
    () =>
      (p.answer?.blocks ?? []).map((b, i) => {
        const parsed = parseBlockHtml(sanitizeCaseHtml(b.html))
        return { b, field: answerField(i, parsed.text), ...parsed }
      }),
    [p.answer]
  )
  const hiddenSet = new Set(hidden)
  // 지금 블록 글자에 맞는 숨김만 센다(글자가 바뀐 블록의 옛 기록은 세지도, 지우지도 않는다)
  const currentHidden = hidden.filter((h) => blocks.some((x) => h.startsWith(`${x.field}:`)))

  const q = p.question
  if (!q && !p.answer) return null
  return (
    <>
      <HighlightEditor key={version} questionId={p.id} load={load} save={save} className="case-hl space-y-3">
        {({ highlights, remove, fieldRef }) => (
          <>
            {q && q.paragraphs.length > 0 && (
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
            {q?.ask && (
              <p ref={fieldRef('q_ask')} className="select-text text-[13px] font-medium text-foreground border-l-2 border-primary pl-2.5">
                {renderHighlighted(q.ask, 'q_ask', highlights, remove)}
              </p>
            )}
            {p.answer && (
              // case-ans: 모범답안에서만 거는 형광펜 보정(globals.css) — 동그라미가 기존 칠을 끊지 않게
              <div className="case-ans pt-2 border-t border-border">
                {blocks.map(({ b, field, text, formats }, i) => {
                  const indent = b.lv ? INDENT[b.lv] : ''
                  const pts = b.pts && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{b.pts}</span>
                  const body = (
                    <span ref={fieldRef(field)} className={`select-text ${text.includes('\n') ? 'whitespace-pre-line' : ''}`}>
                      {renderHighlighted(
                        text,
                        field,
                        highlights,
                        remove,
                        [],
                        formats.filter((f) => !hiddenSet.has(hiddenKey(field, f.id))),
                        (id) => {
                          setToast({ prev: hidden })
                          updateHidden([...hidden, hiddenKey(field, id)])
                        }
                      )}
                    </span>
                  )
                  if (b.t === 'h1') {
                    return (
                      <h4 key={i} className={`mt-4 first:mt-0 text-sm font-bold text-foreground ${indent}`}>
                        {body}
                        {pts}
                      </h4>
                    )
                  }
                  if (b.t === 'h2') {
                    return (
                      <h5 key={i} className={`mt-2.5 text-[13px] font-semibold text-foreground ${indent}`}>
                        {body}
                        {pts}
                      </h5>
                    )
                  }
                  return (
                    <p key={i} className={`mt-1 text-[13px] leading-relaxed text-foreground/90 ${indent}`}>
                      {body}
                    </p>
                  )
                })}
                {(p.answer.source || currentHidden.length > 0) && (
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                    {p.answer.source && <span>{p.answer.source}</span>}
                    {currentHidden.length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateHidden(hidden.filter((h) => !currentHidden.includes(h)))}
                        className="text-primary hover:underline"
                      >
                        숨긴 표시 {currentHidden.length}개 되살리기
                      </button>
                    )}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </HighlightEditor>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-xs shadow-lg backdrop-blur">
          <span className="text-foreground">기존 표시 숨김</span>
          <button
            type="button"
            onClick={() => {
              updateHidden(toast.prev)
              setToast(null)
            }}
            className="font-medium text-primary hover:underline"
          >
            되돌리기
          </button>
        </div>
      )}
    </>
  )
}
