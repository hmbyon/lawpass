'use client'

import { useState } from 'react'
import { getAppMode } from '@/lib/appMode'
import { EXAMPASS_ENTRY_ENABLED } from '@/lib/featureFlags'

interface OnboardingModalProps {
  onClose: () => void
  onSelectTab: (tab: 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo') => void
  // 첫 탭이 관리자에게는 'PDF 분석', 일반 사용자에게는 '학습 현황'이라 2단계 안내가 다르다.
  // 로그인 전(auth-gate)에는 누구인지 모르므로 넘기지 않는다 — 대부분인 일반 사용자 안내가 뜬다
  isAdmin?: boolean
}

/**
 * 안내 문구는 지금 켜져 있는 모드에 맞춘다.
 * 예전에는 배열이 모듈 상수라 앱 이름이 'ExamPass'로 박혀 있었고, LawPass 로 쓰는 사람에게도
 * "ExamPass AI는…"이라고 나갔다
 */
function buildSteps(appTitle: string, isGeneral: boolean, isAdmin: boolean) {
  return [
  {
    icon: '🏠',
    title: '1. 앱으로 설치하기 (PWA)',
    badge: '어디서나 간편하게',
    desc: `${appTitle} AI는 홈 화면에 설치해서 브라우저 주소창 없이 앱처럼 쓸 수 있어요. 오프라인 환경에서도 동작합니다.`,
    tab: null,
    details: [
      {
        platform: '📱 아이폰 / 아이패드 (Safari)',
        steps: ['Safari 우측 하단 공유 버튼 탭', '"홈 화면에 추가" 선택', '우측 상단 "추가" 탭'],
      },
      {
        platform: '🤖 안드로이드 (Chrome)',
        steps: ['Chrome 우측 상단 ⋮ 메뉴 탭', '"홈 화면에 추가" 선택', '"추가" 탭'],
      },
      {
        platform: '💻 데스크톱 (Chrome / Edge)',
        steps: ['주소창 우측 끝 "앱 설치" 아이콘 클릭', '"설치" 버튼 클릭'],
      },
    ],
  },
  ...(isAdmin
    ? [
  {
    icon: '📄',
    title: '2. PDF 분석',
    badge: 'AI 문제 자동 추출',
    desc: '문제집 PDF만 올리면 Gemini AI가 문제, 선지, 정답, 해설을 자동으로 추출해 드려요.',
    tab: 'pdf' as const,
    bullets: [
      'aistudio.google.com에서 무료 API 키를 받아 등록하세요.',
      '과목은 여러 개를 한 번에 골라도 돼요. 문제마다 AI가 어느 과목인지 따로 판단합니다.',
      '기본 5페이지씩 나눠 처리하고, 문서가 무거우면 자동으로 더 작게 나눠요. 오류가 나도 "이어서 처리하기"로 이어갈 수 있어요.',
      '🔍 파싱이 끝나면 검토 화면이 열려요. 빠진 문제번호(결번)를 찾아주고, 그 자리에서 바로 다시 파싱할 수 있어요.',
      '거의 같은 문제는 자동으로 묶거나 후보로 짚어주고, 연도·과목이 헷갈리는 문제는 표시돼 직접 골라 고칠 수 있어요.',
      '분할 업로드한 문제집은 "합치기" 기능으로 하나로 통합할 수 있어요.',
      '📋 외부에서 추출한 문제는 "JSON 가져오기"로 넣을 수 있어요. 문제집 이름을 정해야 등록할 수 있고, 이미 있는 같은 문제는 새로 늘지 않고 합쳐져요. 다시 가져올 때 교재가 정정한 정답(복수정답 "②,④", 정답없음)은 기존 정답을 덮어써요.',
      '✨ 내가 올린 문제는 로그인한 누구에게나 자동으로 보여요 — 따로 공유·발행할 필요 없어요.',
      '📝 목록의 "이름" 버튼으로 표시 이름을 바꿀 수 있어요. 나만 보이는 이름이고(각자 계정마다 따로 바꿀 수 있어요), 실제 데이터는 그대로예요.',
      '☁️ 헤더 오른쪽에 동기화 상태가 떠요. "미동기화"는 이 기기에만 저장된 변경이 있다는 뜻이라 누르면 클라우드에 올라가고, "⚠️ 동기화 실패"는 누르면 다시 불러오기를 시도해요.',
      // 모드 전환은 진입점이 닫힌 동안 없는 기능이라, 안내에서도 뺀다
      EXAMPASS_ENTRY_ENABLED
        ? '⚙️ 설정에서 LawPass ↔ ExamPass 모드를 바꿀 수 있어요. "전체 데이터 초기화"는 되돌릴 수 없으니 주의하세요.'
        : '⚙️ 설정의 "전체 데이터 초기화"는 되돌릴 수 없으니 주의하세요.',
      '📊 진도표에서 과목/연도/단원별 학습 완료율과 몇 회독째인지 확인하세요.',
    ],
  },
      ]
    : [
  {
    icon: '📊',
    title: '2. 학습 현황',
    badge: '기출문제 진도 확인',
    desc: '관리자가 올린 기출문제를 CBT 실전·선학습에서 바로 풀고, 학습 현황에서 과목별 진도와 회독 횟수를 확인하는 탭이에요.',
    tab: 'pdf' as const,
    bullets: [
      '로그인만 하면 바로 풀 수 있어요 — 관리자가 올린 문제가 자동으로 보여요.',
      '✎ "문제집별" 목록의 연필 아이콘으로 내 화면에만 보이는 이름으로 바꿀 수 있어요. 다른 사람 화면엔 영향이 없어요.',
      '📊 전체·과목별·문제집별 문제 수와, 진도표(과목/연도/단원별 완료율, 몇 회독째인지)를 확인하세요. "풀어본 문제"는 채점하기까지 마친 문제를 세요(맞힌 문제 포함, 임시저장만 한 문제는 아직 안 세요).',
      '☁️ 헤더 오른쪽에 동기화 상태가 떠요. "미동기화"는 이 기기에만 저장된 변경이 있다는 뜻이라 누르면 클라우드에 올라가고, "⚠️ 동기화 실패"는 누르면 다시 불러오기를 시도해요.',
      // 모드 전환은 진입점이 닫힌 동안 없는 기능이라, 안내에서도 뺀다
      EXAMPASS_ENTRY_ENABLED
        ? '⚙️ 설정에서 LawPass ↔ ExamPass 모드를 바꿀 수 있어요. "전체 데이터 초기화"는 되돌릴 수 없으니 주의하세요.'
        : '⚙️ 설정의 "전체 데이터 초기화"는 되돌릴 수 없으니 주의하세요.',
    ],
  },
      ]),
  {
    icon: '⚡',
    title: '3. CBT 실전 모드',
    badge: '실전 감각 극복',
    desc: isAdmin
      ? '실제 시험처럼 타이머를 켜고 문제를 풀고, AI 오답 분석을 받아보세요.'
      : '실제 시험처럼 타이머를 켜고 문제를 풀고, 틀린 문제는 오답노트에 쌓아 보세요.',
    tab: 'cbt' as const,
    bullets: [
      '과목, 시험유형, 연도, 범위, 문항수를 자율적으로 필터링할 수 있어요.',
      '시험유형에서 "모의고사"를 고르면 6/8/10모 회차까지 따로 골라 풀 수 있어요.',
      '정답이 둘 이상인 문제(복수정답)와 정답이 없는 문제는 문제 위에 안내가 떠요. 복수정답은 정답인 선지를 모두 골라야 맞은 걸로 채점되고, 정답 없음 문제는 선지 아래 "정답 없음"을 골라야 맞아요. 하나만 고르면 오답이에요.',
      '10초마다 자동 저장되므로 PC에서 풀던 퀴즈를 모바일에서 이어 풀 수 있어요.',
      isAdmin
        ? '헷갈리거나 찍은 문제를 표시하면 AI 분석 결과에 반영돼요. 표시하면 칩이 떠서 어느 선지(ㄱㄴㄷ 보기가 있는 문제는 어느 보기)와 헷갈렸는지 여러 개 남길 수 있고, 채점 화면·오답노트·AI 분석에 같이 나와요. 맞혔어도 표시했다면 오답노트에 "맞혔지만 헷갈림/찍음"으로 남아요(틀린 횟수에는 안 섞여요).'
        : '헷갈리거나 찍은 문제를 표시하면 칩이 떠서 어느 선지(ㄱㄴㄷ 보기가 있는 문제는 어느 보기)와 헷갈렸는지 여러 개 남길 수 있고, 채점 화면과 오답노트에 같이 나와요. 맞혔어도 표시했다면 오답노트에 "맞혔지만 헷갈림/찍음"으로 남아요(틀린 횟수에는 안 섞여요).',
      '임시저장한 퀴즈를 이어서 풀면 헷갈림/찍음 표시와 고른 선지도 그대로 돌아와요.',
      '✏️ 화면 오른쪽 아래 "그리기"로 지문에 자유롭게 표시할 수 있어요. 어디에도 저장되지 않고 채점하거나 나가면 자동으로 사라지니 편하게 써도 돼요. 그리기를 켜 둔 채로도 선지와 헷갈림/찍음 체크는 누를 수 있고, 잘못 그었거나 지웠으면 "되돌리기"로 한 걸음씩 되돌릴 수 있어요.',
    ],
  },
  {
    icon: '📖',
    title: '4. 선학습 모드',
    badge: '정답·해설 우선 학습',
    desc: '정답과 해설을 먼저 익힌 뒤, 실제 문제로 적용 능력을 테스트하는 모드입니다.',
    tab: 'study' as const,
    bullets: [
      'CBT와 같은 필터(과목·시험유형·모의고사 회차·연도·범위)를 여기서도 쓸 수 있어요.',
      '🖍️ 글자를 드래그해 고르면 형광펜·밑줄·취소선·원·X 중 하나와 색을 골라 칠할 수 있어요. 겹치는 구간은 잘라서 둘 다 남아요. 칠한 표시는 오답노트 상세에서도 보이고, 로그인한 다른 기기에서도 이어서 볼 수 있어요.',
      '형광펜/밑줄을 다시 클릭하면 🧹 지우개 커서로 바로 지울 수 있어요.',
      '✨ "펜 자동표시"를 켜면 Apple Pencil(컴퓨터에서는 마우스를 누른 채)로 글자 위에 밑줄(—)·물결 밑줄(∿)·원(○)·X를 바로 그으면 알아보고 표시로 남겨요. 글자를 고르지 않아서 복사 메뉴가 안 떠요. X는 반대 방향 두 획을 이어서 그어 주세요. 물결은 위아래로 세 번 이상 오르내리게 그어 주세요. 너무 완만하면 곧은 밑줄로 읽혀요. 글자 사이에 [ ] < > 를 한 획으로 그으면 그 자리에 괄호 글자가 끼워져 들어가요(그 아래 글자가 살짝 밀려요). 한 번 그을 때 하나씩 들어가요. 긋는 동안 점선이 잠깐 보이고, "펜 색"에서 고른 색으로 남아요. 잘못 표시하면 아래 뜨는 "되돌리기"를 누르세요. 컴퓨터에서는 기본으로 꺼져 있고, 켜 두면 마우스로 끌어서 글자를 고르는 건 안 돼요.',
      '✏️ 화면 오른쪽 아래 "그리기"는 형광펜과 별개예요. 어디에도 저장되지 않고 채점하거나 나가면 자동으로 사라지니 편하게 써도 돼요. 잘못 그리거나 지웠다면 "되돌리기"로 한 걸음씩 되돌릴 수 있어요.',
      '🎨 "그림판"은 임시 그리기와 달리 문제마다 저장돼요. 저장 버튼을 누르거나 다른 문제로 넘기면 저장되고, 다시 열면 그 그림이 보여요. 여기에도 "되돌리기"가 있어요.',
      '선지별로 정오 표시와 개별 메모를 작성할 수 있어요.',
      '"여기까지만 풀기"로 일부만 먼저 풀고 나머지는 임시저장할 수 있어요. 이어서 풀 때 헷갈림/찍음 표시도 돌아와요.',
    ],
  },
  {
    icon: '📝',
    title: '5. 오답노트',
    badge: isAdmin ? 'AI 원인 분석 & 축적' : '틀린 문제 축적',
    desc: isAdmin
      ? '틀린 문제와 북마크한 문제, 맞혔지만 헷갈림/찍음으로 표시한 문제가 모이고, AI가 오답 원인을 파악해 줍니다.'
      : '틀린 문제와 북마크한 문제, 맞혔지만 헷갈림/찍음으로 표시한 문제가 모여요. 정답·해설과 내 표시·메모를 한곳에서 다시 볼 수 있어요.',
    tab: 'wrong' as const,
    bullets: [
      '많이 틀릴수록 위험도 별점(★1~★5)이 올라갑니다.',
      !isAdmin
        ? '정답·해설을 다시 보고 선지별 메모와 종합 메모를 남길 수 있어요. (AI 오답 분석은 지금은 관리자 계정에서만 제공돼요.)'
        : isGeneral
        ? 'AI가 오답 원인을 분석해 줘요. 원인 분류 배지(개념부족·암기혼동 등)는 LawPass 모드에서만 붙습니다.'
        : 'AI가 가설을 여럿 늘어놓지 않고 가장 유력한 원인 하나를 골라 깊이 분석해요 — 개념부족·암기혼동·지문오독·선학습 적용 실패 중 하나로 표시됩니다.',
      '맞혔지만 헷갈림/찍음으로 표시한 문제에는 "맞혔지만 헷갈림/찍음" 라벨이 붙어요. 틀린 횟수에는 안 섞이고 처음엔 별 1개(★1)가 붙고, 헷갈림/찍음으로 표시할 때마다 별이 하나씩 올라가요(최대 ★5). 이후 틀리면 별점이 틀린 횟수에 맞춰 올라가요. (이 기능을 넣기 전에 푼 문제에는 적용되지 않아요.) 어느 선지와 헷갈렸는지 골라 뒀다면 목록과 상세에서 해당 선지에 🤔/🎲 표시가 붙어요.',
      '문제를 열면 선학습과 같은 형광펜·✨ 펜 자동표시를 쓸 수 있어요. 선학습에서 칠한 표시도 그대로 보여요.',
      '선지별 메모와 종합 메모를 자유롭게 남길 수 있어요.',
      '⭐ 북마크를 해두면 D-1 암기장에 자동으로 합류합니다.',
    ],
  },
  {
    icon: '⭐',
    title: '6. D-1 암기장',
    badge: '시험 전날 최종 복습',
    desc: '시험 전날 꼭 봐야 할 고위험도 문제와 북마크 문제만 압축해서 보여줍니다.',
    tab: 'memo' as const,
    bullets: [
      '위험도 ★3 이상 문제 및 ⭐ 북마크 문제가 자동 포함됩니다.',
      '선학습에서 칠한 형광펜·펜 표시·괄호, 보기별 해설, 그림판에 그린 그림이 오답노트와 똑같이 보여요. (AI 분석이 있는 카드는 "문제·내 표시 보기"를 눌러 펼쳐요.)',
      '🖨️ 인쇄 버튼을 눌러 오프라인 종이 출력물로 가져갈 수 있어요.',
    ],
  },
  {
    icon: '⚖️',
    title: '7. 기출판례',
    badge: '문제에 인용된 판례 모음',
    desc: '문제 해설에 인용된 판례를 모아서, 어떤 판례가 어떤 문제에 몇 번 나왔는지 바로 찾아볼 수 있어요.',
    tab: null,
    bullets: [
      '과목을 먼저 고르세요 — 그 순간 시험유형·단원이 전체 선택 상태로 열려요.',
      '시험유형에서 모의고사를 고르면 6/8/10모 회차를 따로 골라 볼 수 있어요.',
      '출제연도 칩으로 변호사시험·모의고사 모두 연도별로 골라 볼 수 있어요. "최근 1·3·5개년" 버튼으로 최신 연도를 한 번에 고를 수 있고, 6/8/10모와 함께 고르면 "2025년 6모"처럼 좁혀져요.',
      '🔍 사건번호, 판례 요지, 문제번호로 검색할 수 있어요.',
      '선고시기를 최근 N개년 또는 전체로 필터링할 수 있어요.',
      '출제횟수순 / 선고일순으로 정렬해서 볼 수 있어요.',
      '판례 카드를 열면 그 판례를 인용한 문제들이 보이고, 문제를 클릭하면 해당 해설로 바로 이동해요.',
    ],
  },
  ]
}

export function OnboardingModal({ onClose, onSelectTab, isAdmin = false }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  // 렌더 중에 읽지 않는다 — 서버에서는 localStorage 가 없어 law 로 나오므로 화면이 한 번 어긋난다
  // (quiz-filter.tsx 가 쓰는 방식과 같다)
  const [appMode] = useState(() => getAppMode())
  const STEPS = buildSteps(appMode === 'general' ? 'ExamPass' : 'LawPass', appMode === 'general', isAdmin)

  const step = STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === STEPS.length - 1

  function handleClose() {
    if (dontShowAgain) {
      localStorage.setItem('lawpass_onboarding_dismissed', 'true')
    }
    onClose()
  }

  function handleTabClick(tab: 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo') {
    handleClose()
    onSelectTab(tab)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/40">
          <div className="flex items-center gap-2">
            <span className="text-xl">{step.icon}</span>
            <span className="font-bold text-sm text-foreground">{step.title}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {step.badge}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors px-1"
          >
            ×
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-sm leading-relaxed">
          <p className="text-muted-foreground text-xs">{step.desc}</p>

          {/* 1단계 (앱 설치 상세안내) */}
          {step.details && (
            <div className="space-y-3">
              {step.details.map((d, i) => (
                <div key={i} className="bg-muted/60 border border-border/50 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">{d.platform}</p>
                  <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-0.5">
                    {d.steps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {/* 2~6단계 (불렛 포인트) */}
          {step.bullets && (
            <div className="bg-muted/40 border border-border/50 rounded-xl p-3.5 space-y-2">
              <p className="text-xs font-semibold text-foreground">💡 알아두세요</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {step.bullets.map((b, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-primary shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 해당 기능 바로가기 CTA 버튼 */}
          {step.tab && (
            <button
              onClick={() => handleTabClick(step.tab!)}
              className="w-full py-2 bg-primary/10 border border-primary/30 text-primary rounded-xl text-xs font-semibold hover:bg-primary/20 transition-all flex items-center justify-center gap-1"
            >
              🚀 {step.title.split('.')[1].trim()} 바로 실행해보기 →
            </button>
          )}
        </div>

        {/* 도트 네비게이션 */}
        <div className="flex justify-center gap-1.5 py-2 bg-muted/20 border-t border-border/40">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`h-2 rounded-full transition-all ${
                idx === currentStep ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60'
              }`}
            />
          ))}
        </div>

        {/* 하단 컨트롤 바 */}
        <div className="p-4 bg-muted/40 border-t border-border flex items-center justify-between">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary w-3.5 h-3.5"
            />
            다시 보지 않기
          </label>

          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={() => setCurrentStep((c) => c - 1)}
                className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-medium hover:bg-muted/80 transition-colors"
              >
                이전
              </button>
            )}
            {isLast ? (
              <button
                onClick={handleClose}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
              >
                시작하기!
              </button>
            ) : (
              <button
                onClick={() => setCurrentStep((c) => c + 1)}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
              >
                다음
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}