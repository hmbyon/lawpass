'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  // 그리는 대로 이 기기에만 적는다. 원격에는 창을 닫거나 문항·화면을 떠날 때 upload 로 한 번 올린다
  const keep = (strokes: DrawingStroke[]) => writeLocal(key, { strokes, savedAt: Date.now() })
  const upload = () => {
    const d = readLocal(key)
    if (uid && d) saveCaseAttemptDrawing(uid, mode, attemptId, problemId, d).catch(() => {})
  }
  return { version, load, save, keep, upload }
}

const noop = () => {}
const hasInk = (strokes: DrawingStroke[]) => strokes.some((s) => !s.erase && s.points.length >= 2)

/**
 * 풀이 화면의 저장되는 그림판(선택형 DrawingPad). 사례형은 답안 칸을 가리지 않게 늘 띄운 창으로 연다.
 * "완료"를 누르지 않아도 남는다: 획이 바뀔 때마다 이 기기에 적고, 창이 닫힐 때(닫기·문항 이동·제출)와
 * 풀이 화면을 나가거나 탭을 닫을 때 원격에 올린다. onDrawn 은 그린 것이 생기면 알린다(시도를 남기게)
 */
export function CaseSolvePad({
  attemptId, problemId, no, open, onClose, onDrawn,
}: { attemptId: string; problemId: string; no: number; open: boolean; onClose: () => void; onDrawn?: () => void }) {
  const { version, load, save, keep, upload } = useAttemptDrawing(attemptId, problemId)
  // 원격에 아직 안 올린 그림이 있는가
  const unsent = useRef(false)
  const uploadRef = useRef(upload)
  uploadRef.current = upload
  const flush = () => {
    if (!unsent.current) return
    unsent.current = false
    uploadRef.current()
  }
  const change = (strokes: DrawingStroke[]) => {
    // 불러온 그림 그대로이거나 이미 적은 그림이면 아무것도 하지 않는다
    if (JSON.stringify(strokes) === JSON.stringify(load())) return
    keep(strokes)
    unsent.current = true
    if (hasInk(strokes)) onDrawn?.()
  }
  useEffect(() => {
    if (!open) flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
      save={(strokes) => {
        unsent.current = false
        return save(strokes)
      }}
      dockable={false}
      onChange={change}
    />
  )
}

/** 제출 후 비교 화면 — 그 시도에 그린 그림을 보기만 한다. 그린 것이 없으면 아무것도 그리지 않는다 */
export function CaseSolvePadPreview({ attemptId, problemId }: { attemptId: string; problemId: string }) {
  const { version, load } = useAttemptDrawing(attemptId, problemId)
  // 원격 그림을 받아 오면(version) 다시 읽는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const strokes = useMemo(load, [version, attemptId, problemId])
  if (!hasInk(strokes)) return null
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-xs font-semibold text-foreground">내 그림</h3>
      <DrawingPreview questionId={problemId} strokes={strokes} />
    </section>
  )
}
