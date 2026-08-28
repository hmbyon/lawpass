import { db } from '@/lib/firebase'
import { doc, setDoc } from 'firebase/firestore'

/**
 * 이메일 → uid 대응표.
 *
 * 관리자가 "이 이메일에 문제집 권한을 준다"고 할 때 uid를 찾을 유일한 수단이다.
 * 지금은 대응표가 어디에도 없다 — feedback 문서에 userId·userEmail이 함께 남지만
 * 피드백을 보낸 적 있는 사람만 걸린다.
 *
 * users 트리 밖 최상위 컬렉션에 두는 이유는 설계 문서 §1.4에 있다:
 * users/{uid}/meta/profile 형태였다면 이메일 검색에 collection group 쿼리가 필요하고
 * 그러면 collection group 규칙과 인덱스가 따라붙는다. 최상위면 where('email','==',…) 한 번이면 된다.
 *
 * 필드는 email·displayName·updatedAt 셋뿐이다. firestore.rules의 hasOnly(...)와
 * 정확히 같아야 하며, 여기서 하나라도 늘리면 그 순간 모든 쓰기가 거부된다.
 */
const COLLECTION = 'userDirectory'

// 한 번 기록했으면 이 세션에서는 다시 쓰지 않는다 (로그인 1회당 쓰기 1회)
const recorded = new Set<string>()

export async function recordUserDirectory(user: {
  uid: string
  email: string | null
  displayName?: string | null
}): Promise<void> {
  // 이메일이 없는 계정은 대응표에 넣을 것이 없다
  if (!user.email) return
  if (recorded.has(user.uid)) return
  recorded.add(user.uid)

  try {
    await setDoc(doc(db, COLLECTION, user.uid), {
      email: user.email,
      displayName: user.displayName ?? null,
      updatedAt: Date.now(),
    })
    console.log('[userDirectory] 기록 완료', user.uid)
  } catch (e) {
    // 규칙이 아직 배포되지 않았으면 여기서 거부된다. 로그인·동기화와 무관한 부가 기록이므로
    // 실패해도 앱 흐름을 막지 않고, 다음 실행에서 다시 시도할 수 있게 표시만 되돌린다
    recorded.delete(user.uid)
    console.warn('[userDirectory] 기록 실패 — firestore.rules의 userDirectory 규칙이 배포됐는지 확인하세요', e)
  }
}
