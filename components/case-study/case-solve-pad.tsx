'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DrawingStroke } from '@/lib/types'
import { auth } from '@/lib/firebase'
import { getAppMode } from '@/lib/appMode'
import { DrawingPad } from '@/components/drawing-pad'
import { DrawingPreview } from '@/components/drawing-preview'
import {
  fetchCaseAttemptDrawing, saveCaseAttemptDrawing, type CaseAttemptDrawing,
} from '@/lib/firebaseServices/caseAttempts'

// 이 기기 사본. 선택형 그림(문제 저장소·lawpass_foreign_drawings)과 겹치지 않는 이름이다
const localKey = (uid: string | null, mode: string, attemptId: string, problemId: string) =>
  `lawpass_case_drawing_${uid ?? 'guest'}_${mode}_${attemptId}_${problemId}`

function readLocal(key: string): CaseAttemptDrawing | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as CaseAttemptDrawing) : null
  } catch {
    return null
  }
}

function writeLocal(key: string, d: CaseAttemptDrawing): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(d))
    return true
  } catch {
    return false
  }
}

/**
 * 시도·문항 하나의 그림. 이 기기 것과 원격 것 중 나중에 저장된 쪽을 쓰고, 이 기기에만 있는 새 그림은 올린다.
 * version 은 원격 그림을 받아 와 다시 띄워야 할 때 바뀐다
 */
function useAttemptDrawing(attemptId: string, problemId: string) {
  const mode = getAppMode()
  const uid = auth.currentUser?.uid ?? null
  const key = localKey(uid, mode, attemptId, problemId)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!uid) return
    let alive = true
    fetchCaseAttemptDrawing(uid, mode, attemptId, problemId)
      .then((remote) => {
        if (!alive) return
        const local = readLocal(key)
        if (remote && (!local || remote.savedAt > local.savedAt)) {
          writeLocal(key, remote)
          setVersion((v) => v + 1)
        } else if (local && (!remote || local.savedAt > remote.savedAt)) {
          saveCaseAttemptDrawing(uid, mode, attemptId, problemId, local).catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [uid, mode, attemptId, problemId, key])

  const load = () => readLocal(key)?.strokes ?? []
  const save = (strokes: DrawingStroke[]) => {
    const d = { strokes, savedAt: Date.now() }
    const ok = writeLocal(key, d)
    if (uid) saveCaseAttemptDrawing(uid, mode, attemptId, problemId, d).catch(() => {})
    return ok || !!uid
  }
  return { version, load, save }
}

const noop = () => {}

/** 풀이 화면의 저장되는 그림판(선택형 DrawingPad). 사례형은 답안 칸을 가리지 않게 늘 띄운 창으로 연다 */
export function CaseSolvePad({
  attemptId, problemId, no, open, onClose,
}: { attemptId: string; problemId: string; no: number; open: boolean; onClose: () => void }) {
  const { version, load, save } = useAttemptDrawing(attemptId, problemId)
  return (
    <DrawingPad
      key={version}
      questionId={problemId}
      questionNo={no}
      open={open}
      onClose={onClose}
      onSaved={noop}
      dockW={null}
      onDockWChange={noop}
      onReserveChange={noop}
      load={load}
      save={save}
      dockable={false}
    />
  )
}

/** 제출 후 비교 화면 — 그 시도에 그린 그림을 보기만 한다. 그린 것이 없으면 아무것도 그리지 않는다 */
export function CaseSolvePadPreview({ attemptId, problemId }: { attemptId: string; problemId: string }) {
  const { version, load } = useAttemptDrawing(attemptId, problemId)
  // 원격 그림을 받아 오면(version) 다시 읽는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const strokes = useMemo(load, [version, attemptId, problemId])
  if (!strokes.some((s) => !s.erase && s.points.length >= 2)) return null
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-xs font-semibold text-foreground">내 그림</h3>
      <DrawingPreview questionId={problemId} strokes={strokes} />
    </section>
  )
}
