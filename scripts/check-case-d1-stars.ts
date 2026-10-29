/**
 * 사례형 D-1 암기장 '전날 볼 것' 찜 저장소(lib/caseStudy/d1Stars) 검증 (check:case-d1-stars). 가짜 backend, Firestore 없음
 */
import assert from 'node:assert/strict'
import { createStarStore, type CaseStar, type StarBackend } from '../lib/caseStudy/d1Stars'

// 가짜 Firestore: 문항 id → 문서
const docs = new Map<string, CaseStar>()
let fail = false
let calls = 0
const backend: StarBackend = {
  list: async () => {
    calls++
    if (fail) throw new Error('offline')
    return [...docs.values()]
  },
  put: async (s) => {
    if (fail) throw new Error('offline')
    docs.set(s.problemId, s)
  },
  remove: async (id) => {
    if (fail) throw new Error('offline')
    docs.delete(id)
  },
}

;(async () => {
  docs.set('민사-1#1', { problemId: '민사-1#1', cardId: '민사-1', starredAt: 1 })
  const store = createStarStore(backend)
  let notified = 0
  const off = store.subscribe(() => notified++)

  // 불러오기 — 두 탭이 동시에 불러도 한 번만 읽고 둘 다 true
  const [a, b] = await Promise.all([store.load(), store.load()])
  assert.ok(a && b)
  assert.equal(calls, 1)
  assert.equal(store.status, 'ready')
  assert.ok(store.has('민사-1#1'))
  assert.equal(await store.load(), true)
  assert.equal(calls, 1, '이미 읽었으면 다시 읽지 않는다')

  // 찜 → 저장소 문서 생김
  assert.equal(await store.toggle('형사-1#2', '형사-1', 50), true)
  assert.ok(store.has('형사-1#2'))
  assert.deepEqual(docs.get('형사-1#2'), { problemId: '형사-1#2', cardId: '형사-1', starredAt: 50 })
  // 해제 → 문서 지워짐
  assert.equal(await store.toggle('민사-1#1', '민사-1'), true)
  assert.ok(!store.has('민사-1#1'))
  assert.ok(!docs.has('민사-1#1'))
  assert.ok(notified > 0)

  // 저장 실패: 화면을 되돌리고 false
  fail = true
  assert.equal(await store.toggle('상법-1#1', '상법-1'), false)
  assert.ok(!store.has('상법-1#1'), '찜 실패 → 원래대로(찜 안 됨)')
  assert.equal(await store.toggle('형사-1#2', '형사-1'), false)
  assert.ok(store.has('형사-1#2'), '해제 실패 → 원래대로(찜 유지)')
  assert.equal(store.all().find((s) => s.problemId === '형사-1#2')!.starredAt, 50, '되돌릴 때 찜한 시각도 그대로')

  // 다시 불러오기 실패 → status error, false
  assert.equal(await store.load(true), false)
  assert.equal(store.status, 'error')
  fail = false
  assert.equal(await store.load(true), true)
  assert.deepEqual(store.all().map((s) => s.problemId), ['형사-1#2'], '불러오면 저장된 것과 같다')

  off()
  console.log('check:case-d1-stars 통과')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
