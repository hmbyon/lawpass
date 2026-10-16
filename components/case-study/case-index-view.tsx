'use client'

import { useMemo, useState } from 'react'
import type { CaseIndex, IndexCard, IndexProblem } from '@/lib/caseStudy/types'
import { FilterChips } from '@/components/filter-chips'
import {
  answerTarget, filterCards, groupByChapter, groupByExam, problemLabel, type SubjectFilter,
} from '@/lib/caseStudy/group'

type SortMode = '진도별' | '회차별'

interface Props {
  index: CaseIndex
  onOpen: (cardId: string, problemId?: string) => void
}

// 변시·모의를 색으로 가른다. 변시는 앱 강조색, 모의는 하늘색 — 라이트·다크 모두 글자가 읽히게 반투명 배경
const KIND_CHIP: Record<IndexProblem['kind'], string> = {
  변시: 'border-primary/30 bg-primary/10 text-primary',
  모의: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

function KindBadge({ kind }: { kind: IndexProblem['kind'] }) {
  return (
    <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-none border ${KIND_CHIP[kind]}`}>{kind}</span>
  )
}

function ProblemButton({ card, p, onOpen }: { card: IndexCard; p: IndexProblem; onOpen: Props['onOpen'] }) {
  const target = answerTarget(card, p)
  // stub 은 답안이 다른 카드에 있다는 표시다. 점선 + → 로 본 답안과 구별한다
  return (
    <button
      onClick={() => onOpen(target.card, target.problem)}
      title={p.stubFor ? `답안은 카드 ${target.card} 에 있습니다` : undefined}
      className={`text-[11px] leading-tight rounded-md px-1.5 py-0.5 border transition-colors hover:border-primary/60 ${KIND_CHIP[p.kind]} ${
        p.stubFor ? 'border-dashed opacity-70' : ''
      }`}
    >
      {problemLabel(p)}
      {p.stubFor && ' →'}
    </button>
  )
}

export function CaseIndexView({ index, onOpen }: Props) {
  const [subject, setSubject] = useState<SubjectFilter>('전체')
  const [sort, setSort] = useState<SortMode>('진도별')
  const [query, setQuery] = useState('')

  const cards = useMemo(() => filterCards(index, subject, query), [index, subject, query])
  const byChapter = useMemo(() => (sort === '진도별' ? groupByChapter(cards) : []), [cards, sort])
  const byExam = useMemo(() => (sort === '회차별' ? groupByExam(cards) : []), [cards, sort])
  // 회차별 주제 열 — 답안이 있는 카드의 제목. 그 카드가 필터에 걸려 빠져도 제목은 보여야 하므로 전체 색인에서 찾는다
  const titleById = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목 · 장 · 문항(예: 변시 13회 제2문)으로 검색"
          className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips<SubjectFilter>
            options={['전체', '민법', '민소']}
            selected={[subject]}
            single
            onChange={(s) => setSubject(s[0] ?? '전체')}
          />
          <FilterChips<SortMode>
            options={['진도별', '회차별']}
            selected={[sort]}
            single
            onChange={(s) => setSort(s[0] ?? sort)}
          />
        </div>
      </div>

      {cards.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-8">
          {index.cards.length === 0 ? '아직 올라온 카드가 없습니다' : '조건에 맞는 카드가 없습니다'}
        </p>
      )}

      {byChapter.map((cat) => (
        <section key={cat.category} className="pt-4 first:pt-0">
          {/* 분류(편) → 장 → 카드. 위계는 굵기·밑줄로 가른다 */}
          <h2 className="text-base font-bold text-foreground pb-1.5 border-b-2 border-primary">{cat.category}</h2>
          {cat.chapters.map((ch) => (
            <div key={ch.chapter} className="mt-4">
              <h3 className="mb-1.5 text-sm font-semibold text-foreground">
                {ch.chapter}
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">카드 {ch.cards.length}</span>
              </h3>
              <ul className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                {ch.cards.map((c) => (
                  // 넓으면 [카드번호 | 제목·출제 이력 | 쪽수] 열, 좁으면 첫 줄 [카드번호 … 쪽수] 아래로 제목이 접힌다
                  <li key={c.id} className="grid grid-cols-[auto_1fr] sm:grid-cols-[3.5rem_1fr_7rem] gap-x-3 gap-y-1 px-3 py-2.5">
                    <button
                      onClick={() => onOpen(c.id)}
                      className="self-start text-left text-xs font-semibold tabular-nums text-primary hover:underline"
                    >
                      {c.id}
                    </button>
                    <span className="justify-self-end sm:col-start-3 sm:row-start-1 sm:justify-self-end text-[11px] text-muted-foreground text-right">
                      {c.pages && c.pages !== '—' ? c.pages : ''}
                    </span>
                    <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 min-w-0 space-y-1.5">
                      <button
                        onClick={() => onOpen(c.id)}
                        className="block text-left text-sm leading-snug text-foreground hover:text-primary transition-colors"
                      >
                        {c.title}
                      </button>
                      {c.problems.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {c.problems.map((p) => (
                            <ProblemButton key={p.id} card={c} p={p} onOpen={onOpen} />
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {byExam.map((g, i) => {
        const kind = g.key.split('|')[0] as IndexProblem['kind']
        const newPart = i === 0 || byExam[i - 1].key.split('|')[0] !== kind
        return (
          <section key={g.key} className={newPart && i > 0 ? 'pt-4' : undefined}>
            {newPart && (
              <h2 className="mb-3 text-base font-bold text-foreground pb-1.5 border-b-2 border-primary">
                {kind === '변시' ? '변호사시험' : '법전협 모의시험'}
              </h2>
            )}
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <KindBadge kind={kind} />
              {g.label}
              <span className="text-[11px] font-normal text-muted-foreground">{g.items.length}문항</span>
            </h3>
            <ul className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
              {g.items.map(({ problem: p, target }) => {
                const answerCard = titleById.get(target.card)
                return (
                  <li key={`${target.card}|${target.problem}`}>
                    {/* 넓으면 [문항·배점 | 주제 | 카드 →] 열, 좁으면 첫 줄 [문항·배점 … 카드 →] 아래 주제 */}
                    <button
                      onClick={() => onOpen(target.card, target.problem)}
                      className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[10rem_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground whitespace-nowrap">
                        {[p.qno, p.sub].filter(Boolean).join(' ')}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">{p.points}점</span>
                      </span>
                      <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2 min-w-0 truncate text-xs text-muted-foreground">
                        {answerCard && <span className="mr-1 text-[10px] text-muted-foreground/80">{answerCard.subject}</span>}
                        {answerCard?.title ?? ''}
                      </span>
                      <span className={`col-start-2 row-start-1 sm:col-start-3 text-[11px] tabular-nums text-primary whitespace-nowrap ${p.stubFor ? 'opacity-70' : ''}`}>
                        {target.card} →
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
