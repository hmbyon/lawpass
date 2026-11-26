/**
 * 문제 유형 스위치(객관식 / 사례형 / 기록형). 이 브라우저에만 남는 화면 선택이다 —
 * 계정을 따라다니지 않고 동기화하지도 않는다 (appMode 와 같은 방식).
 * 세 값 모두 저장·복원한다. 모르는 값이나 읽기 실패는 객관식이다
 */
export type StudyKind = 'objective' | 'caseStudy' | 'record'

const KEY = 'lawpass_study_kind'

export function getStudyKind(): StudyKind {
  // 사생활 보호 모드·SSR 에서는 localStorage 접근 자체가 던질 수 있다
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'caseStudy' || saved === 'record' ? saved : 'objective'
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
