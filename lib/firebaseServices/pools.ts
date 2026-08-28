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
}

export interface PoolMember {
  uid: string
  email: string | null
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
