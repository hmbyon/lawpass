import { db } from '@/lib/firebase'
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection } from 'firebase/firestore'
import {
  getQuestions, saveQuestions,
  getWrongNotes, saveWrongNotes,
  getApiKey, setApiKey,
  getSavedStudySessions, saveSavedStudySessions, clearAllSavedStudySessions,
  getSavedSession, saveSession, clearSavedSession,
  hasPendingSync, clearPendingSync, markPendingSync,
  type SavedSession, type SavedStudySession,
} from '@/lib/store'
import { getAppMode } from '@/lib/appMode'
import type { Question, WrongNote } from '@/lib/types'

// Firestore 문서 하나의 한도는 1MiB다. 문제 목록은 지문·선지별 해설 원문까지 담아
// 문항당 5~10KB에 이르므로 100문항 남짓이면 한도를 넘고, 그때부터 push가 통째로 실패한다.
// 그래서 목록은 한 문서에 몰아넣지 않고 여러 조각(shard) 문서로 나눠 저장한다
const SHARD_BUDGET_BYTES = 700_000

// 동기화 단계 추적용 임시 로그. 원인 규명이 끝나면 이 함수와 호출부만 지우면 된다
function syncLog(...args: unknown[]) {
  console.log('[sync]', ...args)
}

type ListName = 'questions' | 'wrongNotes' | 'studySessions' | 'quizSession'

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

// 항목 단위로 예산을 채워 나눈다. 항목 하나가 예산을 넘겨도 어딘가에는 담아야 하므로
// 그때는 그 항목만 단독 조각으로 내보낸다
function shardList<T>(list: T[]): T[][] {
  const shards: T[][] = []
  let current: T[] = []
  let currentBytes = 0
  for (const item of list) {
    const size = byteLength(item)
    if (current.length > 0 && currentBytes + size > SHARD_BUDGET_BYTES) {
      shards.push(current)
      current = []
      currentBytes = 0
    }
    current.push(item)
    currentBytes += size
  }
  if (current.length > 0) shards.push(current)
  return shards
}

function rootRef(userId: string, mode: string, name: ListName) {
  return doc(db, 'users', userId, mode, name)
}

function shardsRef(userId: string, mode: string, name: ListName) {
  return collection(db, 'users', userId, mode, name, 'shards')
}

// 새 판본의 조각을 먼저 전부 쓰고, 성공한 뒤에야 루트 문서(목차)를 갱신한다.
// 중간에 실패하면 루트가 여전히 옛 판본을 가리키므로 원격 데이터가 깨지지 않는다
async function writeList<T>(userId: string, mode: string, name: ListName, list: T[]) {
  const shards = shardList(list)
  const version = Date.now().toString(36)
  syncLog(
    `조각 분할 ${name}:`,
    `${list.length}개 항목 → 조각 ${shards.length}개`,
    `(전체 ${(byteLength(list) / 1024).toFixed(0)}KB,`,
    `가장 큰 조각 ${(Math.max(0, ...shards.map(byteLength)) / 1024).toFixed(0)}KB)`
  )

  for (let i = 0; i < shards.length; i++) {
    await setDoc(doc(shardsRef(userId, mode, name), `${version}_${i}`), { list: shards[i] })
    syncLog(`업로드 ${name} 조각 ${i + 1}/${shards.length} 완료`)
  }
  await setDoc(rootRef(userId, mode, name), {
    sharded: true,
    version,
    shardCount: shards.length,
    count: list.length,
  })

  // 옛 판본 조각 정리. 실패해도 루트가 새 판본을 가리키므로 읽기에는 영향이 없다
  const existing = await getDocs(shardsRef(userId, mode, name)).catch(() => null)
  if (existing) {
    await Promise.all(
      existing.docs
        .filter((d) => !d.id.startsWith(`${version}_`))
        .map((d) => deleteDoc(d.ref).catch(() => {}))
    )
  }
}

// 원격에 문서가 없으면 null. 조각이 하나라도 비면 던진다 —
// 반쪽짜리 목록을 돌려주면 호출부가 그걸 로컬에 저장해 데이터를 깎아먹는다
async function readList<T>(userId: string, mode: string, name: ListName): Promise<T[] | null> {
  const snap = await getDoc(rootRef(userId, mode, name))
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data.sharded) return (data.list as T[]) ?? null // 조각 분할 이전의 단일 문서

  const out: T[] = []
  for (let i = 0; i < (data.shardCount as number); i++) {
    const shardSnap = await getDoc(doc(shardsRef(userId, mode, name), `${data.version}_${i}`))
    if (!shardSnap.exists()) {
      throw new Error(`${name} 조각 ${i + 1}/${data.shardCount}을(를) 찾을 수 없습니다`)
    }
    out.push(...((shardSnap.data().list as T[]) ?? []))
  }
  return out
}

// 원격 값으로 로컬을 대체하되, 아직 올리지 못한 로컬 변경이 있으면 절대 지우지 않는다.
// 원격 문서가 없을 때(null)도 마찬가지 — 빈 배열로 덮어쓰면 로컬이 통째로 날아간다
function resolveList<T extends { id: string }>(remote: T[] | null, local: T[], pending: boolean): T[] {
  if (remote === null) return local
  if (!pending) return remote
  // 미동기화 상태에서는 로컬이 원격보다 최신이다. 로컬을 우선하고 원격에만 있는 항목(다른 기기에서 추가)을 덧붙인다
  const localIds = new Set(local.map((x) => x.id))
  return [...local, ...remote.filter((x) => !localIds.has(x.id))]
}

// Firebase에 전체 데이터 업로드 (모드별 경로: users/{userId}/{law|general}/*)
export async function pushToFirebase(userId: string) {
  const mode = getAppMode()
  const quizSession = getSavedSession()
  syncLog('push 시작', { userId, mode, 문제: getQuestions().length, 오답: getWrongNotes().length })

  // 하나가 실패해도 나머지는 계속 시도한다.
  // 순차 await만 쓰면 첫 실패(예전의 questions 한도 초과) 때문에 오답노트까지 영영 안 올라간다
  const errors: unknown[] = []
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      syncLog('❌ 업로드 실패:', e)
      errors.push(e)
    }
  }

  await attempt(() => writeList<Question>(userId, mode, 'questions', getQuestions()))
  await attempt(() => writeList<WrongNote>(userId, mode, 'wrongNotes', getWrongNotes()))
  await attempt(() => writeList<SavedStudySession>(userId, mode, 'studySessions', getSavedStudySessions()))
  // 진행중인 퀴즈도 문제 배열을 통째로 담아 1MiB를 넘길 수 있어 같은 방식으로 나눠 저장한다.
  // 로컬에서 지웠으면 빈 목록을 올려야 다음 pull 때 되살아나지 않는다
  await attempt(() => writeList<SavedSession>(userId, mode, 'quizSession', quizSession ? [quizSession] : []))

  if (errors.length > 0) {
    syncLog(`push 실패 (${errors.length}건) — 미동기화 상태 유지`)
    throw errors[0]
  }
  clearPendingSync()
  syncLog('push 완료 — 동기화됨')
}

// Firebase의 임시저장(studySessions) / 진행중인 퀴즈(quizSession) 문서 삭제
export async function clearFirebaseSessions(userId: string) {
  const mode = getAppMode()
  await writeList<SavedStudySession>(userId, mode, 'studySessions', [])
  await writeList<SavedSession>(userId, mode, 'quizSession', [])
}

// Firebase에서 전체 데이터 불러와서 로컬에 저장 (현재 모드 기준)
export async function pullFromFirebase(userId: string): Promise<{ questions: Question[], wrongNotes: WrongNote[] }> {
  const mode = getAppMode()
  const pending = hasPendingSync()
  syncLog('pull 시작', { userId, mode, 미동기화: pending })

  // 로컬을 건드리기 전에 원격을 모두 읽는다. 중간에 읽기가 실패하면 여기서 던지고
  // 로컬은 손대지 않은 채로 남는다
  const remoteQuestions = await readList<Question>(userId, mode, 'questions')
  const remoteNotes = await readList<WrongNote>(userId, mode, 'wrongNotes')
  const remoteSessions = await readList<SavedStudySession>(userId, mode, 'studySessions')
  const remoteQuiz = await readQuizSession(userId, mode)

  const questions = resolveList(remoteQuestions, getQuestions(), pending)
  const wrongNotes = resolveList(remoteNotes, getWrongNotes(), pending)

  // API 키는 건드리지 않고 보존
  const existingApiKey = getApiKey()
  saveQuestions(questions)
  saveWrongNotes(wrongNotes)
  if (existingApiKey) setApiKey(existingApiKey)

  // 임시저장 세션은 id가 없어 항목 단위 병합 기준이 없다.
  // 올리지 못한 로컬 변경이 있으면 그대로 두고, 로컬이 비었을 때만 원격 값을 받는다
  if (pending) {
    if (getSavedStudySessions().length === 0 && remoteSessions && remoteSessions.length > 0) {
      saveSavedStudySessions(remoteSessions)
    }
  } else if (remoteSessions && remoteSessions.length > 0) {
    saveSavedStudySessions(remoteSessions)
  } else {
    // 원격에 없으면 이전 계정/모드의 잔여 데이터가 보이지 않도록 로컬도 비운다
    clearAllSavedStudySessions()
  }

  if (remoteQuiz?.id) saveSession(remoteQuiz)
  else if (!pending) clearSavedSession()

  // saveQuestions/saveWrongNotes가 플래그를 세웠으므로 pull 이전 상태로 되돌린다.
  // 병합했다면 로컬에만 있는 변경이 그대로 남아 있으니 여전히 '대기 중'이다
  if (pending) markPendingSync()
  else clearPendingSync()
  syncLog('pull 완료', {
    원격: remoteQuestions === null ? '문서 없음' : `${remoteQuestions.length}개`,
    로컬결과: questions.length,
    미동기화: hasPendingSync(),
  })

  return { questions, wrongNotes }
}

// quizSession은 단일 객체지만 저장은 1개짜리 목록으로 한다 (구버전은 단일 문서 형태)
async function readQuizSession(userId: string, mode: string): Promise<SavedSession | null> {
  const snap = await getDoc(rootRef(userId, mode, 'quizSession'))
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data.sharded) return (data as SavedSession).id ? (data as SavedSession) : null
  const list = await readList<SavedSession>(userId, mode, 'quizSession')
  return list?.[0] ?? null
}
