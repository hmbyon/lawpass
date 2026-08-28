'use client'

import { useCallback, useEffect, useState } from 'react'
import { getQuestions, getSourceFiles } from '@/lib/store'
import { getAppMode } from '@/lib/appMode'
import {
  publishPool, listMyPools, grantAccess, revokeAccess, describeMembers,
  type PoolMeta, type PoolMember,
} from '@/lib/firebaseServices/pools'

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

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const list = await listMyPools(ownerUid)
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
    refresh()
  }, [refresh])

  // 이미 발행된 문제집인지 (sourceFile 기준). 있으면 '재발행'이 된다
  const poolOf = (sourceFile: string) => pools.find((p) => p.sourceFile === sourceFile)

  async function handlePublish(sourceFile: string) {
    const existing = poolOf(sourceFile)
    const questions = getQuestions().filter((q) => (q.sourceFile ?? '(출처 없음)') === sourceFile)
    if (questions.length === 0) return
    const label = existing ? '재발행' : '발행'
    if (
      !confirm(
        `"${sourceFile}" 문제 ${questions.length}개를 ${label}합니다.\n\n` +
          '공유용 사본이 만들어집니다. 내 문제 데이터는 그대로 있습니다.' +
          (existing ? '\n이미 준 권한은 그대로 유지됩니다.' : '')
      )
    ) {
      return
    }
    setBusy(sourceFile)
    setError(null)
    setNotice(null)
    try {
      await publishPool({
        poolId: existing?.id,
        ownerUid,
        title: sourceFile,
        sourceFile,
        mode: getAppMode(),
        questions,
      })
      setNotice(`"${sourceFile}" ${label} 완료 (${questions.length}문제)`)
      await refresh()
    } catch (e) {
      setError(`${label}에 실패했습니다. (${String(e)})`)
    } finally {
      setBusy(null)
    }
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

      {error && <p className="text-xs text-red-400 break-all">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{notice}</p>}

      {/* 내 문제집 → 발행 */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">내 문제집</p>
        {files.length === 0 && <p className="text-xs text-muted-foreground">업로드된 문제집이 없습니다</p>}
        {files.map((f) => {
          const pool = poolOf(f.name)
          return (
            <div key={f.name} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-foreground">{f.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{f.count}문제</span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => handlePublish(f.name)}
                className="shrink-0 px-2 py-1 border border-primary/40 text-primary rounded font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === f.name ? '올리는 중…' : pool ? '재발행' : '발행'}
              </button>
            </div>
          )
        })}
      </div>

      {/* 발행된 문제집 → 권한 부여·회수 */}
      <div className="space-y-2 pt-1">
        <p className="text-xs text-muted-foreground">발행된 문제집</p>
        {!loaded && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
        {loaded && pools.length === 0 && (
          <p className="text-xs text-muted-foreground">아직 발행한 문제집이 없습니다</p>
        )}
        {pools.map((pool) => (
          <div key={pool.id} className="rounded-lg border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate font-medium text-foreground">{pool.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {pool.count}문제 · 조각 {pool.shardCount}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {new Date(pool.publishedAt).toLocaleString('ko-KR')} 발행 · 판본 {pool.version}
            </p>

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
      </div>

      <p className="text-[11px] text-muted-foreground">
        발행은 공유용 사본을 만드는 일이라 내 문제 데이터에는 영향이 없습니다. 권한을 받은 사람이 이 문제집을
        내려받아 푸는 기능은 아직 준비 중입니다.
      </p>
    </div>
  )
}
