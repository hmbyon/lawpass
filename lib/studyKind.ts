/**
 * 문제 유형 스위치(객관식 / 사례형 / 기록형). 이 브라우저에만 남는 화면 선택이다 —
 * 계정을 따라다니지 않고 동기화하지도 않는다 (appMode 와 같은 방식).
 *
 * 'record'(기록형)는 아직 화면이 없다. 저장돼 있어도 객관식으로 되돌린다 —
 * 아니면 빈 화면에 갇혀 스위치로만 빠져나올 수 있다
 */
export type StudyKind = 'objective' | 'caseStudy' | 'record'

const KEY = 'lawpass_study_kind'

export function getStudyKind(): StudyKind {
  // 사생활 보호 모드·SSR 에서는 localStorage 접근 자체가 던질 수 있다
  try {
    return localStorage.getItem(KEY) === 'caseStudy' ? 'caseStudy' : 'objective'
  } catch {
    return 'objective'
  }
}

export function setStudyKind(kind: StudyKind) {
  try {
    localStorage.setItem(KEY, kind)
  } catch {
    // 저장 못 해도 이번 화면 전환은 된다. 다음 접속에 객관식으로 뜰 뿐이다
  }
}
