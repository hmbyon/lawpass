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

function ProblemButton({ card, p, onOpen }: { card: IndexCard; p: IndexProblem; onOpen: Props['onOpen'] }) {
  const target = answerTarget(card, p)
  // stub 은 답안이 다른 카드에 있다는 표시다. 점선 + → 로 본 답안과 구별한다
  return (
    <button
      onClick={() => onOpen(target.card, target.problem)}
      title={p.stubFor ? `답안은 카드 ${p.stubFor.card} 에 있습니다` : undefined}
      className={`text-[11px] rounded-md px-1.5 py-0.5 border transition-colors hover:border-primary/60 hover:text-primary ${
        p.stubFor ? 'border-dashed border-border text-muted-foreground' : 'border-border bg-muted text-foreground'
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
        <section key={cat.category} className="space-y-2">
          <h2 className="text-sm font-bold text-foreground">{cat.category}</h2>
          {cat.chapters.map((ch) => (
            <div key={ch.chapter} className="bg-card border border-border rounded-xl overflow-hidden">
              <h3 className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">{ch.chapter}</h3>
              <ul className="divide-y divide-border">
                {ch.cards.map((c) => (
                  <li key={c.id} className="px-3 py-2.5 space-y-1.5">
                    <button onClick={() => onOpen(c.id)} className="flex items-baseline gap-2 text-left w-full group">
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{c.id}</span>
                      <span className="text-sm text-foreground group-hover:text-primary transition-colors">{c.title}</span>
                      {c.pages && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.pages}</span>}
                    </button>
                    {c.problems.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.problems.map((p) => (
                          <ProblemButton key={p.id} card={c} p={p} onOpen={onOpen} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {byExam.map((g) => (
        <section key={g.key} className="bg-card border border-border rounded-xl overflow-hidden">
          <h2 className="px-3 py-2 text-sm font-bold text-foreground border-b border-border">{g.label}</h2>
          <ul className="divide-y divide-border">
            {g.items.map(({ problem: p, target }) => (
              <li key={`${target.card}|${target.problem}`}>
                <button
                  onClick={() => onOpen(target.card, target.problem)}
                  className="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                >
                  <span className="text-sm text-foreground">{[p.qno, p.sub].filter(Boolean).join(' ')}</span>
                  <span className="text-[11px] text-muted-foreground">{p.points}점</span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{target.card} →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
