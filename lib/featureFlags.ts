/**
 * 화면에서 열어 둘 기능을 한자리에 모은다. 코드를 지우는 대신 문을 닫는 자리다.
 */

/**
 * ExamPass(일반수험) 모드를 사람이 고를 수 있게 열어 둘 것인가.
 *
 * 배포 전략이 LawPass(변시) 큐레이션 중심으로 바뀌면서 ExamPass 진입을 당분간 닫는다.
 * 닫는 것은 **진입점뿐**이다 — dual mode 구조도, Firebase·로컬 저장 경로도, getAppMode를
 * 보는 로직도 전부 그대로 살아 있다. 이 값을 true 로 되돌리면 예전 그대로 열린다.
 *
 * 닫힌 동안에도 이미 ExamPass 로 맞춰 둔 브라우저는 그 모드로 계속 돈다. 모드는
 * localStorage('exampass_mode')에만 있고 계정을 따라다니지 않아서, 다른 기기로 들어가면
 * 어차피 LawPass 다
 */
export const EXAMPASS_ENTRY_ENABLED = false
