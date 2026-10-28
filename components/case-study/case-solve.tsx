'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Problem } from '@/lib/caseStudy/types'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { boxesOf, filledCount, formatElapsed, setKeyOf, type AnswerBox, type CaseAttempt } from '@/lib/caseStudy/solve'
import { fetchCaseDraft, saveCaseAttempt } from '@/lib/firebaseServices/caseAttempts'
import { AnswerBlock } from '@/components/case-study/case-card-view'
import { DrawLayer, useDrawBoard } from '@/components/quiz/draw-layer'
import { CaseSolvePad, CaseSolvePadPreview } from '@/components/case-study/case-solve-pad'

interface Props {
  problems: Problem[] // 푸는 순서대로. stub 은 넣지 않는다(호출부가 원본 문항으로 바꿔 넣는다)
  title: string
  notice?: string // 묶음에서 일부 문항을 찾지 못했을 때 등 — 헤더 밑에 한 줄
  onClose: () => void
}

const AUTOSAVE_MS = 5000

// 이 기기의 임시저장. 키에 uid 를 넣어 계정을 바꿔도 남의 답안을 이어 쓰지 않게 한다
const localKey = (uid: string | null, mode: string, setKey: string) => `lawpass_case_draft_${uid ?? 'guest'}_${mode}_${setKey}`

function readLocal(key: string): CaseAttempt | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as CaseAttempt) : null
  } catch {
    return null
  }
}

function writeLocal(key: string, a: CaseAttempt | null) {
  try {
    if (a) localStorage.setItem(key, JSON.stringify(a))
    else localStorage.removeItem(key)
  } catch {
    // 저장소가 막혀 있어도 원격 저장은 계속한다
  }
}

// 나누는 규칙이 바뀌어 칸 수가 달라졌으면 옛 답안을 첫 칸에 모아 둔다 — 쓴 글을 버리지 않는다
function fitAnswers(problems: Problem[], boxes: AnswerBox[][], prev?: CaseAttempt['answers']): CaseAttempt['answers'] {
  return problems.map((p, i) => {
    const old = prev?.find((a) => a.problemId === p.id)?.boxes ?? []
    const n = boxes[i].length
    if (old.length === n) return { problemId: p.id, boxes: old }
    const next = Array<string>(n).fill('')
    next[0] = old.filter((t) => t.trim()).join('\n\n')
    return { problemId: p.id, boxes: next }
  })
}

const problemTitle = (p: Problem) => [p.qno, p.sub].filter(Boolean).join(' ')

const btn = 'text-xs border border-border rounded-lg px-2.5 py-1 transition-colors hover:border-foreground/30 disabled:opacity-40'

// 왼쪽 영역의 '문제 텍스트'. 나중에 원본 PDF 와 바꿔 보는 탭이 붙을 자리라 따로 둔다
function QuestionPane({ p }: { p: Problem }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {p.examLabel} · {problemTitle(p)} · {p.points}점
      </p>
      {p.question ? (
        <>
          <div className="space-y-2 text-[13px] leading-relaxed text-foreground/90">
            {p.question.paragraphs.map((s, i) => <p key={i}>{s}</p>)}
          </div>
          {p.question.ask && (
            <p className="text-[13px] font-medium text-foreground border-l-2 border-primary pl-2.5">{p.question.ask}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">문제 원문이 없습니다</p>
      )}
    </div>
  )
}

function MyAnswer({ boxes, texts }: { boxes: AnswerBox[]; texts: string[] }) {
  return (
    <div className="space-y-4">
      {boxes.map((b, i) => (
        <section key={i}>
          <h3 className="mb-1 text-xs font-semibold text-foreground">
            {b.label || (boxes.length > 1 ? `소문항 ${i + 1}` : '내 답안')}
            {b.points !== null && <span className="ml-1.5 font-normal text-muted-foreground">{b.points}점</span>}
          </h3>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
            {texts[i]?.trim() ? texts[i] : <span className="text-muted-foreground">(작성하지 않음)</span>}
          </p>
        </section>
      ))}
    </div>
  )
}

export function CaseSolve({ problems, title, notice, onClose }: Props) {
  const mode = getAppMode()
  const uid = auth.currentUser?.uid ?? null
  const setKey = setKeyOf(problems.map((p) => p.id))
  const key = localKey(uid, mode, setKey)
  const boxes = useMemo(() => problems.map(boxesOf), [problems])

  // null = 임시저장을 찾는 중
  const [attempt, setAttempt] = useState<CaseAttempt | null>(null)
  const [resumed, setResumed] = useState(false)
  const [tab, setTab] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [confirming, setConfirming] = useState(false)
  // 그림 — 문제 위 임시 펜(저장 안 함, 선택형 DrawLayer)과 저장되는 그림판(시도·문항마다, 선택형 DrawingPad)
  const board = useDrawBoard()
  const [padOpen, setPadOpen] = useState(false)
  const latest = useRef<CaseAttempt | null>(null)
  latest.current = attempt
  const dirty = useRef(false)
  // 한 번이라도 썼는가 — 나갈 때 남길지 정한다(자동 저장 뒤에는 dirty 가 다시 false 다)
  const touched = useRef(false)

  // 이어쓰기: 이 기기 것과 원격 것 중 나중에 저장된 임시저장을 쓴다. 없으면 새 시도
  useEffect(() => {
    let alive = true
    const local = readLocal(key)
    const remote = uid ? fetchCaseDraft(uid, mode, setKey).catch(() => null) : Promise.resolve(null)
    remote.then((r) => {
      if (!alive) return
      const best = [local, r].filter((a): a is CaseAttempt => a?.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const now = Date.now()
      setResumed(!!best)
      setAttempt(
        best
          ? { ...best, answers: fitAnswers(problems, boxes, best.answers) }
          : {
              id: crypto.randomUUID(),
              setKey,
              problemIds: problems.map((p) => p.id),
              answers: fitAnswers(problems, boxes),
              status: 'draft',
              elapsedSeconds: 0,
              targetMinutes: null,
              startedAt: now,
              updatedAt: now,
              submittedAt: null,
            }
      )
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const submitted = attempt?.status === 'submitted'

  // 스톱워치. 제출하면 멈춘다
  useEffect(() => {
    if (!attempt || submitted) return
    const t = setInterval(() => setAttempt((a) => a && { ...a, elapsedSeconds: a.elapsedSeconds + 1 }), 1000)
    return () => clearInterval(t)
  }, [attempt === null, submitted]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(a: CaseAttempt) {
    const next = { ...a, updatedAt: Date.now() }
    if (next.status === 'draft') writeLocal(key, next)
    else writeLocal(key, null)
    if (!uid) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    try {
      await saveCaseAttempt(uid, mode, next)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  // 임시저장: 글이 바뀌었을 때만 몇 초마다
  useEffect(() => {
    if (!attempt || submitted) return
    const t = setInterval(() => {
      if (!dirty.current || !latest.current) return
      dirty.current = false
      save(latest.current)
    }, AUTOSAVE_MS)
    // 탭을 닫거나 새로고침할 때 — 원격 쓰기는 끝나지 못할 수 있어 이 기기에라도 남긴다
    const onHide = () => {
      if (dirty.current && latest.current) writeLocal(key, { ...latest.current, updatedAt: Date.now() })
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(t)
      window.removeEventListener('pagehide', onHide)
    }
  }, [attempt === null, submitted]) // eslint-disable-line react-hooks/exhaustive-deps

  // 뒤 화면이 같이 스크롤되지 않게
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  function edit(problemIdx: number, boxIdx: number, text: string) {
    dirty.current = true
    touched.current = true
    setAttempt((a) => {
      if (!a) return a
      const answers = a.answers.map((ans, i) =>
        i === problemIdx ? { ...ans, boxes: ans.boxes.map((t, j) => (j === boxIdx ? text : t)) } : ans
      )
      return { ...a, answers }
    })
  }

  // 그림만 그려도 쓴 것으로 친다 — 몇 초 뒤 임시저장에 실리고, 나갈 때도 시도를 남긴다
  function drew() {
    dirty.current = true
    touched.current = true
  }

  function close() {
    const a = latest.current
    // 쓴 것(글자 또는 그림)이 있을 때만 남긴다 — 열어 보기만 한 시도로 기록이 쌓이지 않게
    if (a && a.status === 'draft' && (touched.current || resumed)) save(a)
    onClose()
  }

  function submit() {
    const a = latest.current
    if (!a) return
    const now = Date.now()
    const done: CaseAttempt = { ...a, status: 'submitted', submittedAt: now }
    dirty.current = false
    setConfirming(false)
    setAttempt(done)
    setTab(0)
    save(done)
  }

  if (!attempt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <p className="text-xs text-muted-foreground animate-pulse">불러오는 중…</p>
      </div>
    )
  }

  const p = problems[tab]
  const texts = attempt.answers[tab]?.boxes ?? []
  const target = attempt.targetMinutes
  const over = target !== null && attempt.elapsedSeconds > target * 60
  const saveLabel =
    saveState === 'saving' ? '저장 중…' : saveState === 'error' ? '저장 실패' : saveState === 'saved' ? (submitted ? '제출 저장됨' : '임시저장됨') : ''

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <button onClick={close} className={`${btn} text-muted-foreground`}>← 나가기</button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</h1>
        <span className={`tabular-nums text-sm font-semibold ${over ? 'text-red-400' : 'text-foreground'}`} title="경과 시간">
          ⏱ {formatElapsed(attempt.elapsedSeconds)}
        </span>
        {!submitted && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            목표
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={target ?? ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                dirty.current = true
                setAttempt((a) => a && { ...a, targetMinutes: n > 0 ? n : null })
              }}
              className="w-14 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
            />
            분
          </label>
        )}
        {!submitted && (
          <button onClick={() => setPadOpen(true)} className={btn} title="이 문항에 딸린 그림판 — 저장됩니다">
            🎨 그림판
          </button>
        )}
        {saveLabel && (
          <span className={`text-[11px] ${saveState === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>{saveLabel}</span>
        )}
        {saveState === 'error' && (
          <button onClick={() => save(attempt)} className={btn}>다시 저장</button>
        )}
        {submitted ? (
          <span className="text-xs font-semibold text-primary">제출 완료</span>
        ) : confirming ? (
          <>
            <button onClick={() => setConfirming(false)} className={btn}>취소</button>
            <button onClick={submit} className="text-xs font-semibold rounded-lg px-3 py-1 bg-primary text-primary-foreground">정말 제출</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-xs font-semibold rounded-lg px-3 py-1 bg-primary text-primary-foreground">제출</button>
        )}
      </header>
      {(notice || (resumed && !submitted) || !uid) && (
        <p className="border-b border-border bg-muted px-4 py-1.5 text-[11px] text-muted-foreground">
          {[
            notice,
            resumed && !submitted && `임시저장한 답안을 이어 씁니다 (${new Date(attempt.updatedAt).toLocaleString('ko-KR')})`,
            !uid && '로그인하지 않아 이 기기에만 저장됩니다',
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {problems.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-1.5">
          {problems.map((q, i) => {
            const bs = attempt.answers[i]?.boxes ?? []
            return (
              <button
                key={q.id}
                onClick={() => setTab(i)}
                className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                  i === tab ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {problemTitle(q)} <span className="tabular-nums opacity-75">({filledCount(bs)}/{bs.length})</span>
              </button>
            )
          })}
        </nav>
      )}

      <div className="grid min-h-0 flex-1 max-md:overflow-y-auto md:grid-cols-2">
        {/* 왼쪽: 제출 전에는 문제, 제출 후에는 내 답안 */}
        <section className="p-4 md:overflow-y-auto md:border-r md:border-border max-md:border-b max-md:border-border">
          {submitted ? (
            <>
              <h2 className="mb-3 text-sm font-bold text-foreground">내 답안 · {problemTitle(p)}</h2>
              <MyAnswer boxes={boxes[tab]} texts={texts} />
              {/* 이 시도에 그린 그림판 — 보기만 한다 */}
              <CaseSolvePadPreview key={p.id} attemptId={attempt.id} problemId={p.id} />
            </>
          ) : (
            // 선택형 CBT 처럼 문제 위에 임시로 긋는다(저장하지 않음)
            <DrawLayer board={board} questionId={p.id} keepHint="남길 그림은 🎨 그림판에 그리세요">
              <QuestionPane p={p} />
            </DrawLayer>
          )}
        </section>
        {/* 오른쪽: 제출 전에는 답안 칸, 제출 후에는 모범답안 (제출 전에는 그리지 않는다) */}
        <section className="p-4 md:overflow-y-auto">
          {submitted ? (
            <>
              <h2 className="mb-3 text-sm font-bold text-foreground">모범답안 · {problemTitle(p)}</h2>
              {p.answer ? (
                <div>
                  {p.answer.blocks.map((b, i) => <AnswerBlock key={i} b={b} />)}
                  {p.answer.source && <p className="mt-3 text-[10px] text-muted-foreground">{p.answer.source}</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">모범답안이 없습니다</p>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {boxes[tab].map((b, i) => (
                <div key={`${p.id}-${i}`}>
                  <div className="mb-1 flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      {b.label || (boxes[tab].length > 1 ? `소문항 ${i + 1}` : '답안')}
                    </span>
                    {b.points !== null && <span className="text-[11px] text-muted-foreground">{b.points}점</span>}
                    <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">{(texts[i] ?? '').length}자</span>
                  </div>
                  {boxes[tab].length > 1 && <p className="mb-1 text-[11px] leading-snug text-muted-foreground">{b.text}</p>}
                  <textarea
                    value={texts[i] ?? ''}
                    onChange={(e) => edit(tab, i, e.target.value)}
                    rows={boxes[tab].length > 1 ? 8 : 18}
                    className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground focus:outline-none focus:border-primary/50"
                    placeholder="답안을 작성하세요"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 문항마다 그림판 하나 — 탭을 옮겨도 그리던 것이 남게 모두 걸어 두고 지금 문항 것만 연다.
          덮개 안에 두어야 덮개(z-50) 위로 뜬다 */}
      {problems.map((q, i) => (
        <CaseSolvePad
          key={q.id}
          attemptId={attempt.id}
          problemId={q.id}
          no={i + 1}
          open={!submitted && padOpen && i === tab}
          onClose={() => setPadOpen(false)}
          onDrawn={drew}
        />
      ))}
    </div>
  )
}
