import { auth, db } from '@/lib/firebase'
import { collection, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { getAppMode } from '@/lib/appMode'
import type { QuestionImage } from '@/lib/types'

/**
 * 문제에 붙인 도면 이미지의 원격 저장소.
 *
 * ★ 동기화 큐(sync.ts)와 완전히 분리한다. 문제 목록은 조각(shard)으로 나뉘어 push 때마다
 * 통째로 오르내리는데, 장당 수백 KB인 이미지를 거기 태우면 그 왕복이 통째로 무거워지고
 * 1MiB 한도에도 훨씬 빨리 닿는다. 그래서 이미지는:
 *  - 붙이는 순간 문서 하나로 따로 올리고 (writeList 를 타지 않는다)
 *  - 앱을 열 때 전부 받지 않는다. 문제 상세를 펼칠 때 그 문제 것만 읽는다
 *
 * 문제 쪽에는 ID 목록(Question.images)만 남는다 — 그것은 작아서 기존 큐에 실려도 된다.
 *
 * 경로: users/{uid}/{law|general}/questionImages/items/{imageId}
 *
 * questions·wrongNotes 와 같은 자리(모드 컬렉션 아래)에 두되, 그 자리는 '문서'만 올 수 있어
 * questionImages 문서 아래 items 하위 컬렉션을 둔다 — questions 가 조각을
 * questions/shards/{id} 에 두는 것과 같은 모양이다
 */

const ITEMS = 'items'

function uid(): string {
  const user = auth.currentUser
  if (!user) throw new Error('로그인이 필요합니다')
  return user.uid
}

function itemsRef(userId: string, mode: string) {
  return collection(db, 'users', userId, mode, 'questionImages', ITEMS)
}

/** 아직 저장하지 않은 새 이미지의 ID. 문서를 만들기 전에 ID 가 필요해 따로 연다 */
export function newQuestionImageId(): string {
  return doc(itemsRef(uid(), getAppMode())).id
}

export async function saveQuestionImage(image: QuestionImage): Promise<void> {
  await setDoc(doc(itemsRef(uid(), getAppMode()), image.id), image)
}

/**
 * 주어진 ID 의 이미지를 읽는다. **필요한 문서만** 읽는다 (컬렉션 전체 조회가 아니다).
 *
 * 없는 ID 는 조용히 건너뛴다 — 다른 기기에서 지웠거나 올리다 끊긴 경우이고,
 * 그것 때문에 상세 화면이 통째로 비면 나머지 이미지까지 못 본다.
 * 돌려주는 순서는 넘긴 ID 순서 그대로다 (Question.images 의 순서 = 표시 순서)
 */
export async function fetchQuestionImages(ids: string[]): Promise<QuestionImage[]> {
  if (ids.length === 0) return []
  const userId = uid()
  const mode = getAppMode()
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(itemsRef(userId, mode), id)).catch(() => null)))
  return snaps
    .filter((s): s is NonNullable<typeof s> => !!s && s.exists())
    .map((s) => s.data() as QuestionImage)
}

export async function deleteQuestionImage(id: string): Promise<void> {
  await deleteDoc(doc(itemsRef(uid(), getAppMode()), id))
}
