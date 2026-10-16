# 사례형 (case study) — 설계

작성 2026-10-16 · 1단계 = 카드 가져오기(관리자) + 답안·목차 열람(로그인한 누구나)

카드 **내용**은 이 문서에도 저장소에도 두지 않는다(공개 저장소). 관리자가 가져오기 화면으로 Firestore 에 직접 올린다.

## 유형 스위치

- `lib/studyKind.ts` — `'objective' | 'caseStudy' | 'record'`, localStorage `lawpass_study_kind`, 기본 `'objective'`. `'record'` 는 화면이 없어 저장돼 있어도 객관식으로 되돌린다.
- `app-shell.tsx` 헤더 로고 옆 [객관식 | 사례형 | 기록형]. ExamPass(`getAppMode() === 'general'`)에서는 그리지 않고 늘 객관식.
- 객관식이면 기존 nav·main 그대로. 사례형이면 `CaseStudyShell`(탭 `import` 관리자 전용 · `browse` 기본). 동기화·인증·피드백 훅은 유형과 무관하게 돈다.

## 데이터 구조 (schema 1) — `lib/caseStudy/types.ts`

```
Card    { schema:1, id, subject('민법'|'민소'), category, chapter, order:[n,n], title, pages, meta,
          problems: Problem[], notes: string[], source, cases: string[], statutes: string[] }
Problem { id('10d-1#1'), kind('변시'|'모의'), exam(변시 11~15 | 모의 '26.1'), examLabel, qno, sub, points,
          stubFor?:{card,problem}, note?, brief?: string[], question?:{paragraphs, ask},
          answer?:{source, blocks: Block[]} }      // stubFor 가 있으면 brief/question/answer 없음
Block   { t:'h1'|'h2'|'p', lv?:'l2'|'l3', pts?, html }
Index   { schema:1, cards:[{ id, subject, category, chapter, order, title, pages,
          problems:[{ id, kind, exam, qno, sub?, points, stubFor? }] }] }   // _index.json
```

`html` 은 `<mark class="law|case|res">`, `<u>`, `<b>`, `<br>` 만 쓴다. 렌더 전에 `lib/caseStudy/sanitize.ts`(DOMParser 화이트리스트)를 반드시 거친다 — 그 밖의 태그는 벗기고, script 류는 내용째 버린다.

## Firestore

```
users/{ADMIN_UID}/{mode}/caseStudy              색인 문서 (schema, cards 배열)
users/{ADMIN_UID}/{mode}/caseStudy/cards/{id}   카드 문서
```

- `mode` 는 questions 와 같은 `getAppMode()` 값.
- 규칙: questions 읽기 블록과 같은 모양의 블록 하나만 추가 — `match /users/1Mt7…/{mode}/caseStudy/{document=**} { allow read: if request.auth != null; }`. 쓰기 규칙은 없다(기존 본인 규칙으로 관리자가 쓴다). **규칙을 배포하기 전에는 읽기가 거부**되고, 화면은 "Firestore 규칙 배포 필요"를 띄운다.
- 카드는 조각으로 나누지 않는다. 문서 하나가 900KB 를 넘으면 저장 전에 막는다(`lib/firebaseServices/caseStudy.ts`).
- 가져오기 순서: 카드 문서 전부 → 색인 문서. 같은 id 는 덮어쓴다. 색인이 가리키는데 원격에 없는 카드 id 는 경고.

## 2단계 계획 (이번에 만들지 않음)

1. **풀기** — 문항을 골라 직접 답안을 쓴다 → 제출 후 모범답안 공개 → 목차(h1/h2) 항목별 배점(`pts`)으로 자기채점.
2. **오답노트** — 자기채점에서 놓친 목차 항목을 문항 id(`Problem.id`) 키로 모은다. 기록은 사용자 본인 트리(`users/{uid}/{mode}/…`)에 둔다 — 관리자 카드 트리에는 쓰지 않는다.
3. **D-1 목차** — 놓친 문항의 h1/h2 목차만 뽑아 시험 전날 훑어보는 화면.

문항 id 는 카드 사이에서 유일하고 바뀌지 않는다는 전제로 2단계의 키가 된다. 가져오기에서 id 를 바꾸면 기록이 끊긴다.
