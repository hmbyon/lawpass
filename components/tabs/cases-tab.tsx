'use client'

import { useMemo, useState } from 'react'
import type { Question } from '@/lib/types'
import type { Subject } from '@/lib/types'
import { SUBJECT_UNITS } from '@/lib/units'
import { FilterChips } from '@/components/filter-chips'
import { groupBySource } from '@/lib/questionSource'
import {
  buildCaseDigest, filterCases, sortCases, periodLabel, PERIOD_OPTIONS,
  findCaseMentions, allExplanationText, previewMention, selectedUnitsOf, mergeUnitSelection,
  type CaseGroup, type CaseSort,
} from '@/lib/caseDigest'

/**
 * 기출판례 — 해설에 인용된 판례를 판례 단위로 모아 보여준다.
 *
 * 판례는 파싱할 때 구조로 담긴다(Question.cases). 그 필드가 생기기 전에 파싱된 문제에는
 * 없으므로, 재파싱 전에는 목록이 비어 보이는 것이 정상이다.
 */

function QuestionLine({
  q,
  caseNumber,
  open,
  onToggle,
}: {
  q: Question
  caseNumber: string
  open: boolean
  onToggle: () => void
}) {
  // 판례 조각을 먼저 보여주고 해설 전체는 눌러야 나온다. 이 화면에 온 이유가 그 판례이지
  // 문제 전체가 아니기 때문이다
  const [showAll, setShowAll] = useState(false)
  const mentions = useMemo(() => findCaseMentions(q, caseNumber), [q, caseNumber])
  const whole = useMemo(() => allExplanationText(q), [q])
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
          {/* 과목은 한 단 키워 진하게. 나머지 메타는 곁들이는 정보다 */}
          <p className="text-[11px] text-muted-foreground">
            <span className="text-xs font-semibold text-foreground">{q.subject}</span>
            {' · '}
            {q.examType} · {q.year ? `${q.year}년` : '연도 미상'}
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

          {/* 이 판례가 언급된 자리 */}
          {mentions.length > 0 ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-1.5">
              <p className="text-[11px] font-medium text-primary">이 판례가 언급된 부분</p>
              {mentions.map((m, i) => (
                <div key={`${m.where}-${i}`} className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">{m.where}</p>
                  <p className="text-foreground whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              이 문제 어디에서 인용됐는지 정확히 찾지 못했습니다
            </p>
          )}

          {whole.length > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAll ? '해설 접기' : '해설 전체 보기'}
              </button>
              {showAll &&
                whole.map((m, i) => (
                  <div key={`all-${m.where}-${i}`} className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">{m.where}</p>
                    <p className="text-foreground whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CaseCard({
  group,
  allQuestions,
  openId,
  onOpen,
}: {
  group: CaseGroup
  // 출처에 파일명을 붙일지는 전체 문제집을 봐야 안다 (같은 회차의 다른 판본이 있는지)
  allQuestions: Question[]
  openId: string | null
  onOpen: (id: string | null) => void
}) {
  // 카드에서 바로 보여줄 조각. 판례 목록을 훑는 사람이 매번 문제를 펼쳐 보게 할 이유가 없다
  const preview = useMemo(() => previewMention(group), [group])
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

      {/* 해설에 실제로 적힌 문장 — 요지는 요약이라 표현이 다듬어져 있다.
          길면 잘라 둔다. 전문은 그 문제번호를 누르면 나온다 */}
      {preview && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-0.5">
          <p className="text-[11px] text-muted-foreground">
            {preview.q.no}번 {preview.mention.where}
          </p>
          <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed line-clamp-4">
            {preview.mention.text}
          </p>
        </div>
      )}

      {/* 출처별로 묶는다. 판례 하나가 여러 회차에 걸쳐 나오는 것이 이 화면의 핵심이라,
          문제번호만 늘어놓으면 어느 시험 것인지 알 수 없다 */}
      <div className="space-y-1.5">
        {groupBySource(group.questions, allQuestions).map((bucket) => (
          <div key={bucket.label} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground shrink-0">{bucket.label}</span>
            {bucket.questions.map((q) => (
              <QuestionLine
                key={q.id}
                q={q}
                caseNumber={group.caseNumber}
                open={openId === `${group.key}|${q.id}`}
                onToggle={() => onOpen(openId === `${group.key}|${q.id}` ? null : `${group.key}|${q.id}`)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CasesTab({ questions }: { questions: Question[] }) {
  const digest = useMemo(() => buildCaseDigest(questions), [questions])
  const [openId, setOpenId] = useState<string | null>(null)
  // 기본은 최근 5개년·출제횟수순. 탭 이름이 '기출판례'인 만큼 전체도 한 번에 볼 수 있게 둔다
  const [years, setYears] = useState<number | null>(5)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [units, setUnits] = useState<string[]>([])
  const [sort, setSort] = useState<CaseSort>('count')
  const now = useMemo(() => new Date(), [])

  // 과목·단원만 적용한 목록. 기간으로 몇 건이 빠졌는지 세려면 그 앞 단계가 필요하다
  const scoped = useMemo(
    () => filterCases(digest.groups, { subjects, units, now }),
    [digest.groups, subjects, units, now]
  )
  const inRange = useMemo(
    () => filterCases(scoped, { years, subjects, units, now }),
    [scoped, years, subjects, units, now]
  )
  // 선고일을 모르는 판례는 기간과 무관하게 늘 따로 보여준다 (숨기면 재파싱할지 정할 수 없다)
  const dated = useMemo(() => sortCases(inRange.filter((g) => g.year !== null), sort), [inRange, sort])
  const undated = useMemo(() => sortCases(inRange.filter((g) => g.year === null), sort), [inRange, sort])
  const hiddenByPeriod = scoped.filter((g) => g.year !== null).length - dated.length

  /**
   * 과목을 고르지 않았으면 과목별로 나눠 세운다. 단원 분포와 같은 방식이고, 과목 순서도
   * 같은 상수(SUBJECT_UNITS 키 순서)를 쓴다.
   *
   * 한 판례가 여러 과목에서 인용됐으면 그 과목 섹션에 **모두** 넣는다. 하나로 몰아넣으면
   * "이 판례가 여러 과목에 걸쳐 나온다"는 사실이 사라진다 — 그게 이 화면의 값이다.
   * 과목을 고른 상태에서는 이미 좁혀 보는 중이므로 나누지 않고 평평하게 둔다
   */
  const bySubject = useMemo(() => {
    if (subjects.length > 0) return null
    return (Object.keys(SUBJECT_UNITS) as Subject[])
      .map((subject) => ({ subject, cases: dated.filter((g) => g.subjects.includes(subject)) }))
      .filter((sec) => sec.cases.length > 0)
  }, [subjects, dated])

  const availableUnits = useMemo(
    () => Array.from(new Set(scoped.flatMap((g) => g.units))),
    [scoped]
  )
  const availableSubjects = useMemo(
    () => Array.from(new Set(digest.groups.flatMap((g) => g.subjects))),
    [digest.groups]
  )

  function changeSubjects(next: Subject[]) {
    setSubjects(next)
    // 고른 과목에 없는 단원은 선택에서 뺀다. 남겨 두면 결과가 0건인데 이유가 안 보인다
    const allowed = new Set(
      (next.length > 0 ? next : (Object.keys(SUBJECT_UNITS) as Subject[])).flatMap((s) => SUBJECT_UNITS[s] ?? [])
    )
    setUnits((prev) => prev.filter((u) => allowed.has(u)))
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground mb-1">기출판례</h2>
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
          {/* 기간 — quiz-filter 의 "최근 N개년"과 같은 뜻이다 (올해 포함 N개 연도) */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">선고 시기</label>
              <div className="flex gap-1.5">
                {PERIOD_OPTIONS.map((n) => (
                  <button
                    key={String(n)}
                    onClick={() => setYears(n)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      years === n
                        ? 'border-primary text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                    }`}
                  >
                    {periodLabel(n)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">과목 (복수 선택)</label>
              <FilterChips
                options={Object.keys(SUBJECT_UNITS) as Subject[]}
                selected={subjects}
                onChange={changeSubjects}
                available={availableSubjects}
              />
            </div>

            {/* 단원은 고른 과목의 것만 보여준다. 과목을 안 고르면 일곱 과목의 단원이 한꺼번에
                쏟아져 고를 수가 없다 (지금 36개) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">단원 (복수 선택)</label>
              {subjects.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">과목을 고르면 그 과목의 단원이 나옵니다</p>
              ) : (
                <div className="space-y-2.5">
                  {units.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      고른 과목의 단원 전체를 보고 있습니다 · 하나를 누르면 그 단원만 봅니다
                    </p>
                  )}
                  {/* 과목마다 한 줄로 끊는다. 이어 붙이면 어느 단원이 어느 과목 것인지
                      이름만으로는 알 수 없다 */}
                  {subjects.map((s) => (
                    <div key={s} className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{s}</p>
                      <FilterChips
                        options={SUBJECT_UNITS[s] ?? []}
                        selected={units}
                        onChange={(next) => setUnits(mergeUnitSelection(s, units, next))}
                        available={availableUnits}
                        allImplied={selectedUnitsOf(s, units).length === 0}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="text-xs font-medium text-muted-foreground">정렬</label>
              <div className="flex rounded-lg border border-border overflow-hidden text-[11px]">
                {([
                  { id: 'count' as const, label: '출제횟수순' },
                  { id: 'date' as const, label: '선고일순' },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSort(opt.id)}
                    className={`px-2 py-1 transition-colors ${
                      sort === opt.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            판례 {digest.totalGroups}건 중 {dated.length + undated.length}건 표시 · 판례가 달린 문제{' '}
            {digest.questionsWithCases}개
            {/* 뺀 건수는 실제로 뺐을 때만 알린다 */}
            {years !== null && hiddenByPeriod > 0 && ` · ${periodLabel(years)}보다 오래된 판례 ${hiddenByPeriod}건은 뺐습니다`}
          </p>

          <div className="space-y-2">
            {dated.length === 0 && (
              <p className="text-xs text-muted-foreground">고른 조건에 해당하는 판례가 없습니다</p>
            )}
            {bySubject
              ? bySubject.map((sec) => (
                  <div key={sec.subject} className="space-y-2 pt-1">
                    {/* 이 줄이 목록을 과목으로 가르는 유일한 표시다. 카드 제목(요지)보다
                        작으면 어느 과목을 보고 있는지가 스크롤 중에 사라진다 */}
                    <p className="text-sm font-semibold text-foreground">
                      {sec.subject}{' '}
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {sec.cases.length}건
                      </span>
                    </p>
                    {sec.cases.map((g) => (
                      <CaseCard
                        key={`${sec.subject}|${g.key}`}
                        group={g}
                        allQuestions={questions}
                        openId={openId}
                        onOpen={setOpenId}
                      />
                    ))}
                  </div>
                ))
              : dated.map((g) => (
                  <CaseCard key={g.key} group={g} allQuestions={questions} openId={openId} onOpen={setOpenId} />
                ))}
          </div>

          {/* 선고일을 모르는 판례는 숨기지 않는다. 몇 건이 그런지 보여야 재파싱할지 정할 수 있다 */}
          {undated.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                선고일 미상 {undated.length}건
                <span className="text-[11px]"> — 해설에 선고일이 적혀 있지 않아 연도를 알 수 없습니다</span>
              </p>
              {undated.map((g) => (
                <CaseCard key={g.key} group={g} allQuestions={questions} openId={openId} onOpen={setOpenId} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
