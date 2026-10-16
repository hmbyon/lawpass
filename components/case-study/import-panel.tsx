'use client'

import { useState } from 'react'
import { auth } from '@/lib/firebase'
import { isAdminEmail } from '@/lib/admin'
import { getAppMode } from '@/lib/appMode'
import { parseCaseFile, type ParsedFile } from '@/lib/caseStudy/parse'
import { caseCardExists, saveCaseCard, saveCaseIndex } from '@/lib/firebaseServices/caseStudy'

interface Result {
  ok: number
  failed: { name: string; reason: string }[]
  warnings: string[]
}

/**
 * 사례형 카드 JSON 가져오기 — 관리자 전용. app-shell 이 관리자에게만 이 트리를 만든다.
 * 카드 문서를 전부 쓴 뒤에 색인을 쓴다 — 중간에 실패해도 색인이 없는 카드를 가리키지 않게
 */
export function ImportPanel() {
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const busy = progress !== null && result === null

  async function run() {
    // 화면 게이트와 별개로 한 번 더 막는다. 실제 보안 판정은 Firestore 규칙(본인 트리만 쓰기)이 한다
    if (!isAdminEmail(auth.currentUser?.email)) return
    const mode = getAppMode()
    const failed: Result['failed'] = []
    const warnings: string[] = []
    const parsed: ParsedFile[] = []
    for (const f of files) {
      try {
        parsed.push(parseCaseFile(f.name, await f.text()))
      } catch (e) {
        failed.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    const cards = parsed.flatMap((p) => (p.kind === 'card' ? [p] : []))
    const indexes = parsed.flatMap((p) => (p.kind === 'index' ? [p] : []))
    const total = cards.length + indexes.length
    let done = 0
    let ok = 0
    const savedIds = new Set<string>()
    setResult(null)
    setProgress({ done, total })

    for (const c of cards) {
      try {
        await saveCaseCard(mode, c.card) // 같은 id 는 덮어쓴다
        savedIds.add(c.card.id)
        ok++
      } catch (e) {
        failed.push({ name: c.name, reason: e instanceof Error ? e.message : String(e) })
      }
      setProgress({ done: ++done, total })
    }

    for (const ix of indexes) {
      try {
        await saveCaseIndex(mode, ix.index)
        ok++
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
        failed.push({ name: ix.name, reason: e instanceof Error ? e.message : String(e) })
      }
      setProgress({ done: ++done, total })
    }
    if (indexes.length === 0 && cards.length > 0) {
      warnings.push('_index.json 을 함께 올리지 않아 목록(색인)은 바뀌지 않았습니다')
    }
    setResult({ ok, failed, warnings })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">사례형 카드 가져오기</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          카드 JSON 여러 개와 _index.json 을 함께 고릅니다. 같은 id 는 덮어씁니다.
        </p>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        multiple
        disabled={busy}
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []))
          setResult(null)
          setProgress(null)
        }}
        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:text-foreground"
      />
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
          {result.warnings.map((w, i) => (
            <p key={i} className="text-amber-400 break-all">⚠️ {w}</p>
          ))}
        </div>
      )}
    </div>
  )
}
