'use client'

import { useState } from 'react'
import { getAppMode } from '@/lib/appMode'

interface OnboardingModalProps {
  onClose: () => void
  onSelectTab: (tab: 'pdf' | 'cbt' | 'study' | 'wrong' | 'memo') => void
}

/**
 * 안내 문구는 지금 켜져 있는 모드에 맞춘다.
 * 예전에는 배열이 모듈 상수라 앱 이름이 'ExamPass'로 박혀 있었고, LawPass 로 쓰는 사람에게도
 * "ExamPass AI는…"이라고 나갔다
 */
function buildSteps(appTitle: string, isGeneral: boolean) {
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
  {
    icon: '📄',
    title: '2. PDF 분석',
    badge: 'AI 문제 자동 추출',
    desc: '문제집 PDF만 올리면 Gemini AI가 문제, 선지, 정답, 해설을 자동으로 추출해 드려요.',
    tab: 'pdf' as const,
    bullets: [
      'aistudio.google.com에서 무료 API 키를 받아 등록하세요.',
      '기본 5페이지씩 나눠 처리하고, 문서가 무거우면 자동으로 더 작게 나눠요. 오류가 나도 "이어서 처리하기"로 이어갈 수 있어요.',
      '분할 업로드한 문제집은 "합치기" 기능으로 하나로 통합할 수 있어요.',
      '📊 진도표에서 과목/연도/단원별 학습 완료율을 확인하세요.',
    ],
  },
  {
    icon: '⚡',
    title: '3. CBT 실전 모드',
    badge: '실전 감각 극복',
    desc: '실제 시험처럼 타이머를 켜고 문제를 풀고, AI 오답 분석을 받아보세요.',
    tab: 'cbt' as const,
    bullets: [
      '과목, 연도, 범위, 문항수를 자율적으로 필터링할 수 있어요.',
      '10초마다 자동 저장되므로 PC에서 풀던 퀴즈를 모바일에서 이어 풀 수 있어요.',
      '헷갈리거나 찍은 문제를 표시하면 AI 분석 결과에 반영됩니다.',
    ],
  },
  {
    icon: '📖',
    title: '4. 선학습 모드',
    badge: '정답·해설 우선 학습',
    desc: '정답과 해설을 먼저 익힌 뒤, 실제 문제로 적용 능력을 테스트하는 모드입니다.',
    tab: 'study' as const,
    bullets: [
      '🖍️ 중요한 지문은 형광펜/밑줄로 칠해보세요 (오답노트에 연동).',
      '형광펜/밑줄을 다시 클릭하면 🧹 지우개 커서로 바로 지울 수 있어요.',
      '선지별로 정오 표시와 개별 메모를 작성할 수 있어요.',
      '"여기까지만 풀기"로 일부만 먼저 풀고 나머지는 임시저장할 수 있어요.',
    ],
  },
  {
    icon: '📝',
    title: '5. 오답노트',
    badge: 'AI 원인 분석 & 축적',
    desc: '틀린 문제와 북마크한 문제가 자동으로 모이고, AI가 오답 원인을 파악해 줍니다.',
    tab: 'wrong' as const,
    bullets: [
      '많이 틀릴수록 위험도 별점(★1~★5)이 올라갑니다.',
      isGeneral
        ? 'AI가 오답 원인을 분석해 줘요. 원인 분류 배지(개념부족·암기혼동 등)는 LawPass 모드에서만 붙습니다.'
        : 'AI가 가설을 여럿 늘어놓지 않고 가장 유력한 원인 하나를 골라 깊이 분석해요 — 개념부족·암기혼동·지문오독·선학습 적용 실패 중 하나로 표시됩니다.',
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
      '🖨️ 인쇄 버튼을 눌러 오프라인 종이 출력물로 가져갈 수 있어요.',
    ],
  },
  ]
}

export function OnboardingModal({ onClose, onSelectTab }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  // 렌더 중에 읽지 않는다 — 서버에서는 localStorage 가 없어 law 로 나오므로 화면이 한 번 어긋난다
  // (quiz-filter.tsx 가 쓰는 방식과 같다)
  const [appMode] = useState(() => getAppMode())
  const STEPS = buildSteps(appMode === 'general' ? 'ExamPass' : 'LawPass', appMode === 'general')

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