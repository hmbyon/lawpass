'use client'

import { useState } from 'react'
import { auth } from '@/lib/firebase'
import { isAdminEmail } from '@/lib/admin'
import { getAppMode } from '@/lib/appMode'
import { chunkForBatch, parseCaseFile, type ParsedFile } from '@/lib/caseStudy/parse'
import { indexCaseStats } from '@/lib/caseStudy/sanitize'
import {
  BATCH_MAX_BYTES, BATCH_MAX_OPS, caseCardExists, saveCaseCard, saveCaseCardsBatch, saveCaseIndex,
} from '@/lib/firebaseServices/caseStudy'

interface Result {
  ok: number
  failed: { name: string; reason: string }[]
  warnings: string[]
  notes: string[] // 오류·경고가 아닌 알림 (판례 색인 포함 여부)
}

const isJson = (f: File) => f.name.toLowerCase().endsWith('.json')
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

// 끌어다 놓은 파일·폴더에서 파일을 모은다. 폴더는 하위까지 훑는다.
// entry 는 drop 이벤트 안에서 동기로 꺼내야 한다 — await 뒤에는 DataTransfer 가 비어 버린다
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  if (entries.length === 0) return [...dt.files]
  const out: File[] = []
  async function walk(entry: FileSystemEntry) {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)))
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries 는 한 번에 일부(크롬 100개)만 돌려준다. 빈 배열이 올 때까지 반복한다
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (batch.length === 0) break
        for (const e of batch) await walk(e)
      }
    }
  }
  for (const e of entries) await walk(e)
  return out
}

/**
 * 사례형 카드 JSON 가져오기 — 관리자 전용. app-shell 이 관리자에게만 이 트리를 만든다.
 * 카드 문서를 전부 쓴 뒤에 색인을 쓴다 — 중간에 실패해도 색인이 없는 카드를 가리키지 않게
 */
export function ImportPanel() {
  const [files, setFiles] = useState<File[]>([])
  const [skipped, setSkipped] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const busy = progress !== null && result === null

  function choose(list: File[]) {
    const json = list.filter(isJson)
    setFiles(json)
    setSkipped(list.length - json.length)
    setResult(null)
    setProgress(null)
  }

  async function run() {
    // 화면 게이트와 별개로 한 번 더 막는다. 실제 보안 판정은 Firestore 규칙(본인 트리만 쓰기)이 한다
    if (!isAdminEmail(auth.currentUser?.email)) return
    const mode = getAppMode()
    const total = files.length
    const failed: Result['failed'] = []
    const warnings: string[] = []
    const notes: string[] = []
    const parsed: ParsedFile[] = []
    let done = 0
    let ok = 0
    setResult(null)
    setProgress({ done, total })

    // 읽기·검증에서 걸린 파일은 실패로 적고 나머지는 계속 간다 (깨진 JSON, OneDrive 에서 못 받은 파일 등)
    for (const f of files) {
      try {
        const p = parseCaseFile(f.name, await f.text())
        parsed.push(p)
        for (const w of p.warnings) warnings.push(`${f.name} — ${w}`)
      } catch (e) {
        failed.push({ name: f.name, reason: reason(e) })
        setProgress({ done: ++done, total })
      }
    }
    const cards = parsed.flatMap((p) => (p.kind === 'card' ? [p] : []))
    const indexes = parsed.flatMap((p) => (p.kind === 'index' ? [p] : []))
    const savedIds = new Set<string>()

    // 묶음 단위로 쓴다. 묶음이 거부되면(원자적이라 전부 안 써짐) 그 묶음만 한 장씩 다시 써서 범인을 가린다
    for (const chunk of chunkForBatch(cards, BATCH_MAX_OPS, BATCH_MAX_BYTES)) {
      try {
        await saveCaseCardsBatch(mode, chunk.map((c) => c.card)) // 같은 id 는 덮어쓴다
        for (const c of chunk) savedIds.add(c.card.id)
        ok += chunk.length
        done += chunk.length
        setProgress({ done, total })
      } catch {
        for (const c of chunk) {
          try {
            await saveCaseCard(mode, c.card)
            savedIds.add(c.card.id)
            ok++
          } catch (e) {
            failed.push({ name: c.name, reason: reason(e) })
          }
          setProgress({ done: ++done, total })
        }
      }
    }

    for (const ix of indexes) {
      try {
        // 크기(900KB)는 saveCaseIndex 가 쓰기 전에 재고, 넘으면 쓰지 않고 실패로 알린다
        await saveCaseIndex(mode, ix.index)
        ok++
        // v1.1 색인은 카드·문항에 판례번호(cases)를 싣는다. 없으면 v1 형식일 뿐 오류가 아니다
        const stats = indexCaseStats(ix.index)
        notes.push(stats.cases > 0 ? `판례 색인 포함: 카드 ${stats.cards}개, 판례 ${stats.cases}종` : '판례 색인 없음(v1 형식)')
        // 색인이 가리키는데 이번에 올라오지 않았고 원격에도 없는 카드 — 목록에서 눌러도 열리지 않는다
        const missing: string[] = []
        for (const c of ix.index.cards) {
          if (!savedIds.has(c.id) && !(await caseCardExists(mode, c.id))) missing.push(c.id)
        }
        if (missing.length > 0) warnings.push(`색인에는 있는데 카드가 없는 id ${missing.length}개: ${missing.join(', ')}`)
        const indexed = new Set(ix.index.cards.map((c) => c.id))
        const orphans = [...savedIds].filter((id) => !indexed.has(id))
        if (orphans.length > 0) warnings.push(`색인에 없어 목록에 보이지 않는 카드: ${orphans.join(', ')}`)
      } catch (e) {
        failed.push({ name: ix.name, reason: reason(e) })
      }
      setProgress({ done: ++done, total })
    }
    if (indexes.length === 0 && cards.length > 0) {
      warnings.push('_index.json 을 함께 올리지 않아 목록(색인)은 바뀌지 않았습니다')
    }
    setResult({ ok, failed, warnings, notes })
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (busy) return
        filesFromDrop(e.dataTransfer).then(choose)
      }}
      className={`bg-card border rounded-xl p-4 space-y-3 transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">사례형 카드 가져오기</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          카드 JSON 여러 개와 _index.json 을 함께 고르거나, 폴더째 여기에 끌어다 놓습니다. 같은 id 는 덮어씁니다.
        </p>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        multiple
        disabled={busy}
        onChange={(e) => choose(Array.from(e.target.files ?? []))}
        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:text-foreground"
      />
      {files.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          JSON {files.length}개 선택됨{files.some((f) => f.name === '_index.json') ? ' (_index.json 포함)' : ''}
          {skipped > 0 && ` · JSON 이 아닌 파일 ${skipped}개는 뺐습니다`}
        </p>
      )}
      <button
        onClick={run}
        disabled={busy || files.length === 0}
        className="w-full rounded-lg bg-primary text-primary-foreground text-xs font-semibold py-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? '올리는 중…' : `${files.length}개 파일 올리기`}
      </button>
      {progress && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {progress.done} / {progress.total}
          </p>
        </div>
      )}
      {result && (
        <div className="space-y-2 text-xs">
          <p className="text-foreground">
            성공 <b>{result.ok}</b>개 · 실패 <b className={result.failed.length ? 'text-red-400' : ''}>{result.failed.length}</b>개
          </p>
          {result.failed.length > 0 && (
            <ul className="space-y-0.5 text-red-400">
              {result.failed.map((f, i) => (
                <li key={i}>
                  {f.name} — {f.reason}
                </li>
              ))}
            </ul>
          )}
          {result.notes.map((n, i) => (
            <p key={`n${i}`} className="text-muted-foreground">{n}</p>
          ))}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-amber-400 break-all">⚠️ {w}</p>
          ))}
        </div>
      )}
    </div>
  )
}
