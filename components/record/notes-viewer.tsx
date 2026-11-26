'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAppMode } from '@/lib/appMode'
import { fetchNoteDoc, fetchNotesIndex } from '@/lib/firebaseServices/caseStudy'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import {
  clampSpan, notePartsOf, noteSubjects, partLabel, isUntitledItem, alignClass, cellBgClass,
  isBoxTable, tableSizeClass, examChipsOfItem, subsForExam, paragraphClass, paragraphPadding, paragraphFirstLineEm, splitTitleTag, isNumberedHeading, type NoteBlock, type NoteDoc, type NoteItem, type NotesIndex,
} from '@/lib/record/notes'

// 정리본 html 은 sanitizeNote 출력만 dangerouslySetInnerHTML 에 넣는다
function Blocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {(blocks ?? []).map((b, i) =>
        b?.t === 'table' ? (
          <div key={i} className="overflow-x-auto my-2">
            {/* 1열 표는 기재례 박스다 — 배경은 표(상자) 안쪽 셀에만 */}
            <table className={`border-collapse ${tableSizeClass(b)} ${isBoxTable(b) ? 'note-box' : ''}`}>
              <tbody>
                {(Array.isArray(b.rows) ? b.rows : []).map((row, r) => (
                  <tr key={r}>
                    {(Array.isArray(row) ? row : []).map((cell, c) => (
                      <td
                        key={c}
                        colSpan={clampSpan(cell?.cs)}
                        rowSpan={clampSpan(cell?.rs)}
                        className={`border border-border px-2 py-1 align-top ${cellBgClass(cell?.bg)}`}
                        dangerouslySetInnerHTML={{ __html: sanitizeNote(cell?.h ?? '') }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p
            key={i}
            className={`note-p text-sm leading-relaxed ${alignClass(b?.al)} ${paragraphClass(b)} ${isNumberedHeading(b) ? 'note-num' : ''}`}
            style={{
              paddingLeft: `${paragraphPadding(b)}rem`,
              ...(paragraphFirstLineEm(b) > 0 && { textIndent: `${paragraphFirstLineEm(b)}em` }),
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeNote(b?.h ?? '') }}
          />
        )
      )}
    </>
  )
}

function ItemBody({ body, subs = body.subs }: { body: NoteItem; subs?: NoteItem['subs'] }) {
  return (
    <>
      <Blocks blocks={body.blocks} />
      {(subs ?? []).map((s, i) => (
        <div key={i} className="pt-2 space-y-1">
          <p className="text-sm font-semibold">{s.title}</p>
          <Blocks blocks={s.blocks} />
        </div>
      ))}
    </>
  )
}

const chip = (on: boolean) =>
  `px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
    on ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
  }`

/**
 * 기록형 정리본 열람. 색인으로 과목·부·항목 목록과 기출 항목의 회차 칩을 그리고,
 * 부를 고르면 그 부의 문서를 한 번만 읽어 둔다(부 단위 캐시) — 항목을 펼치면 여기서 본문을 꺼내 보인다
 */
export function NotesViewer() {
  const [index, setIndex] = useState<NotesIndex | null | undefined>(undefined) // undefined = 불러오는 중
  const [indexError, setIndexError] = useState('')
  const [docs, setDocs] = useState<Record<string, NoteDoc | null | 'error' | 'loading'>>({})
  const [subject, setSubject] = useState<string | null>(null)
  const [partId, setPartId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // 기출 항목에서 고른 회차 칩 (항목 id → 회차 키 하나). 없으면 소항목 전체
  const [examPick, setExamPick] = useState<Record<string, string>>({})

  const loadIndex = useCallback(() => {
    setIndex(undefined)
    setIndexError('')
    fetchNotesIndex(getAppMode())
      .then(setIndex)
      .catch((e: Error) => setIndexError(e.message || '불러오지 못했습니다'))
  }, [])
  useEffect(loadIndex, [loadIndex])

  const subjects = useMemo(() => (index ? noteSubjects(index) : []), [index])
  const curSubject = subject && subjects.includes(subject) ? subject : subjects[0] ?? null
  const parts = useMemo(() => (index && curSubject ? notePartsOf(index, curSubject) : []), [index, curSubject])
  const part = parts.find((p) => p.id === partId) ?? parts[0] ?? null
  const items = part?.items ?? []

  const loadDoc = useCallback((id: string) => {
    setDocs((d) => ({ ...d, [id]: 'loading' }))
    fetchNoteDoc(getAppMode(), id)
      .then((doc) => setDocs((d) => ({ ...d, [id]: doc })))
      .catch(() => setDocs((d) => ({ ...d, [id]: 'error' })))
  }, [])
  const partDocState = part ? docs[part.id] : undefined
  useEffect(() => {
    if (part && partDocState === undefined) loadDoc(part.id)
  }, [part, partDocState, loadDoc])
  const partDoc = partDocState && typeof partDocState === 'object' ? partDocState : null

  function chooseSubject(s: string) {
    setSubject(s)
    setPartId(null)
    setOpenId(null)
  }

  if (indexError) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-2">
        <p>정리본 색인을 불러오지 못했습니다 ({indexError})</p>
        <button onClick={loadIndex} className="text-primary hover:underline">다시 시도</button>
      </div>
    )
  }
  if (index === undefined) return <p className="text-xs text-muted-foreground">정리본을 불러오는 중…</p>
  if (!index || !Array.isArray(index.docs) || index.docs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground">
        정리본이 아직 올라오지 않았어요. 가져오기 탭에서 올려주세요
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="과목">
        {subjects.map((s) => (
          <button key={s} type="button" onClick={() => chooseSubject(s)} aria-pressed={s === curSubject} className={chip(s === curSubject)}>
            {s}
          </button>
        ))}
      </div>

      {parts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="부">
          {parts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPartId(p.id)
                setOpenId(null)
              }}
              aria-pressed={p.id === part?.id}
              className={chip(p.id === part?.id)}
            >
              {partLabel(p.part)}
            </button>
          ))}
        </div>
      )}

      {partDocState === 'error' && part && (
        <p className="text-xs text-muted-foreground">
          {partLabel(part.part)} 문서를 불러오지 못했습니다 ·{' '}
          <button onClick={() => loadDoc(part.id)} className="text-primary hover:underline">다시 시도</button>
        </p>
      )}
      {partDocState === null && <p className="text-xs text-muted-foreground">이 부의 문서가 아직 올라오지 않았습니다</p>}

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">항목이 없습니다</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const body = partDoc?.items?.find((x) => x.id === it.id)
            const loading = partDocState === 'loading' || partDocState === undefined
            // 제목이 빈 항목은 머리줄 없이 본문을 펼쳐 둔다
            if (isUntitledItem(it)) {
              return (
                <div key={it.id} className="bg-card border border-border rounded-xl">
                  <div className="record-note p-3 space-y-1 text-foreground">
                    {loading ? (
                      <p className="text-xs text-muted-foreground">불러오는 중…</p>
                    ) : body ? (
                      <ItemBody body={body} />
                    ) : null}
                  </div>
                </div>
              )
            }
            const open = openId === it.id
            const toggle = () => setOpenId(open ? null : it.id)
            const picked = examPick[it.id]
            // 제목 끝 "(5회 변시)" 는 떼어 제목 옆 스티커로 (표시 전용)
            const { text: titleText, tag: titleTag } = splitTitleTag(it.title)
            // 기출 항목의 회차 칩: 누르면 펼치고 그 회차 소항목만, 다시 누르면 해제(전체)
            const pickExam = (k: string) => {
              setOpenId(it.id)
              setExamPick((m) => {
                const next = { ...m }
                if (next[it.id] === k) delete next[it.id]
                else next[it.id] = k
                return next
              })
            }
            return (
              <div key={it.id} className="bg-card border border-border rounded-xl">
                {/* 제목 토글·회차 칩·▸ 는 서로 다른 형제 버튼이다 (버튼 안에 버튼을 두지 않는다) */}
                <div className="p-3 flex flex-wrap items-center gap-1.5">
                  <button type="button" aria-expanded={open} onClick={toggle} className="text-left text-sm font-medium text-foreground mr-1">
                    <span className="note-title">{titleText}</span>
                  </button>
                  {titleTag && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium border bg-muted text-muted-foreground border-border">
                      {titleTag}
                    </span>
                  )}
                  {examChipsOfItem(it).map((k) => (
                    <button key={k} type="button" aria-pressed={picked === k} onClick={() => pickExam(k)} className={chip(picked === k)}>
                      {k}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? '접기' : '펼치기'}
                    onClick={toggle}
                    className="ml-auto text-sm text-muted-foreground"
                  >
                    {open ? '▾' : '▸'}
                  </button>
                </div>
                {open && (
                  <div className="record-note px-3 pb-3 space-y-1 text-foreground">
                    {loading ? (
                      <p className="text-xs text-muted-foreground">불러오는 중…</p>
                    ) : !body ? (
                      <p className="text-xs text-muted-foreground">본문을 찾지 못했습니다</p>
                    ) : (
                      <ItemBody body={body} subs={subsForExam(body, it, picked)} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
