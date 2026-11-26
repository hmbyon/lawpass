'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAppMode } from '@/lib/appMode'
import { fetchNoteDoc, fetchNotesIndex } from '@/lib/firebaseServices/caseStudy'
import { FilterChips } from '@/components/filter-chips'
import { sanitizeNote } from '@/lib/record/sanitizeNote'
import {
  clampIndent, clampSpan, examChipsFor, filterNoteItems, itemExams, notePartsOf, noteSubjects,
  partLabel, sortedExamKeys, isUntitledItem, alignClass, cellBgClass, type NoteBlock, type NoteDoc, type NoteItem, type NotesIndex,
} from '@/lib/record/notes'

// 정리본 html 은 sanitizeNote 출력만 dangerouslySetInnerHTML 에 넣는다
function Blocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {(blocks ?? []).map((b, i) =>
        b?.t === 'table' ? (
          <div key={i} className="overflow-x-auto my-2">
            <table className="border-collapse text-xs">
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
            className={`text-sm leading-relaxed ${alignClass(b?.al)}`}
            style={{ paddingLeft: `${clampIndent(b?.ind) * 1.25}rem` }}
            dangerouslySetInnerHTML={{ __html: sanitizeNote(b?.h ?? '') }}
          />
        )
      )}
    </>
  )
}

function ItemBody({ body }: { body: NoteItem }) {
  return (
    <>
      <Blocks blocks={body.blocks} />
      {(body.subs ?? []).map((s, i) => (
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
 * 기록형 정리본 열람. 색인으로 과목·부·항목 목록과 회차 칩을 그리고,
 * 부를 고르면 그 부의 문서를 한 번만 읽어 둔다(부 단위 캐시) — 항목을 펼치면 여기서 본문을 꺼내 보인다
 */
export function NotesViewer() {
  const [index, setIndex] = useState<NotesIndex | null | undefined>(undefined) // undefined = 불러오는 중
  const [indexError, setIndexError] = useState('')
  const [docs, setDocs] = useState<Record<string, NoteDoc | null | 'error' | 'loading'>>({})
  const [subject, setSubject] = useState<string | null>(null)
  const [partId, setPartId] = useState<string | null>(null)
  const [exams, setExams] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

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
  const examChips = useMemo(() => (index && curSubject ? examChipsFor(index, curSubject) : []), [index, curSubject])
  const items = useMemo(() => (part ? filterNoteItems(part.items ?? [], exams) : []), [part, exams])

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
    setExams([])
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

      {/* 회차 태그가 하나도 없는 과목은 칩 줄을 숨긴다 */}
      {examChips.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">회차 (복수 선택)</label>
          <FilterChips options={examChips} selected={exams} onChange={setExams} />
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
        <p className="text-xs text-muted-foreground">{exams.length > 0 ? '고른 회차에 해당하는 항목이 없습니다' : '항목이 없습니다'}</p>
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
            return (
              <div key={it.id} className="bg-card border border-border rounded-xl">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : it.id)}
                  className="w-full text-left p-3 flex flex-wrap items-center gap-1.5"
                >
                  <span className="text-sm font-medium text-foreground mr-1">{it.title}</span>
                  {sortedExamKeys(itemExams(it)).map((k) => (
                    <span key={k} className="px-1.5 py-0.5 rounded text-[10px] border border-border bg-muted text-muted-foreground">
                      {k}
                    </span>
                  ))}
                  <span className="ml-auto text-sm text-muted-foreground">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="record-note px-3 pb-3 space-y-1 text-foreground">
                    {loading ? (
                      <p className="text-xs text-muted-foreground">불러오는 중…</p>
                    ) : !body ? (
                      <p className="text-xs text-muted-foreground">본문을 찾지 못했습니다</p>
                    ) : (
                      <ItemBody body={body} />
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
