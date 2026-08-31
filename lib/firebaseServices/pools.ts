import { db } from '@/lib/firebase'
import {
  doc, collection, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { shardList } from '@/lib/firebaseServices/sync'
import type { Question } from '@/lib/types'
import type { AppMode } from '@/lib/appMode'

/**
 * 공유 문제집(pool) — 관리자 쪽 기능.
 *
 * 설계: docs/shared-pool-design.md
 * - 공유물은 users 트리 밖의 pools/ 에 둔다. users/{userId}/{document=**} 가 개인 데이터를
 *   지키는 유일한 규칙이라 거기에 예외를 파지 않는다 (§1.1)
 * - 저장은 users 트리와 같은 조각(shard) 방식이다. 문서 1MiB 한도 때문에 244문항은
 *   단일 문서로 들어가지 않는다 (§1.3)
 * - 발행 사본에는 poolId 를 심는다. 원본(localStorage·내 Firestore 트리)은 건드리지 않는다 (§4.3)
 *
 * 받는 사람이 이 데이터를 읽어 로컬에 넣는 일은 3단계다. 이 파일에는 없다.
 */

const POOLS = 'pools'
const USER_DIRECTORY = 'userDirectory'

export interface PoolMeta {
  id: string
  ownerUid: string
  title: string
  sourceFile: string
  mode: AppMode
  memberUids: string[]
  version: string
  shardCount: number
  count: number
  publishedAt: number
  // 원본 재연결 단서. 이 필드가 생기기 전에 발행된 pool 에는 없다 (그때는 이름으로만 판정한다)
  questionIds?: string[]
  fingerprints?: string[]
}

export interface PoolMember {
  uid: string
  email: string | null
}

// ── 원본 재연결 ─────────────────────────────────────────────────────────────
// 발행본과 원본의 연결은 sourceFile 문자열 일치뿐이라, 이름을 바꾸거나(문제집 합치기)
// 지웠다 다시 올리면 조용히 끊긴다. 그래서 발행할 때 내용 쪽 단서를 함께 남긴다.
//
// 두 가지를 같이 적는 이유가 있다.
// - questionIds: 이름만 바뀐 경우를 잡는다. 재파싱 병합에서 id 는 기존 것이 유지되므로
//   (store.ts 의 addQuestions — "id는 유지하므로 오답노트·형광펜 연결이 끊기지 않는다")
//   이름이 바뀌어도 id 는 그대로다.
// - fingerprints: 지웠다 다시 올린 경우를 잡는다. 그때는 id 가 전부 새로 생기고(gemini.ts 가
//   id 에 Date.now() 를 넣는다) 남는 단서는 지문뿐이다.

const FINGERPRINT_PREFIX = 40

// store.ts 의 normalizePassage 와 같은 정규화다. 거기 있는 것은 export 되어 있지 않고
// 이번 단계에서 store.ts 는 손대지 않기로 했으므로 같은 식을 여기 둔다.
// 한쪽만 고치면 판정이 어긋나므로, 둘 중 하나를 바꿀 일이 생기면 반드시 같이 고쳐야 한다
function normalizePassage(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim()
}

/**
 * 지문 지문(fingerprint). 정규화한 지문의 앞 40자만 해싱한다.
 *
 * 앞부분만 쓰는 것은 store.ts 의 isSameQuestion 과 같은 이유다 — 청크 경계에서 뒤가 잘린
 * 판본과 온전한 판본이 같은 문제로 인정돼야 한다. 거기서 "짧은 쪽이 40자 이상이고 긴 쪽의
 * 앞부분이면 같다"고 보므로, 40자를 경계로 삼으면 그 판정과 어긋나지 않는다.
 *
 * FNV-1a 32비트. 250개 남짓에서 충돌 확률은 1000만분의 7 수준이고, 어차피 겹침 비율로
 * 판단한 뒤 사람이 확인하므로 암호학적 강도는 필요 없다
 */
export function fingerprintOf(q: { passage?: string }): string {
  const head = normalizePassage(q.passage ?? '').slice(0, FINGERPRINT_PREFIX)
  let h = 0x811c9dc5
  for (let i = 0; i < head.length; i++) {
    h ^= head.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** 이 비율 이상 겹치면 같은 문제집으로 '의심'한다. 확정은 사람이 한다 */
export const RECONNECT_THRESHOLD = 0.5

/**
 * 발행본과 로컬 문제집이 얼마나 겹치는가. 옛 판본(단서가 없는 pool)은 null 을 돌려준다 —
 * 모르는 것을 0%로 답하면 "안 겹친다"는 판정이 되어버린다.
 *
 * 분모를 양쪽 중 큰 쪽으로 잡는다. 발행본 문제 수로만 나누면 12문제짜리 작은 문제집이
 * 244문제 발행본에 100% 겹치는 것으로 나온다
 */
export function overlapWith(
  pool: Pick<PoolMeta, 'questionIds' | 'fingerprints' | 'count'>,
  questions: Question[]
): { matched: number; ratio: number } | null {
  const ids = new Set(pool.questionIds ?? [])
  const fps = new Set(pool.fingerprints ?? [])
  if (ids.size === 0 && fps.size === 0) return null

  const matched = questions.filter((q) => ids.has(q.id) || fps.has(fingerprintOf(q))).length
  const denom = Math.max(pool.count ?? ids.size, questions.length)
  return { matched, ratio: denom === 0 ? 0 : matched / denom }
}

function rootRef(poolId: string) {
  return doc(db, POOLS, poolId)
}

function shardsRef(poolId: string) {
  return collection(db, POOLS, poolId, 'shards')
}

/**
 * 문제집을 발행한다. poolId 를 주면 그 pool 을 새 판본으로 갈아끼운다(재발행).
 *
 * 쓰는 순서는 sync.ts 의 writeList 와 같다 — 조각을 전부 쓴 뒤에 루트를 갱신하고,
 * 정리는 내가 대체한 직전 판본만 지운다. 중간에 실패하면 루트가 옛 판본을 가리킨 채 남아
 * 읽는 쪽이 깨지지 않는다.
 */
export async function publishPool(opts: {
  poolId?: string
  ownerUid: string
  title: string
  sourceFile: string
  mode: AppMode
  questions: Question[]
}): Promise<string> {
  const poolId = opts.poolId ?? doc(collection(db, POOLS)).id
  const version = Date.now().toString(36)

  // 사본에만 poolId 를 심는다. 원본 배열의 객체는 손대지 않는다 (얕은 복사)
  const copies: Question[] = opts.questions.map((q) => ({ ...q, poolId }))
  const shards = shardList(copies)

  // 재발행이면 직전 판본을 알아야 정리 범위를 좁힐 수 있다
  const prev = await getDoc(rootRef(poolId)).catch(() => null)
  const prevVersion = prev?.exists() ? String(prev.data().version ?? '') : ''

  for (let i = 0; i < shards.length; i++) {
    await setDoc(doc(shardsRef(poolId), `${version}_${i}`), { list: shards[i] })
  }

  const meta = {
    ownerUid: opts.ownerUid,
    title: opts.title,
    sourceFile: opts.sourceFile,
    mode: opts.mode,
    version,
    shardCount: shards.length,
    count: copies.length,
    publishedAt: Date.now(),
    // 이름이 바뀌거나 원본을 지웠다 다시 올렸을 때 이 발행본을 도로 찾아낼 단서.
    // 이미 순회한 배열에서 뽑을 뿐이라 따로 모을 것이 없다 (244문항이면 합쳐서 12KB 남짓)
    questionIds: copies.map((q) => q.id),
    fingerprints: copies.map(fingerprintOf),
  }
  if (prev?.exists()) {
    // 재발행: 이미 준 권한(memberUids)을 덮어쓰지 않는다
    await setDoc(rootRef(poolId), meta, { merge: true })
  } else {
    await setDoc(rootRef(poolId), { ...meta, memberUids: [] })
  }

  // 내가 대체한 판본만 지운다. 다른 판본까지 쓸어내면 그 순간 읽고 있던 쪽이 깨진다
  if (prevVersion && prevVersion !== version) {
    const existing = await getDocs(shardsRef(poolId)).catch(() => null)
    if (existing) {
      await Promise.all(
        existing.docs
          .filter((d) => d.id.startsWith(`${prevVersion}_`))
          .map((d) => deleteDoc(d.ref).catch(() => {}))
      )
    }
  }

  return poolId
}

/**
 * 발행 취소 — 조각을 전부 지운 뒤 루트 문서를 지운다. 되돌릴 수 없다.
 *
 * 조각을 먼저 지우는 이유는 중간에 실패했을 때를 위해서다. 루트가 남아 있으면 목록에 계속
 * 보여 다시 시도할 수 있지만, 루트를 먼저 지우면 남은 조각은 어느 목록에도 안 잡혀
 * 지울 방법이 사라진다.
 *
 * 루트가 사라지는 순간 권한을 받은 사람의 읽기는 규칙에서 막힌다 — 규칙이 memberUids 를
 * 루트 문서에서 읽기 때문이다. 따로 알려주는 절차는 없다.
 */
export async function unpublishPool(poolId: string): Promise<void> {
  const shards = await getDocs(shardsRef(poolId))
  await Promise.all(shards.docs.map((d) => deleteDoc(d.ref)))
  await deleteDoc(rootRef(poolId))
}

/** 내가 발행한 pool 목록. 규칙상 소유자는 자기 pool 을 전부 읽을 수 있다 */
export async function listMyPools(ownerUid: string): Promise<PoolMeta[]> {
  const snap = await getDocs(query(collection(db, POOLS), where('ownerUid', '==', ownerUid)))
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<PoolMeta, 'id'>
      return { ...data, memberUids: data.memberUids ?? [], id: d.id }
    })
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}

/**
 * 나에게 공유된 pool 목록.
 *
 * 규칙이 "명단에 든 사람만 읽는다"이므로, 쿼리도 명단으로 스스로를 좁혀야 한다 —
 * 조건 없이 pools 전체를 훑으면 규칙이 쿼리째 거부한다 (§2 목록 쿼리 안전성).
 * memberUids 는 단일 필드라 색인이 자동으로 만들어진다
 */
export async function listSharedPools(uid: string): Promise<PoolMeta[]> {
  const snap = await getDocs(query(collection(db, POOLS), where('memberUids', 'array-contains', uid)))
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<PoolMeta, 'id'>
      return { ...data, memberUids: data.memberUids ?? [], id: d.id }
    })
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}

/**
 * 공유받은 문제집의 문항을 읽어온다. sync.ts 의 readList 와 같은 형태다 —
 * 루트에 적힌 판본의 조각을 하나씩 getDoc 으로 읽고, 하나라도 비면 던진다.
 * 반쪽짜리 목록을 돌려주면 받는 쪽이 그걸 저장해 문제집이 깎인다.
 *
 * 목록 쿼리가 아니라 문서를 하나씩 읽는 것은 조각 규칙 때문이기도 하다 —
 * 조각 규칙은 pools 루트를 get() 으로 확인하는데, 단일 문서 읽기면 그 확인이 한 번뿐이다.
 *
 * 루트가 없으면 권한이 회수됐거나 발행이 취소된 것이다. 조각이 없으면 읽는 도중에
 * 재발행이 끼어든 것이니, 두 경우 모두 조용히 빈 목록을 주지 않고 오류로 알린다
 */
export async function readPoolQuestions(poolId: string): Promise<Question[]> {
  const snap = await getDoc(rootRef(poolId))
  if (!snap.exists()) {
    throw new Error('이 문제집을 더 이상 볼 수 없습니다. 권한이 회수됐거나 발행이 취소됐습니다.')
  }
  const data = snap.data()
  const title = String(data.title ?? '공유 문제집')
  const shardCount = Number(data.shardCount ?? 0)
  const version = String(data.version ?? '')

  const out: Question[] = []
  for (let i = 0; i < shardCount; i++) {
    const shardSnap = await getDoc(doc(shardsRef(poolId), `${version}_${i}`))
    if (!shardSnap.exists()) {
      throw new Error(`"${title}" 조각 ${i + 1}/${shardCount}을(를) 찾을 수 없습니다. 잠시 뒤 다시 받아보세요.`)
    }
    out.push(...((shardSnap.data().list as Question[]) ?? []))
  }
  // 발행할 때 심어 두지만, 여기서 한 번 더 확인한다. 이 표시가 있어야 store 의 방어선이
  // 남의 문제를 내 목록에서 걸러낸다 — 표시가 빠진 사본이 섞이면 그 방어가 통하지 않는다
  return out.map((q) => (q.poolId === poolId ? q : { ...q, poolId }))
}

/**
 * 이메일로 uid 를 찾는다. 대응표는 로그인할 때 각자가 남긴다(userDirectory.ts).
 * 한 번도 로그인한 적 없는 사람은 여기서 걸린다 — 추측하지 않고 null 을 돌려준다
 */
export async function lookupUidByEmail(email: string): Promise<string | null> {
  const trimmed = email.trim()
  if (!trimmed) return null

  // 대응표에는 로그인 계정의 이메일이 '적힌 그대로' 들어간다(userDirectory.ts는 이번 단계에서
  // 손대지 않는다). 관리자가 대소문자를 다르게 입력할 수 있으므로, 정확히 일치를 먼저 보고
  // 못 찾으면 소문자로 한 번 더 본다. 쓰기 쪽 정규화는 다음 단계에서 정리할 일이다
  for (const candidate of [trimmed, trimmed.toLowerCase()]) {
    const snap = await getDocs(query(collection(db, USER_DIRECTORY), where('email', '==', candidate)))
    if (snap.docs[0]) return snap.docs[0].id
    if (candidate === trimmed.toLowerCase()) break
  }
  return null
}

/** 멤버 uid 들의 이메일을 붙여 돌려준다 (화면에 uid 만 보여주면 누군지 알 수 없다) */
export async function describeMembers(memberUids: string[]): Promise<PoolMember[]> {
  const out: PoolMember[] = []
  for (const uid of memberUids) {
    const snap = await getDoc(doc(db, USER_DIRECTORY, uid)).catch(() => null)
    out.push({ uid, email: snap?.exists() ? ((snap.data().email as string) ?? null) : null })
  }
  return out
}

export class PoolGrantError extends Error {}

/**
 * 열람 권한 부여. 이메일로 uid 를 찾아 명단에 넣는다.
 * 찾지 못하면 조용히 넘어가지 않고 오류로 알린다 — 안 된 것을 된 것처럼 보이면 안 된다
 */
export async function grantAccess(poolId: string, email: string): Promise<string> {
  const uid = await lookupUidByEmail(email)
  if (!uid) {
    throw new PoolGrantError(
      `'${email.trim()}' 로 로그인한 기록이 없습니다. 그 사람이 앱에 한 번 로그인한 뒤에 다시 시도해주세요.`
    )
  }
  await updateDoc(rootRef(poolId), { memberUids: arrayUnion(uid) })
  return uid
}

/** 열람 권한 회수. 명단에서 빼는 즉시 규칙이 그 사람의 읽기를 거부한다 */
export async function revokeAccess(poolId: string, uid: string): Promise<void> {
  await updateDoc(rootRef(poolId), { memberUids: arrayRemove(uid) })
}
