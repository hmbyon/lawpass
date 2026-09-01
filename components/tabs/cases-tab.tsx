'use client'

import { useMemo, useState } from 'react'
import type { Question } from '@/lib/types'
import { buildCaseDigest, type CaseGroup } from '@/lib/caseDigest'

/**
 * 최신판례 — 해설에 인용된 판례를 판례 단위로 모아 보여준다.
 *
 * 판례는 파싱할 때 구조로 담긴다(Question.cases). 그 필드가 생기기 전에 파싱된 문제에는
 * 없으므로, 재파싱 전에는 목록이 비어 보이는 것이 정상이다.
 */

function QuestionLine({
  q,
  open,
  onToggle,
}: {
  q: Question
  open: boolean
  onToggle: () => void
}) {
  return (
    <div>
      {/* 문제번호를 눌러 그 자리에서 펼친다 (검토 화면과 같은 방식) */}
      <button
        onClick={onToggle}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          open
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground border-border hover:border-primary/40'
        }`}
      >
        {q.no}번
      </button>
      {open && (
        <div className="mt-1.5 mb-1 p-2.5 rounded-lg bg-muted/50 border border-border space-y-2 text-xs">
          <p className="text-[11px] text-muted-foreground">
            {q.subject} · {q.examType} · {q.year ? `${q.year}년` : '연도 미상'}
            {q.unit ? ` · ${q.unit}` : ''}
          </p>
          <p className="text-foreground whitespace-pre-wrap leading-relaxed">{q.passage}</p>
          <div className="space-y-1">
            {q.choices.map((c) => (
              <div
                key={c.label}
                className={`flex gap-2 p-1.5 rounded border ${
                  c.label === q.answer
                    ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-border text-muted-foreground'
                }`}
              >
                <span className="font-semibold shrink-0">{c.label}</span>
                <span className="flex-1">{c.text}</span>
                {c.label === q.answer && <span className="shrink-0">✓ 정답</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CaseCard({
  group,
  openId,
  onOpen,
}: {
  group: CaseGroup
  openId: string | null
  onOpen: (id: string | null) => void
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 space-y-2">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm text-foreground leading-relaxed">{group.summary || '요지 없음'}</p>
        <span className="shrink-0 text-xs font-semibold text-primary tabular-nums">{group.count}회 출제</span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {group.court ? `${group.court} ` : ''}
        {group.decidedDate ? `${group.decidedDate} 선고 ` : ''}
        <span className="text-foreground">{group.caseNumber}</span>
        {group.otherSummaries > 0 && ` · 다른 요약 ${group.otherSummaries}가지`}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {[...group.questions]
          .sort((a, b) => Number(a.no) - Number(b.no))
          .map((q) => (
            <QuestionLine
              key={q.id}
              q={q}
              open={openId === `${group.key}|${q.id}`}
              onToggle={() => onOpen(openId === `${group.key}|${q.id}` ? null : `${group.key}|${q.id}`)}
            />
          ))}
      </div>
    </div>
  )
}

export function CasesTab({ questions }: { questions: Question[] }) {
  const digest = useMemo(() => buildCaseDigest(questions), [questions])
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">최신판례</h2>
        <p className="text-sm text-muted-foreground">
          해설에 인용된 판례를 판례별로 모아, 많이 나온 순서로 보여줍니다.
        </p>
      </div>

      {digest.totalGroups === 0 ? (
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-1">
          <p className="text-sm text-foreground">아직 모인 판례가 없습니다</p>
          <p className="text-xs text-muted-foreground">
            판례는 PDF를 분석할 때 해설에서 함께 뽑습니다. 이 기능이 생기기 전에 분석한 문제집에는
            판례 정보가 없어, 다시 분석해야 여기에 쌓입니다.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            판례 {digest.totalGroups}건 · 판례가 달린 문제 {digest.questionsWithCases}개
            {digest.olderCount > 0 && ` · 5년보다 오래된 판례 ${digest.olderCount}건은 아래 목록에서 뺐습니다`}
          </p>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">최근 5년</p>
            {digest.recent.length === 0 && (
              <p className="text-xs text-muted-foreground">최근 5년 안에 선고된 판례가 없습니다</p>
            )}
            {digest.recent.map((g) => (
              <CaseCard key={g.key} group={g} openId={openId} onOpen={setOpenId} />
            ))}
          </div>

          {/* 선고일을 모르는 판례는 숨기지 않는다. 몇 건이 그런지 보여야 재파싱할지 정할 수 있다 */}
          {digest.undated.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                선고일 미상 {digest.undated.length}건
                <span className="text-[11px]"> — 해설에 선고일이 적혀 있지 않아 연도를 알 수 없습니다</span>
              </p>
              {digest.undated.map((g) => (
                <CaseCard key={g.key} group={g} openId={openId} onOpen={setOpenId} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
