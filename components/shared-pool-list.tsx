'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPoolQuestions, savePoolQuestions } from '@/lib/store'
import { getAppMode } from '@/lib/appMode'
import { listSharedPools, readPoolQuestions, type PoolMeta } from '@/lib/firebaseServices/pools'

/**
 * 공유받은 문제집 — 받는 사람 쪽 (설계: docs/shared-pool-design.md)
 *
 * 받은 문제는 lawpass_pool_questions_{mode} 에만 들어간다. 내 문제 목록에는 섞이지 않고,
 * 섞으려 해도 store 의 saveQuestions 가 poolId 를 보고 걸러낸다.
 * 받아둔 문제로 CBT·선학습을 푸는 것은 다음 단계다 — 여기서는 받아 두기까지만 한다.
 */

// 어느 판본을 받아뒀는지. 문항 배열에는 판본이 없어서 "업데이트 있음"을 판단할 수 없다.
// store.ts 는 이번 단계에서 손대지 않기로 했으므로 이 화면이 쓰는 기록만 여기 둔다.
// lawpass_ 로 시작하므로 전체 초기화 때 함께 지워진다
const RECEIVED_KEY = 'lawpass_pool_received'

interface Received {
  version: string
  count: number
  receivedAt: number
}

function receivedKey(): string {
  return `${RECEIVED_KEY}_${getAppMode()}`
}

function getReceived(): Record<string, Received> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(receivedKey())
    return raw ? (JSON.parse(raw) as Record<string, Received>) : {}
  } catch {
    return {}
  }
}

function setReceived(next: Record<string, Received>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(receivedKey(), JSON.stringify(next))
  } catch (e) {
    console.error('[shared-pool] 받은 판본 기록 실패', e)
  }
}

export function SharedPoolList({ userId }: { userId: string }) {
  const [pools, setPools] = useState<PoolMeta[]>([])
  const [received, setReceivedState] = useState<Record<string, Received>>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [orphans, setOrphans] = useState(0)

  // 받아둔 문제 중 더 이상 공유되지 않는 문제집의 것 (권한 회수·발행 취소)
  const countOrphans = useCallback((list: PoolMeta[]) => {
    const live = new Set(list.map((p) => p.id))
    setOrphans(getPoolQuestions().filter((q) => q.poolId && !live.has(q.poolId)).length)
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      // 지금 모드의 문제집만 받는다. 모드가 다른 것을 받으면 저장 키가 화면 모드로 정해져
      // 엉뚱한 쪽에 들어간다 (변시 문제가 ExamPass 저장소로)
      const list = await listSharedPools(userId, getAppMode())
      setPools(list)
      countOrphans(list)
    } catch (e) {
      setError(`공유받은 문제집을 불러오지 못했습니다. (${String(e)})`)
    } finally {
      setReceivedState(getReceived())
      setLoaded(true)
    }
  }, [userId, countOrphans])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleReceive(pool: PoolMeta) {
    setBusy(pool.id)
    setError(null)
    setNotice(null)
    try {
      const questions = await readPoolQuestions(pool.id, getAppMode())
      // 이 문제집 것만 갈아끼운다. 다른 문제집에서 받아둔 것을 쓸어내면 안 된다
      const others = getPoolQuestions().filter((q) => q.poolId !== pool.id)
      savePoolQuestions([...others, ...questions])
      const next = {
        ...getReceived(),
        [pool.id]: { version: pool.version, count: questions.length, receivedAt: Date.now() },
      }
      setReceived(next)
      setReceivedState(next)
      setNotice(`"${pool.title}" ${questions.length}문제를 받았습니다`)
      countOrphans(pools)
    } catch (e) {
      // ②에서 만든 문구를 그대로 보여준다 — 조각 누락인지 권한 회수인지가 거기 담겨 있다
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function handleDropOrphans() {
    if (!confirm(`더 이상 공유되지 않는 문제집의 문제 ${orphans}개를 지울까요?\n\n내 문제와 오답노트는 그대로 있습니다.`)) {
      return
    }
    const live = new Set(pools.map((p) => p.id))
    savePoolQuestions(getPoolQuestions().filter((q) => q.poolId && live.has(q.poolId)))
    const kept: Record<string, Received> = {}
    for (const [id, r] of Object.entries(getReceived())) if (live.has(id)) kept[id] = r
    setReceived(kept)
    setReceivedState(kept)
    setOrphans(0)
    setNotice('받아둔 사본을 정리했습니다')
  }

  // 공유받은 것도 없고 남은 사본도 없으면 이 섹션 자체를 보여주지 않는다
  if (loaded && pools.length === 0 && orphans === 0 && !error) return null

  return (
    <div className="bg-muted rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">공유받은 문제집</h3>
        <button
          type="button"
          disabled={busy !== null}
          onClick={refresh}
          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          새로고침
        </button>
      </div>

      {error && <p className="text-xs text-red-400 break-all">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{notice}</p>}
      {!loaded && <p className="text-xs text-muted-foreground">불러오는 중…</p>}

      {pools.map((pool) => {
        const got = received[pool.id]
        const outdated = got && got.version !== pool.version
        return (
          <div key={pool.id} className="rounded-lg border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate font-medium text-foreground">{pool.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{pool.count}문제</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {new Date(pool.publishedAt).toLocaleString('ko-KR')} 발행 · 판본 {pool.version}
            </p>

            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] text-muted-foreground">
                {!got && '아직 받지 않았습니다'}
                {got && !outdated && `받아뒀습니다 · ${got.count}문제`}
                {outdated && (
                  <span className="text-amber-600 dark:text-amber-400">
                    업데이트 있음 — 받아둔 것은 옛 판본입니다 ({got.count}문제)
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => handleReceive(pool)}
                className="shrink-0 px-2 py-1 border border-primary/40 text-primary rounded text-xs font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === pool.id ? '받는 중…' : outdated ? '새 판본 받기' : got ? '다시 받기' : '받기'}
              </button>
            </div>
          </div>
        )
      })}

      {orphans > 0 && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11px] text-amber-600 dark:text-amber-400">
            더 이상 공유되지 않는 문제집의 문제 {orphans}개가 받아둔 채 남아 있습니다
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleDropOrphans}
            className="shrink-0 px-2 py-0.5 border border-red-400/40 text-red-400 rounded text-xs hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            지우기
          </button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        받은 문제는 내 문제 목록과 따로 보관됩니다. 이 문제집으로 CBT·선학습을 푸는 기능은 아직 준비 중입니다.
      </p>
    </div>
  )
}
