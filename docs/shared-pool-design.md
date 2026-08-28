# 문제집 단위 공유 (공용 문제 풀 접근 권한) — 설계안

작성 2026-08-28 · 규칙 원문 반영 후 확정판 · **설계 문서. 구현·규칙 배포 없음**

---

## 0. 현재 규칙 원문과의 대조 결과

콘솔 원문을 받아 초안의 역추정과 대조했다. **결론: 설계의 뼈대는 그대로 유효하고, 한 곳만 고쳤다.**

### 현재 규칙 (원문)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /feedback/{docId} {
      allow create: if request.auth != null;
      allow read: if request.auth != null &&
        (request.auth.uid == '1Mt7tpI4n2gCn71O6qE1EP2Fns03' ||
         resource.data.userId == request.auth.uid);
      allow update: if request.auth != null &&
        (request.auth.uid == '1Mt7tpI4n2gCn71O6qE1EP2Fns03' ||
         (resource.data.userId == request.auth.uid &&
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['replyReadByUser'])));
      allow delete: if request.auth != null &&
        request.auth.uid == '1Mt7tpI4n2gCn71O6qE1EP2Fns03';
    }

  }
}
```

### 대조표

| 초안의 역추정 | 실제 | 판정 |
|---|---|---|
| `users/{userId}/**` 는 본인만 | `match /users/{userId}/{document=**}` — 재귀 와일드카드로 **조각 서브컬렉션까지 전부** 덮음 | ✅ 일치 |
| 캐치올(`match /{document=**}`) 유무 확인 필요 | **없음.** `users`·`feedback` 두 블록이 전부 | ✅ 위험 해소 |
| 관리자 판정을 **이메일**로 할 가능성 | **uid 하드코딩** (`'1Mt7tpI4n2gCn71O6qE1EP2Fns03'`) | ❌ **역추정이 틀림** — 아래 참조 |

### 틀렸던 한 곳과 그 영향

초안은 `feedback` 규칙의 관리자 판정을 `ADMIN_EMAIL` 기반으로 추정했다. 실제로는 **uid 하드코딩**이다. 다행히 초안이 이미 `pools/` 규칙에 uid 하드코딩을 권장하고 있었으므로 **설계 변경은 없고, 근거만 바뀐다** — "그게 더 안전해서"가 아니라 **"기존 규칙이 이미 그 방식이라 일관성을 지키는 것"** 이 된다. `lib/admin.ts`의 `ADMIN_EMAIL`은 앞으로도 **화면 표시·UI 게이팅 전용**이고, 보안 판정은 규칙의 uid가 담당한다.

### 원문에서 새로 확인한 것 세 가지 (설계에 반영)

1. **`rules_version = '2'`** — `diff()`, `affectedKeys()`, `hasOnly()`, 재귀 와일드카드, `in` 연산자를 모두 쓸 수 있다. §2의 추가 규칙이 그대로 성립한다.
2. **선언되지 않은 최상위 컬렉션은 기본 거부** — 지금 `pools/`, `userDirectory/`는 **읽기도 쓰기도 전부 막혀 있다.** 따라서 클라이언트 코드와 규칙을 **같은 단계에서 함께** 배포해야 한다 (§7에 반영).
3. **필드 제한 관용구가 이미 있다** — `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`. `userDirectory` 규칙에 같은 관용구를 쓰면 코드베이스의 기존 방식과 맞는다 (§2.1).

---

## 1. 데이터 모델

### 1.1 결론 요약

- 공유 문제집은 **`users` 트리 밖의 별도 최상위 컬렉션 `pools/`** 에 둔다.
- 저장 형식은 **기존 조각(shard) 구조를 그대로 재사용**한다 (`sync.ts`의 `writeList`/`readList`).
- 이메일→uid 대응을 위해 **`userDirectory/{uid}`** 문서를 로그인 시 남긴다.
- 발행하는 문제 사본에는 **`poolId`를 심는다** (§4.3에서 확정).

`users` 트리 안에 확장하지 않는 이유가 원문 확인으로 더 분명해졌다. `match /users/{userId}/{document=**}`는 **재귀 와일드카드**라 그 아래 어디든 덮는다. 여기에 공유 예외를 넣으려면 이 한 줄에 조건을 붙이거나 더 깊은 경로에 다른 match를 겹쳐야 하는데, 둘 다 **개인 데이터 전체를 지키는 유일한 규칙을 건드리는 일**이다. 공유물을 트리 밖에 두면 이 줄은 손대지 않는다.

### 1.2 컬렉션 구조

```
pools/{poolId}
  ownerUid:    "1Mt7tpI4n2gCn71O6qE1EP2Fns03"   // 혜민
  title:       "2026 유니온 6모"                  // 화면 표시용
  sourceFile:  "유니온 6모객"                     // 원본 sourceFile (출처 추적용)
  mode:        "law" | "general"
  memberUids:  ["uid1", "uid2", ...]             // 권한 목록. 규칙이 이걸 본다
  version:     "mtb2evds"                        // 조각 판본 (writeList와 같은 형식)
  shardCount:  6
  count:       244
  publishedAt: 1756...

pools/{poolId}/shards/{version}_{i}
  list: Question[]                               // 각 문항에 poolId가 심겨 있다

userDirectory/{uid}
  email:       "someone@example.com"
  displayName: "..."
  updatedAt:   1756...
```

`poolId`는 `addDoc` 자동 id를 쓴다 (파일명을 id로 쓰면 한글·공백·중복 문제가 따라온다).

### 1.3 왜 조각 구조를 재사용하는가

`writeList`/`readList`는 이미 다음을 해결해 두었다.

- Firestore 문서 1MiB 한도 (문항당 5~10KB → 244문항은 단일 문서로 불가능)
- 조각을 전부 쓴 뒤에 루트를 갱신하는 순서 (중간 실패 시 옛 판본이 남음)
- 정리 범위를 **직전 판본으로 좁힌** 규칙 (커밋 `7818fc2`)

경로만 바꿔 재사용한다. 두 함수는 현재 `ListName` 타입으로 경로가 고정돼 있으므로 **경로를 인자로 받도록 일반화하는 작은 리팩터링**이 필요하다 (기존 호출부 동작은 그대로).

### 1.4 `userDirectory` — 이메일→uid 대응

지금은 이메일로 uid를 찾을 방법이 없다. 유일한 대응표가 `feedback` 문서의 `userId`+`userEmail`인데, 피드백을 보낸 적 있는 사람만 남는다.

- 쓰기 시점: 로그인 직후 1회 (`app-shell`의 `loadFromFirebase` 근처 또는 `auth-gate`)
- 쓰는 주체: 본인만
- 읽는 주체: 관리자(uid)만 — 이메일 목록은 개인정보다
- 최상위 컬렉션인 이유: `users/{uid}/meta/profile` 형태면 이메일 검색에 collection group 쿼리가 필요하고, 그러면 collection group 규칙·인덱스가 따라붙는다. 최상위면 `where('email','==',…)` 한 번으로 끝난다.

한 번도 로그인한 적 없는 사람은 uid가 없다 → 관리자 화면에 "그 사용자가 먼저 한 번 로그인해야 합니다"로 안내한다.

---

## 2. Firestore 보안 규칙 변경안

**기존 `users`·`feedback` 블록은 한 줄도 건드리지 않는다. 아래 두 블록을 추가만 한다.**

### 2.1 추가할 규칙

```javascript
// 관리자 판정은 uid로 한다 — feedback 규칙이 이미 같은 uid를 하드코딩하고 있어
// 그 방식을 그대로 따른다. lib/admin.ts의 ADMIN_EMAIL은 화면 게이팅 전용이며
// 보안 판정에는 쓰지 않는다
function isPoolOwner() {
  return request.auth != null
      && request.auth.uid == '1Mt7tpI4n2gCn71O6qE1EP2Fns03';
}

match /pools/{poolId} {
  // 소유자와 명단에 든 사람만 읽는다
  allow read: if isPoolOwner()
              || (request.auth != null
                  && request.auth.uid in resource.data.memberUids);
  // 발행·명단 수정은 소유자만
  allow write: if isPoolOwner();

  match /shards/{shardId} {
    allow read: if isPoolOwner()
                || (request.auth != null
                    && request.auth.uid in
                       get(/databases/$(database)/documents/pools/$(poolId)).data.memberUids);
    allow write: if isPoolOwner();     // ★ 멤버에게 쓰기를 주면 원본이 오염된다
  }
}

match /userDirectory/{uid} {
  // 본인만 자기 항목을 쓴다. 필드를 제한해 임의 데이터 적재를 막는다
  // (feedback의 diff().affectedKeys().hasOnly([...]) 와 같은 관용구)
  allow create: if request.auth != null
                && request.auth.uid == uid
                && request.resource.data.keys().hasOnly(['email', 'displayName', 'updatedAt']);
  allow update: if request.auth != null
                && request.auth.uid == uid
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(['email', 'displayName', 'updatedAt']);
  // 조회는 관리자와 본인만 (이메일 수집 방지)
  allow read: if isPoolOwner() || (request.auth != null && request.auth.uid == uid);
  allow delete: if false;
}
```

### 2.2 목록 조회(list)가 규칙을 통과하는 이유 — 확인해 둘 것

Firestore는 `list` 요청에서 **반환되는 문서 하나라도 read 규칙을 통과하지 못하면 쿼리 전체를 거부**한다. 이 설계의 두 쿼리는 모두 안전하다.

| 쿼리 | 주체 | 통과 이유 |
|---|---|---|
| `where('memberUids','array-contains', myUid)` | 멤버 | 반환되는 문서는 정의상 내 uid를 포함 → 전부 read 통과 |
| `where('ownerUid','==', adminUid)` | 관리자 | `isPoolOwner()`가 참이라 무조건 통과 |
| `where('email','==', x)` on `userDirectory` | 관리자 | 〃 |

관리자가 아닌 사용자가 `userDirectory`나 `pools`를 조건 없이 훑으면 **쿼리 전체가 거부**된다 (기존 `getAllFeedback`이 관리자에게만 동작하는 것과 같은 구조).

### 2.3 설계상 짚어둘 점

- **`get()` 비용**: 조각을 읽을 때마다 규칙이 pool 루트를 1회 읽는다. 6조각이면 읽기 6회 추가. 없애려면 조각마다 `memberUids`를 복제해야 하는데 그러면 권한 부여마다 조각 전부를 다시 써야 한다. **`get()` 유지 권장.**
- **`in` 연산자**: `memberUids`가 수백 개가 되면 규칙 평가가 느려지고 문서도 커진다. 지금 규모(소수 지인)에서는 문제없다. 커지면 `pools/{poolId}/members/{uid}` 하위 문서 + `exists()` 방식으로 바꾼다.
- **멤버는 절대 쓰기 금지**: 멤버가 조각에 쓸 수 있으면 원본이 오염되고 전 멤버에게 전파된다.

---

## 3. 클라이언트 동기화 영향 (가장 위험한 부분)

### 3.1 문제의 뿌리

```ts
// lib/firebaseServices/sync.ts:190
await attempt(() => writeList<Question>(userId, mode, 'questions', getQuestions()))
```

push는 **`getQuestions()` 전체를 통째로** 자기 트리에 올린다. 공유받은 문제를 `lawpass_questions_{mode}`에 섞으면, 받은 사람의 다음 push가 **혜민의 문제 244개를 자기 계정에 복제해 올린다.** 그 뒤로는 내 것과 남의 것을 구분할 수 없고 회수도 불가능해진다.

### 3.2 해결 — 저장소를 분리한다

**공유 문제는 `getQuestions()`가 보는 배열에 절대 넣지 않는다.**

```
localStorage
  lawpass_questions_{mode}        ← 내 문제.   push/pull 대상 (지금 그대로)
  lawpass_pool_questions_{mode}   ← 공유 문제. 읽기 전용 캐시. push 대상 아님 (신규)
```

- `addQuestions`·`saveQuestions`·`getQuestions`는 **한 줄도 바뀌지 않는다.**
- 따라서 `pushToFirebase`도 바뀌지 않는다. 공유 문제는 애초에 그 함수의 시야에 없다.
- `store.ts`에 `getPoolQuestions()` / `savePoolQuestions()`를 추가한다.

부수 효과로 **PDF 탭이 자동으로 안전해진다.** `pdf-tab.tsx`는 `getQuestions()`를 직접 부르므로(`:349`의 검토 필터, `getSourceFiles`), 공유 문제집은 업로드 목록·검토 화면·재파싱 대상에 나타나지 않는다. 남의 문제집을 실수로 지우거나 재파싱하는 일이 구조적으로 막힌다.

### 3.3 화면에는 합쳐서 보여준다

```
app-shell.tsx
  questions      = getQuestions()                     // 내 것
  poolQuestions  = getPoolQuestions()                 // 공유받은 것 (poolId가 붙어 있음)
  allQuestions   = [...questions, ...poolQuestions]   // 탭에 넘기는 값
```

| 탭 | 지금 받는 값 | 바뀔 값 | 비고 |
|---|---|---|---|
| CBT 실전 | `questions` | `allQuestions` | 공유 문제로 시험 가능 |
| 선학습 | `questions` | `allQuestions` | 〃 |
| 오답노트·암기장 | `notes` | 그대로 | 노트가 문제 사본을 들고 있어 영향 없음 |
| PDF 분석 | (내부에서 `getQuestions()`) | 그대로 | 공유 문제집은 안 보임 (의도) |

id 충돌 대비: 공유 문제의 `id`는 혜민 계정에서 만들어진 값이라 이론상 겹칠 수 있다(`{과목}_{시험}_{연도}_{번호}_{Date.now()}` 형식이라 실제 확률은 매우 낮다). 합칠 때 **내 것 우선으로 중복 id를 제거**한다.

### 3.4 pull 경로

`pullFromFirebase`(내 데이터)는 **그대로 둔다.** 공유 데이터는 별도 함수로 읽는다.

```
pullPools(uid):
  1. where('memberUids','array-contains', uid) 로 pool 목록 조회
  2. 각 pool 의 조각을 readList 형식으로 읽어 합침
  3. lawpass_pool_questions_{mode} 에 저장 (내 데이터는 건드리지 않음)
```

- **`enqueue`(쓰기 직렬화)에 함께 태운다.** 다만 관리자와 멤버는 **다른 브라우저**라 큐로는 못 막는다. 관리자가 재발행하는 도중 멤버가 읽으면 조각이 정리돼 사라지는 경합이 생길 수 있다 (`users` 트리에서 겪었던 `571de2d`와 같은 형태). 그래서 조각이 없으면 **루트를 다시 읽고 1회 재시도**하는 처리를 `pullPools`에 넣는다. 정리 범위가 직전 판본으로 좁혀져 있으므로 재시도하면 새 판본을 읽게 된다.
- 권한이 끊겼으면 조회 결과에서 그 pool이 빠진다 → 로컬 캐시에서도 지운다 (§4.2).

---

## 4. 권한 부여·회수 시 데이터 변화

### 4.1 부여

| 단계 | 주체 | 무엇이 생기나 |
|---|---|---|
| 1 | 관리자 | 문제집 발행 — `getQuestions().filter(q => q.sourceFile === '유니온 6모객')`에 **`poolId`를 심어** 조각으로 나눠 `pools/{poolId}/shards/*`에 쓰고 루트 문서 생성 (`memberUids: []`) |
| 2 | 관리자 | 이메일 입력 → `userDirectory`에서 `where('email','==',…)`로 uid 조회 |
| 3 | 관리자 | 없으면 "먼저 한 번 로그인해야 합니다" 안내하고 중단 |
| 4 | 관리자 | `updateDoc(pools/{poolId}, { memberUids: arrayUnion(uid) })` |
| 5 | 받은 사람 | 다음 실행 시 `pullPools`가 그 pool을 읽어 `lawpass_pool_questions_{mode}`에 저장 |
| 6 | 받은 사람 | CBT·선학습 목록에 그 문제집이 나타남 |

`poolId`는 **발행할 때 사본에만** 심는다. 혜민 자신의 `lawpass_questions_{mode}`와 개인 트리는 손대지 않는다.

받은 사람의 **개인 트리(`users/{uid}/…`)에는 아무것도 쓰이지 않는다.** 이게 회수를 가능하게 하는 핵심이다.

### 4.2 회수

| 단계 | 무엇이 일어나나 |
|---|---|
| 1 | 관리자: `arrayRemove(uid)` |
| 2 | **즉시** 규칙이 그 uid의 pool 읽기를 거부 (다음 요청부터) |
| 3 | 받은 사람의 다음 `pullPools`: 그 pool이 결과에서 빠짐 → 로컬 캐시에서 삭제 |
| 4 | CBT·선학습 목록에서 사라짐 |

### 4.3 회수해도 남는 것 — **결정: 남긴다. 단 `poolId`로 표시해 둔다**

받은 사람의 학습 기록은 **문제 사본을 통째로** 들고 있다.

```
WrongNote.question             : Question      (types.ts:145)
SavedSession.questions         : Question[]    (store.ts:590)
SavedStudySession.allQuestions : Question[]    (store.ts:615)
```

**확정된 정책**

1. 회수해도 이 기록들은 **지우지 않는다.** 요구사항이 "오답 기록은 받은 사용자 소유"이고, 회수를 이유로 삭제하면 그 사람의 학습 이력이 통째로 날아간다.
2. 대신 발행 시 각 문항에 **`poolId`를 심어 두어**, 그 사본을 물려받은 노트·세션에도 출처 표시가 남게 한다.
3. 그 결과 **나중에 정책을 바꿀 수 있다** — 예: "회수된 문제집에서 온 오답노트 정리" 버튼, 특정 pool 유래 기록만 골라내기, 통계에서 제외 등. `poolId`가 없으면 이 선택지 자체가 사라진다.

**타입 변경**: `Question`에 `poolId?: string` optional 필드 하나. 내 문제에는 붙지 않으므로 기존 데이터·화면·병합 로직에 영향이 없다 (`pageFrom`/`pageTo`를 더했을 때와 같은 순수 추가).

**받아들이는 결과**: 회수 뒤에도 오답노트에 남은 문제는 계속 보인다. 새로 풀 수는 없지만 이미 틀린 문제의 내용은 남는다. 이는 의도된 절충이며, 완전 차단이 필요해지면 `poolId`를 근거로 정리 기능을 추가하면 된다.

---

## 5. 0단계 — `firestore.rules` 버전 관리 시작

**이것을 첫 단계로 한다.** 규칙을 바꾸는 작업인데 현재 규칙이 콘솔에만 있으면 리뷰도 롤백도 불가능하다.

### 5.1 파일 배치

```
firestore.rules          ← 위 §0의 원문을 그대로 최초 커밋 (수정 없이)
firebase.json            ← { "firestore": { "rules": "firestore.rules" } }
.firebaserc              ← { "projects": { "default": "<프로젝트 id>" } }
```

`firestore.indexes.json`은 지금 필요 없다. 이 설계의 쿼리(`array-contains` 단일 필드, `==` 단일 필드)는 모두 **자동 단일 필드 인덱스**로 처리된다. `.firebaserc`는 프로젝트 id만 담으므로 커밋해도 무방하다. **서비스 계정 키는 필요 없고, 커밋해서도 안 된다** (이 설계는 Admin SDK를 쓰지 않는다).

### 5.2 package.json 스크립트

```json
"rules:deploy": "firebase deploy --only firestore:rules",
"rules:test":   "firebase emulators:exec --only firestore \"node scripts/rulesCheck.mjs\""
```

`firebase-tools`는 전역 설치 대신 `npx firebase`로 써도 된다. 배포에는 로그인이 필요하므로(`npx firebase login`) 혜민이 직접 실행한다.

### 5.3 최초 커밋 순서 (중요)

1. **§0의 원문을 그대로** `firestore.rules`에 넣고 커밋 — 내용을 고치지 않는다
2. 배포해서 **아무 변화도 없음을 확인** (`rules:deploy` → 앱이 그대로 동작, 특히 피드백 읽기/답글 확인)
3. 그 다음에야 §2의 블록을 추가한다

2단계를 건너뛰면, 파일이 콘솔 원문과 조금이라도 다를 경우 첫 배포가 **기존 규칙을 통째로 덮어쓴다.** 원문을 이미 확보했으므로 이 위험은 "그대로 복사했는지"만 확인하면 된다.

### 5.4 규칙 테스트 (권장)

`@firebase/rules-unit-testing` + 에뮬레이터로 다음 6개만 확인해도 사고의 대부분을 막는다.

- 멤버가 아닌 사용자가 `pools/{id}` 읽기 → **거부**
- 멤버가 `pools/{id}/shards/*` 읽기 → 허용, **쓰기 → 거부**
- 관리자가 아닌 사용자가 `memberUids` 수정 → **거부**
- 아무나 `userDirectory`를 조건 없이 훑기 → **거부**
- 남의 `userDirectory` 문서 쓰기 → **거부**
- **기존 회귀**: 본인 `users/{uid}` 읽기·쓰기 허용, 남의 것 거부 / 피드백 `replyReadByUser`만 수정 허용

마지막 줄이 중요하다. 새 블록을 추가하다 기존 두 블록을 건드리지 않았는지 확인하는 유일한 자동 수단이다.

---

## 6. 리스크

### 6.1 규칙 실수로 남의 데이터가 열리는 종류 (최우선)

| 위험 | 어떻게 터지나 | 방어 | 원문 확인 후 상태 |
|---|---|---|---|
| **기존 규칙 통째 덮어쓰기** | 콘솔 원문과 다른 파일을 첫 배포 | §5.3의 "원문 그대로 → 무변화 확인" | 원문 확보로 위험 낮아짐 |
| **캐치올 규칙과의 충돌** | `match /{document=**}`가 있으면 추가 블록보다 먼저 열림 | — | ✅ **해소** (캐치올 없음) |
| `allow read: if true` 류 오타 | 공유 문제집이 인터넷 전체에 공개 | 에뮬레이터 테스트 (§5.4) | 상존 |
| **멤버에게 쓰기 허용** | 원본 오염 → 전 멤버에게 전파 | `shards` 쓰기는 `isPoolOwner()`만 | 상존 |
| **`userDirectory` 전체 공개** | 가입자 이메일 수집 | 읽기를 관리자+본인으로 제한 | 상존 |
| 관리자 판정 방식 불일치 | 이메일 기반으로 쓰면 계정 이메일 변경 시 권한 상실 | uid 하드코딩 (기존 `feedback` 규칙과 동일) | ✅ 방식 확정 |
| **규칙 없이 코드만 배포** | `pools`·`userDirectory`가 기본 거부라 조용히 실패 | 코드와 규칙을 같은 단계에서 배포 (§7) | 신규 확인 |

### 6.2 클라이언트 쪽

| 위험 | 결과 | 방어 |
|---|---|---|
| **공유 문제가 `getQuestions()`에 섞임** | 받은 사람의 push가 혜민 문제 244개를 자기 트리에 복제. 회수 불가 | 저장소 분리 (§3.2) + **push 결과에 `poolId` 있는 문항이 없다는 회귀 테스트** |
| 관리자가 재발행하는 중 멤버가 읽음 | "조각을 찾을 수 없습니다" 오류 | 루트 재조회 후 1회 재시도 (§3.4) |
| 회수 후에도 노트에 내용이 남음 | 완전 차단이 아님 | 정책으로 확정 (§4.3), `poolId`로 여지 확보 |
| 관리자·멤버가 같은 문제집을 각자 보유 | 중복 표시 | 합칠 때 내 것 우선으로 id 중복 제거 (§3.3) |
| 발행 시점 스냅샷 | 이후 혜민이 문제를 고쳐도 멤버에겐 반영 안 됨 | 재발행 버튼 (새 판본 발행) |

`poolId`를 심기로 한 덕분에 첫 줄의 회귀 테스트가 **간단하고 확실해진다** — "push 페이로드에 `poolId` 필드를 가진 문항이 하나라도 있으면 실패"로 검사할 수 있다.

### 6.3 운영·법적

- 문제집 원문은 **시중 문제집의 저작물**이다. 공유 범위가 넓어질수록 저작권 위험이 커진다. 소수 지인 대상이라는 전제를 유지한다.
- `userDirectory`는 개인정보(이메일)를 담는다. 읽기를 관리자·본인으로 제한하는 것이 최소 조치다.

---

## 7. 단계별 진행 제안

**선언되지 않은 컬렉션은 기본 거부이므로, 각 단계에서 코드와 규칙을 함께 배포한다.**

| 단계 | 내용 | 규칙 변경 | 독립 배포 |
|---|---|---|---|
| **0** | `firestore.rules`·`firebase.json`·`.firebaserc` 반입 → **무변화** 배포 확인 | 없음 (원문 그대로) | ✅ |
| **1** | `Question.poolId?` 추가 + `userDirectory` 기록(로그인 시) | `userDirectory` 블록 추가 | ✅ 화면 변화 없음 |
| **2** | `writeList`/`readList` 경로 일반화 (golden diff로 무변화 확인) | 없음 | ✅ |
| **3** | 관리자 발행 UI (설정 모달의 관리자 영역, `AdminFeedbackPanel` 옆) + `pools` 쓰기 | `pools` 블록 추가 | ✅ 멤버 0명이면 영향 없음 |
| **4** | 멤버 쪽 `pullPools` + 로컬 분리 저장 + 탭에 합쳐 넘기기 + push 회귀 테스트 | 없음 | ✅ |
| **5** | 회수 UI·정책 문구 | 없음 | ✅ |

3단계까지는 **멤버가 한 명도 없으므로 기존 사용자에게 아무 변화가 없다.**

---

## 남은 확인 사항

1. Firebase **프로젝트 id** (`.firebaserc`에 넣을 값)
2. §6.3의 공유 범위 전제 — 소수 지인 대상으로 유지하는 것이 맞는지
3. 0단계 착수 여부

`firestore.rules` 원문과 §4.3 결정(`poolId` 남기기)은 반영 완료. 나머지 설계(pools 컬렉션 분리, `lawpass_pool_questions_{mode}` 로컬 분리, 0단계 규칙 반입 순서)는 초안 그대로 유지했다.
