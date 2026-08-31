'use client'

import { useCallback, useEffect, useState } from 'react'
import { getQuestions, getSourceFiles } from '@/lib/store'
import { getAppMode } from '@/lib/appMode'
import {
  publishPool, unpublishPool, listMyPools, grantAccess, revokeAccess, describeMembers,
  overlapWith, RECONNECT_THRESHOLD,
  type PoolMeta, type PoolMember,
} from '@/lib/firebaseServices/pools'
import type { Question } from '@/lib/types'

// 여러 개를 한 번에 올리는 동안의 busy 표시. 파일 이름과 겹칠 수 없는 값이어야 한다
const BATCH = ' batch'
// 여러 문제집에 한 번에 권한을 주는 동안의 표시. poolId 와 겹칠 수 없는 값이어야 한다
const BATCH_GRANT = ' batch-grant'

// store.ts 의 getSourceFiles 가 sourceFile 없는 문제를 묶는 이름
const NO_SOURCE_FILE = '(출처 없음)'

/**
 * 문제집 공유 — 관리자 패널 (설계: docs/shared-pool-design.md)
 *
 * 발행은 내 문제집을 pools/ 로 '복사'하는 일이다. 로컬 원본도, 내 Firestore 트리도
 * 건드리지 않는다. 받는 사람이 이걸 내려받아 쓰는 기능은 다음 단계다.
 */
export function AdminPoolPanel({ ownerUid }: { ownerUid: string }) {
  const [files, setFiles] = useState<{ name: string; count: number }[]>([])
  const [pools, setPools] = useState<PoolMeta[]>([])
  const [members, setMembers] = useState<Record<string, PoolMember[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [emailInput, setEmailInput] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<string | null>(null)
  const [bySource, setBySource] = useState<Record<string, Question[]>>({})
  const [selectedPools, setSelectedPools] = useState<Set<string>>(new Set())
  const [batchEmail, setBatchEmail] = useState('')

  const refresh = useCallback(async () => {
    setError(null)
    try {
      // 지금 모드의 발행본만 다룬다. 두 모드가 섞여 있으면 이름이 같은 문제집끼리
      // 재발행 대상으로 잡혀(poolOf 는 sourceFile 만 본다) LawPass 발행본을 ExamPass
      // 문제로 갈아끼우게 된다. 여기서 거르면 겹침 판정도 같은 모드 안에서만 일어난다
      const mode = getAppMode()
      const list = (await listMyPools(ownerUid)).filter((p) => (p.mode ?? 'law') === mode)
      setPools(list)
      // 명단에는 uid만 있어 누구인지 알 수 없다. 이메일을 붙여 보여준다
      const named: Record<string, PoolMember[]> = {}
      for (const p of list) named[p.id] = await describeMembers(p.memberUids)
      setMembers(named)
    } catch (e) {
      setError(`발행 목록을 불러오지 못했습니다. firestore.rules의 pools 규칙이 배포됐는지 확인하세요. (${String(e)})`)
    } finally {
      setLoaded(true)
    }
  }, [ownerUid])

  useEffect(() => {
    setFiles(getSourceFiles())
    // 겹침 판정에 쓰려고 문제집별로 묶어 둔다. 문제 배열을 매번 다시 훑지 않기 위해서다
    const grouped: Record<string, Question[]> = {}
    for (const q of getQuestions()) {
      const key = q.sourceFile ?? NO_SOURCE_FILE
      ;(grouped[key] ??= []).push(q)
    }
    setBySource(grouped)
    refresh()
  }, [refresh])

  // 이미 발행된 문제집인지 (sourceFile 기준). 있으면 '재발행'이 된다
  const poolOf = (sourceFile: string) => pools.find((p) => p.sourceFile === sourceFile)

  // 목록에 없는 이름이 선택에 남아 있을 수 있다(고른 뒤 원본을 지운 경우). 실제 목록 기준으로 센다
  const selectedCount = files.filter((f) => selected.has(f.name)).length
  // 발행 취소된 문제집이 선택에 남아 있을 수 있어 같은 방식으로 센다
  const selectedPoolCount = pools.filter((p) => selectedPools.has(p.id)).length

  // 발행본과 원본의 연결은 sourceFile 문자열 일치뿐이다. 원본을 지웠거나 이름을 바꾸면
  // (문제집 합치기 포함) 그 연결이 조용히 끊긴다 — 재발행한 줄 알았는데 실제로는 새 pool 이
  // 하나 더 생기고, 권한을 받은 사람은 낡은 판본을 계속 보게 된다.
  // 연결을 되살리는 일은 아래 겹침 판정이 맡고, 여기서는 끊긴 것을 눈에 보이게 한다
  const localFiles = new Set(files.map((f) => f.name))

  /**
   * 이름이 어긋난 짝의 겹침 비율. 짝이 될 수 없는 조합은 아예 보지 않는다 —
   * 발행본에 제 이름의 원본이 살아 있거나, 문제집에 제 이름의 발행본이 있으면
   * 이미 이름으로 이어져 있으므로 겹침을 따질 이유가 없다.
   * 옛 판본(단서 없는 pool)은 overlapWith 가 null 을 주므로 자연히 이름 판정만 남는다
   */
  function overlapOf(pool: PoolMeta, fileName: string): number | null {
    if (localFiles.has(pool.sourceFile)) return null
    if (pools.some((p) => p.sourceFile === fileName)) return null
    const o = overlapWith(pool, bySource[fileName] ?? [])
    return o && o.ratio >= RECONNECT_THRESHOLD ? o.ratio : null
  }

  const percent = (ratio: number) => Math.round(ratio * 100)

  /** 이 발행본의 원본으로 보이는 로컬 문제집 (가장 많이 겹치는 하나) */
  function fileFor(pool: PoolMeta): { name: string; ratio: number } | null {
    let best: { name: string; ratio: number } | null = null
    for (const f of files) {
      const ratio = overlapOf(pool, f.name)
      if (ratio !== null && (!best || ratio > best.ratio)) best = { name: f.name, ratio }
    }
    return best
  }

  /** 이 문제집이 갈아끼울 만한 발행본 (가장 많이 겹치는 하나) */
  function poolFor(fileName: string): { pool: PoolMeta; ratio: number } | null {
    let best: { pool: PoolMeta; ratio: number } | null = null
    for (const p of pools) {
      const ratio = overlapOf(p, fileName)
      if (ratio !== null && (!best || ratio > best.ratio)) best = { pool: p, ratio }
    }
    return best
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  /** 한 문제집을 올린다. 실패는 던진다 — 여러 개를 돌릴 때 부르는 쪽이 모아서 보고한다 */
  async function publishOne(sourceFile: string, existing: PoolMeta | undefined): Promise<number> {
    const questions = getQuestions().filter((q) => (q.sourceFile ?? '(출처 없음)') === sourceFile)
    if (questions.length === 0) throw new Error('문제가 하나도 없습니다')
    await publishPool({
      poolId: existing?.id,
      ownerUid,
      title: sourceFile,
      sourceFile,
      mode: getAppMode(),
      questions,
    })
    return questions.length
  }

  async function handlePublishSelected() {
    const names = files.filter((f) => selected.has(f.name)).map((f) => f.name)
    if (names.length === 0) return

    // 어느 발행본을 갈아끼울지 먼저 정한다. 이름이 정확히 맞으면 그것으로 가고,
    // 이름은 어긋나는데 내용이 겹치면 사람에게 묻는다 — 겹침만 보고 말없이 이어붙이면
    // 엉뚱한 발행본을 덮어써 권한 받은 사람들이 다른 문제집을 보게 된다
    const targets = new Map<string, PoolMeta | undefined>()
    let reconnected = 0
    for (const name of names) {
      const exact = poolOf(name)
      if (exact) {
        targets.set(name, exact)
        continue
      }
      const cand = poolFor(name)
      if (
        cand &&
        confirm(
          `"${name}" 은(는) 이미 발행된 "${cand.pool.title}" 과(와) ${percent(cand.ratio)}% 겹칩니다.\n\n` +
            '그 발행본을 이 문제집으로 재발행할까요?\n' +
            '이미 준 권한은 유지되고, 권한을 받은 사람은 이 판본을 보게 됩니다.\n\n' +
            '취소하면 새 발행본이 하나 더 생깁니다 — 권한을 받은 사람은 옛 판본에 그대로 남습니다.'
        )
      ) {
        targets.set(name, cand.pool)
        reconnected++
        continue
      }
      targets.set(name, undefined)
    }

    // 이미 발행된 것과 처음 올리는 것이 섞여 있을 수 있다. 각각 재발행·발행으로 간다
    const again = names.filter((n) => targets.get(n))
    const detail = [
      names.length - again.length > 0 ? `새로 발행 ${names.length - again.length}개` : null,
      again.length > 0 ? `재발행 ${again.length}개 (이미 준 권한은 유지됩니다)` : null,
      reconnected > 0 ? `그중 이름이 바뀐 것 ${reconnected}개를 옛 발행본에 다시 잇습니다` : null,
    ]
      .filter(Boolean)
      .join('\n')
    if (
      !confirm(
        `문제집 ${names.length}개를 올립니다.\n\n${detail}\n\n` +
          '공유용 사본이 만들어집니다. 내 문제 데이터는 그대로 있습니다.'
      )
    ) {
      return
    }

    setBusy(BATCH)
    setError(null)
    setNotice(null)
    const done: string[] = []
    const failed: { name: string; why: string }[] = []
    // 순차로 돌린다. 한 문제집이 여러 조각으로 나뉘어 쓰이므로 동시에 던지면 쓰기 순서가 엉킨다
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      setProgress(`${i + 1}/${names.length} · ${name}`)
      try {
        const count = await publishOne(name, targets.get(name))
        done.push(`${name} (${count}문제)`)
      } catch (e) {
        failed.push({ name, why: e instanceof Error ? e.message : String(e) })
      }
    }
    setProgress(null)
    setBusy(null)
    // 실패한 것만 선택에 남긴다 — 그대로 다시 누르면 재시도가 된다
    setSelected(new Set(failed.map((f) => f.name)))
    if (done.length > 0) setNotice(`발행 완료 ${done.length}개\n${done.join('\n')}`)
    if (failed.length > 0) {
      setError(`발행 실패 ${failed.length}개\n${failed.map((f) => `${f.name} — ${f.why}`).join('\n')}`)
    }
    await refresh()
  }

  /** 끊긴 발행본을 겹치는 로컬 문제집으로 다시 잇는다 (재발행이 곧 재연결이다) */
  async function handleReconnect(pool: PoolMeta, cand: { name: string; ratio: number }) {
    const count = (bySource[cand.name] ?? []).length
    if (
      !confirm(
        `발행본 "${pool.title}" 은(는) 로컬의 "${cand.name}" 과(와) ${percent(cand.ratio)}% 겹칩니다.\n\n` +
          `"${cand.name}" (${count}문제)으로 이 발행본을 재발행할까요?\n` +
          '이미 준 권한은 유지되고, 권한을 받은 사람은 이 판본을 보게 됩니다.\n\n' +
          '잘못 짚였다면 취소하세요 — 취소하면 아무 일도 일어나지 않습니다.'
      )
    ) {
      return
    }
    setBusy(pool.id)
    setError(null)
    setNotice(null)
    try {
      const published = await publishOne(cand.name, pool)
      // 재발행하면 발행본의 sourceFile 이 새 이름으로 바뀌므로, 다음부터는 이름만으로 이어진다
      setNotice(`"${pool.title}" 을(를) "${cand.name}" 으로 다시 이었습니다 (${published}문제)`)
      await refresh()
    } catch (e) {
      setError(`다시 잇지 못했습니다. (${String(e)})`)
    } finally {
      setBusy(null)
    }
  }

  async function handleUnpublish(pool: PoolMeta) {
    const who = (members[pool.id] ?? []).length
    if (
      !confirm(
        `"${pool.title}" 발행을 취소할까요?\n\n` +
          `발행을 취소하면 권한을 받은 사람 모두 접근이 끊깁니다.${who > 0 ? ` (현재 ${who}명)` : ''}\n` +
          '공유용 사본만 지워지고 내 문제 데이터는 그대로 있습니다.\n\n' +
          '되돌릴 수 없습니다 — 다시 공유하려면 발행과 권한 주기를 처음부터 다시 해야 합니다.'
      )
    ) {
      return
    }
    setBusy(pool.id)
    setError(null)
    setNotice(null)
    try {
      await unpublishPool(pool.id)
      setNotice(`"${pool.title}" 발행을 취소했습니다`)
      await refresh()
    } catch (e) {
      setError(`발행 취소에 실패했습니다. (${String(e)})`)
    } finally {
      setBusy(null)
    }
  }

  function togglePool(poolId: string) {
    setSelectedPools((prev) => {
      const next = new Set(prev)
      if (!next.delete(poolId)) next.add(poolId)
      return next
    })
  }

  /**
   * 고른 문제집들에 한 사람 권한을 한 번에 준다.
   * 카드마다 같은 이메일을 다시 치지 않으려는 것뿐이라, 주는 일 자체는 카드별 '권한 주기'와
   * 똑같이 grantAccess 를 부른다 — 순차로 도는 것도 발행과 같은 이유다
   */
  async function handleGrantSelected() {
    const targets = pools.filter((p) => selectedPools.has(p.id))
    const email = batchEmail.trim()
    if (targets.length === 0 || !email) return

    setBusy(BATCH_GRANT)
    setError(null)
    setNotice(null)
    const done: string[] = []
    const failed: { title: string; why: string }[] = []
    for (let i = 0; i < targets.length; i++) {
      const pool = targets[i]
      setProgress(`${i + 1}/${targets.length} · ${pool.title}`)
      try {
        await grantAccess(pool.id, email)
        done.push(pool.title)
      } catch (e) {
        // 로그인 기록이 없는 이메일이면 첫 번째부터 같은 이유로 다 실패한다.
        // 그래도 하나씩 다 시도해 결과를 모은다 — 어디까지 됐는지 사람이 봐야 한다
        failed.push({ title: pool.title, why: e instanceof Error ? e.message : String(e) })
      }
    }
    setProgress(null)
    setBusy(null)
    // 실패한 것만 선택에 남긴다 — 이메일을 고쳐 그대로 다시 누르면 재시도가 된다
    const failedTitles = new Set(failed.map((f) => f.title))
    setSelectedPools(new Set(targets.filter((p) => failedTitles.has(p.title)).map((p) => p.id)))
    if (failed.length === 0) setBatchEmail('')
    if (done.length > 0) setNotice(`${email} 에게 권한을 주었습니다 ${done.length}개\n${done.join('\n')}`)
    if (failed.length > 0) {
      setError(`권한 주기 실패 ${failed.length}개\n${failed.map((f) => `${f.title} — ${f.why}`).join('\n')}`)
    }
    await refresh()
  }

  async function handleGrant(pool: PoolMeta) {
    const email = (emailInput[pool.id] ?? '').trim()
    if (!email) return
    setBusy(pool.id)
    setError(null)
    setNotice(null)
    try {
      await grantAccess(pool.id, email)
      setEmailInput((prev) => ({ ...prev, [pool.id]: '' }))
      setNotice(`${email} 에게 "${pool.title}" 열람 권한을 주었습니다`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleRevoke(pool: PoolMeta, member: PoolMember) {
    const who = member.email ?? member.uid
    if (!confirm(`${who} 의 "${pool.title}" 열람 권한을 회수할까요?\n\n그 사람의 오답노트·학습 기록은 남습니다.`)) return
    setBusy(pool.id)
    setError(null)
    setNotice(null)
    try {
      await revokeAccess(pool.id, member.uid)
      setNotice(`${who} 의 권한을 회수했습니다`)
      await refresh()
    } catch (e) {
      setError(`회수에 실패했습니다. (${String(e)})`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">문제집 공유</h3>
        <span className="text-[11px] text-muted-foreground">관리자 전용</span>
      </div>

      {error && <p className="text-xs text-red-400 break-all whitespace-pre-line">{error}</p>}
      {notice && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 break-all whitespace-pre-line">{notice}</p>
      )}

      {/* 내 문제집 → 발행 (여러 개를 골라 한 번에 올릴 수 있다) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">내 문제집</p>
          {files.length > 0 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                setSelected(selectedCount === files.length ? new Set() : new Set(files.map((f) => f.name)))
              }
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              {selectedCount === files.length ? '전체 해제' : '전체 선택'}
            </button>
          )}
        </div>
        {files.length === 0 && <p className="text-xs text-muted-foreground">업로드된 문제집이 없습니다</p>}
        {files.map((f) => {
          const pool = poolOf(f.name)
          return (
            <label key={f.name} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(f.name)}
                disabled={busy !== null}
                onChange={() => toggleSelect(f.name)}
                className="shrink-0 accent-primary disabled:opacity-40"
              />
              <span className="flex-1 truncate text-foreground">{f.name}</span>
              {/* 이미 올라간 것은 다시 고르면 재발행이 된다는 표시 */}
              {pool && <span className="shrink-0 text-[11px] text-muted-foreground">발행됨</span>}
              <span className="shrink-0 tabular-nums text-muted-foreground">{f.count}문제</span>
            </label>
          )
        })}
        {files.length > 0 && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="flex-1 truncate text-[11px] text-muted-foreground">
              {busy === BATCH ? (progress ?? '올리는 중…') : selectedCount === 0 ? '올릴 문제집을 고르세요' : ''}
            </span>
            <button
              type="button"
              disabled={busy !== null || selectedCount === 0}
              onClick={handlePublishSelected}
              className="shrink-0 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy === BATCH ? '올리는 중…' : selectedCount > 1 ? `${selectedCount}개 발행` : '발행'}
            </button>
          </div>
        )}
      </div>

      {/* 발행된 문제집 → 권한 부여·회수 */}
      <div className="space-y-2 pt-1">
        <p className="text-xs text-muted-foreground">발행된 문제집</p>
        {!loaded && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
        {loaded && pools.length === 0 && (
          <p className="text-xs text-muted-foreground">
            이 모드에서 발행한 문제집이 없습니다 (다른 모드의 발행본은 그 모드로 바꾸면 보입니다)
          </p>
        )}
        {pools.map((pool) => (
          <div key={pool.id} className="rounded-lg border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedPools.has(pool.id)}
                disabled={busy !== null}
                onChange={() => togglePool(pool.id)}
                aria-label={`${pool.title} 선택`}
                className="shrink-0 accent-primary disabled:opacity-40"
              />
              <span className="flex-1 truncate font-medium text-foreground">{pool.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {pool.count}문제 · 조각 {pool.shardCount}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => handleUnpublish(pool)}
                className="shrink-0 px-2 py-0.5 border border-red-400/40 text-red-400 rounded hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === pool.id ? '처리 중…' : '발행 취소'}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {new Date(pool.publishedAt).toLocaleString('ko-KR')} 발행 · 판본 {pool.version}
            </p>
            {!localFiles.has(pool.sourceFile) && (
              <>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  원본이 로컬에 없습니다 — &quot;{pool.sourceFile}&quot; 이름 그대로 다시 올리면 재발행으로 이어집니다.
                  다른 이름으로 올리면 이 문제집과 연결되지 않고 새 발행본이 하나 더 생깁니다.
                </p>
                {/* 이름은 어긋나도 내용이 겹치면 그 문제집을 짚어준다. 잇는 것은 사람이 확인한 뒤에만 */}
                {(() => {
                  const cand = fileFor(pool)
                  if (!cand) return null
                  return (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-[11px] text-amber-600 dark:text-amber-400">
                        로컬의 &quot;{cand.name}&quot; 과(와) {percent(cand.ratio)}% 겹칩니다 — 이름만 바뀐 같은
                        문제집으로 보입니다
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleReconnect(pool, cand)}
                        className="shrink-0 px-2 py-0.5 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {busy === pool.id ? '처리 중…' : '이 문제집으로 재발행'}
                      </button>
                    </div>
                  )
                })()}
              </>
            )}

            {/* 권한을 가진 사람 */}
            <div className="space-y-1">
              {(members[pool.id] ?? []).length === 0 && (
                <p className="text-[11px] text-muted-foreground">아직 권한을 준 사람이 없습니다</p>
              )}
              {(members[pool.id] ?? []).map((m) => (
                <div key={m.uid} className="flex items-center gap-2 text-xs">
                  {/* 이메일을 못 찾는 경우 uid를 그대로 보여준다. 감추면 회수할 대상을 특정할 수 없다 */}
                  <span className="flex-1 truncate text-foreground">{m.email ?? m.uid}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleRevoke(pool, m)}
                    className="shrink-0 px-2 py-0.5 border border-red-400/40 text-red-400 rounded hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    회수
                  </button>
                </div>
              ))}
            </div>

            {/* 권한 부여 */}
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={emailInput[pool.id] ?? ''}
                onChange={(e) => setEmailInput((prev) => ({ ...prev, [pool.id]: e.target.value }))}
                placeholder="권한을 줄 이메일"
                className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                disabled={busy !== null || !(emailInput[pool.id] ?? '').trim()}
                onClick={() => handleGrant(pool)}
                className="shrink-0 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                권한 주기
              </button>
            </div>
          </div>
        ))}

        {/* 여러 문제집에 같은 사람 권한을 한 번에 준다. 카드별 '권한 주기'는 그대로 두고,
            같은 이메일을 카드 수만큼 다시 치지 않게 하는 것이 전부다.
            고른 것이 없으면 아예 보여주지 않는다 — 늘 떠 있으면 카드별 입력란과 헷갈린다 */}
        {selectedPoolCount > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              선택한 {selectedPoolCount}개에 한 번에 권한 주기
              {busy === BATCH_GRANT && progress && ` · ${progress}`}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={batchEmail}
                onChange={(e) => setBatchEmail(e.target.value)}
                placeholder="권한을 줄 이메일"
                className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                disabled={busy !== null || !batchEmail.trim()}
                onClick={handleGrantSelected}
                className="shrink-0 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === BATCH_GRANT ? '주는 중…' : `${selectedPoolCount}개에 권한 주기`}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        발행은 공유용 사본을 만드는 일이라 내 문제 데이터에는 영향이 없습니다. 권한을 받은 사람이 이 문제집을
        내려받아 푸는 기능은 아직 준비 중입니다.
      </p>
    </div>
  )
}
