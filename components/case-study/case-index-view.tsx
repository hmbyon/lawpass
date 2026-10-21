'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import type { CaseIndex, IndexCard, IndexProblem } from '@/lib/caseStudy/types'
import { FilterChips } from '@/components/filter-chips'
import {
  answerTarget, filterCards, groupByChapter, groupByExam, sortCards, type SubjectFilter,
} from '@/lib/caseStudy/group'

type SortMode = '진도별' | '회차별'

// 회차별 목록에서 카드를 열 때 함께 넘기는 '문항 이동' 순서. 같은 회차의 표시 순서 그대로다
export interface SeqItem {
  card: string
  problem: string
  label: string
}

interface Props {
  index: CaseIndex
  onOpen: (cardId: string, problemId?: string, seq?: { items: SeqItem[]; at: number }) => void
}

// 변시·모의를 색으로 가른다. 변시는 앱 강조색, 모의는 하늘색 — 라이트·다크 모두 글자가 읽히게 반투명 배경
const KIND_CHIP: Record<IndexProblem['kind'], string> = {
  변시: 'border-primary/30 bg-primary/10 text-primary',
  모의: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

// '제2문의 1' → '2-1', '제1문' → '1' (레퍼런스 답안집의 짧은 표기)
function shortQno(qno: string): string {
  const m = qno.match(/제\s*(\d+)\s*문(?:의\s*(\d+))?/)
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : qno
}

// 진도별 버튼 라벨: 변시 '11회 2-1 문1', 모의 '24.6모 2-2 문1'
function shortLabel(p: IndexProblem): string {
  const exam = p.kind === '변시' ? `${p.exam}회` : `${p.exam}모`
  return [exam, shortQno(p.qno), p.sub].filter(Boolean).join(' ')
}

// 회차 제목: '2022년 제11회 변호사시험', '2024년 6월 모의'. 색인에는 examLabel 이 없어 회차 값에서 만든다
function examTitle(kind: IndexProblem['kind'], exam: number | string): string {
  if (kind === '변시') return `${2011 + Number(exam)}년 제${exam}회 변호사시험`
  const [y, m] = String(exam).split('.')
  return `20${y}년 ${m}월 모의`
}

// 진도별 제목 순번 — 표시 전용. 데이터·그룹 키·검색 문자열에는 넣지 않는다
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']
const romanMark = (i: number) => `${ROMAN[i] ?? i + 1}.`

// 번호는 고정폭 칸에 두고 제목은 그 옆에서 줄바꿈한다 — 두 줄째가 번호 밑으로 파고들지 않게(내어쓰기)
function Numbered({ mark, width, children }: { mark: string; width: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline">
      <span className={`${width} shrink-0 tabular-nums`}>{mark}</span>
      <span className="min-w-0">{children}</span>
    </span>
  )
}

// 분류 제목에 과목이 접두어로 붙어 온 경우('민소 · 병합소송') 과목 구획 아래에서는 떼고 보인다. 표시용일 뿐 값은 그대로다
function categoryLabel(category: string, subject: string): string {
  const prefix = `${subject} · `
  return category.startsWith(prefix) ? category.slice(prefix.length) : category
}

function examShort(kind: IndexProblem['kind'], exam: number | string): string {
  return kind === '변시' ? `변시 ${exam}회` : `모의 ${exam}`
}

function KindBadge({ kind }: { kind: IndexProblem['kind'] }) {
  return (
    <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-none border ${KIND_CHIP[kind]}`}>{kind}</span>
  )
}

const BTN = 'inline-flex items-baseline gap-1 text-[11px] leading-tight rounded-md px-1.5 py-0.5 border transition-colors hover:border-primary/60'

function ProblemButton({ card, p, onOpen }: { card: IndexCard; p: IndexProblem; onOpen: Props['onOpen'] }) {
  const target = answerTarget(card, p)
  // stub 은 답안이 다른 카드에 있다는 표시다. 점선 + → 로 본 답안과 구별한다
  return (
    <button
      onClick={() => onOpen(target.card, target.problem)}
      title={p.stubFor ? `답안은 카드 ${target.card} 에 있습니다` : undefined}
      className={`${BTN} ${KIND_CHIP[p.kind]} ${p.stubFor ? 'border-dashed opacity-70' : ''}`}
    >
      {shortLabel(p)}
      {p.stubFor && ' →'}
    </button>
  )
}

// 표 공통. 넓으면 표, 좁으면(max-sm) 행마다 블록으로 접는다
const TABLE = 'w-full text-xs border-collapse border-hidden max-sm:block'
const TH = 'border border-border bg-muted px-2 py-1.5 text-left font-semibold text-muted-foreground'
const TD = 'border border-border px-2 py-2 align-top max-sm:border-0 max-sm:p-0'
const DASH = <span className="text-muted-foreground">—</span>

// 마지막 열(쪽수) 제목 — 과목마다 기준 교재가 다르다
const TEXTBOOK: Record<string, string> = {
  민법: '송영곤', 민소: '송영곤', 상법: '공태용', 형법: '변사기', 형소: '변사기', 행정법: '핸드북', 헌법: '핸드북',
}

// 회차별 — 과목 → 시험 과목. 같은 번호 문항(제1문)이 시험 과목마다 따로 있어 회차 아래를 이걸로 한 번 더 나눈다.
// 목록에 없는 과목은 그 이름 그대로 한 묶음이 되어 맨 뒤에 온다
const EXAM_SUBJECT: Record<string, string> = {
  헌법: '공법', 행정법: '공법', 민법: '민사법', 민소: '민사법', 상법: '민사법', 형법: '형사법', 형소: '형사법',
}
const EXAM_SUBJECT_ORDER = ['공법', '형사법', '민사법']
const examSubjectRank = (s: string) => (EXAM_SUBJECT_ORDER.includes(s) ? EXAM_SUBJECT_ORDER.indexOf(s) : EXAM_SUBJECT_ORDER.length)

// 회차별 유형·연도 토글. 색인에는 examLabel 이 없어 연도를 회차 값에서 읽는다(변시 11회 → 2022, 모의 '23.10' → 2023).
// 연도를 못 읽는 회차(예: kind '유사')는 연도 '전체'에서만 보인다
type KindFilter = '전체' | '모의' | '변시'
function examYear(kind: string, exam: number | string): string | null {
  if (kind === '변시') return Number.isFinite(Number(exam)) ? String(2011 + Number(exam)) : null
  const y = Number(String(exam).split('.')[0])
  return kind === '모의' && Number.isFinite(y) && y > 0 ? String(2000 + y) : null
}
// 회차 묶음 키 '{kind}|{exam}'
function examOf(key: string): { kind: string; year: string | null } {
  const [kind, ...rest] = key.split('|')
  return { kind, year: examYear(kind, rest.join('|')) }
}

export function CaseIndexView({ index, onOpen }: Props) {
  const [subject, setSubject] = useState<SubjectFilter>('전체')
  const [sort, setSort] = useState<SortMode>('진도별')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('전체')
  const [year, setYear] = useState('전체')

  const subjects = useMemo(() => ['전체', ...new Set(sortCards(index.cards).map((c) => c.subject))], [index])
  const cards = useMemo(() => filterCards(index, subject, query), [index, subject, query])
  const byChapter = useMemo(() => (sort === '진도별' ? groupByChapter(cards) : []), [cards, sort])
  // 진도별 1단계 구획 = 과목. 카드가 과목 → 교재 순으로 정렬돼 있어 같은 과목의 분류는 연달아 나온다
  const bySubject = useMemo(() => {
    const out: { subject: string; categories: typeof byChapter }[] = []
    for (const cat of byChapter) {
      const subject = cat.chapters[0]?.cards[0]?.subject ?? ''
      const last = out[out.length - 1]
      if (last && last.subject === subject) last.categories.push(cat)
      else out.push({ subject, categories: [cat] })
    }
    return out
  }, [byChapter])
  const allExams = useMemo(() => (sort === '회차별' ? groupByExam(cards) : []), [cards, sort])
  const years = useMemo(
    () => ['전체', ...[...new Set(allExams.map((g) => examOf(g.key).year).filter((y): y is string => !!y))].sort((a, b) => Number(b) - Number(a))],
    [allExams]
  )
  // 한 회차 묶음은 유형·회차가 하나뿐이라 묶음 단위로 거른다 (유형 AND 연도)
  const byExam = allExams.filter((g) => {
    const e = examOf(g.key)
    return (kindFilter === '전체' || e.kind === kindFilter) && (year === '전체' || e.year === year)
  })
  // 회차별 유형·카드 열 — 답안이 있는 카드의 제목. 그 카드가 필터에 걸려 빠져도 제목은 보여야 하므로 전체 색인에서 찾는다
  const byId = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])

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
            options={subjects}
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
        {sort === '회차별' && (
          <>
            <FilterChips<KindFilter>
              options={['전체', '모의', '변시']}
              selected={[kindFilter]}
              single
              onChange={(s) => setKindFilter(s[0] ?? '전체')}
            />
            <FilterChips<string>
              options={years}
              selected={[year]}
              single
              onChange={(s) => setYear(s[0] ?? '전체')}
            />
          </>
        )}
      </div>

      {(cards.length === 0 || (sort === '회차별' && byExam.length === 0)) && (
        <p className="text-center text-xs text-muted-foreground py-8">
          {index.cards.length === 0 ? '아직 올라온 카드가 없습니다' : '조건에 맞는 카드가 없습니다'}
        </p>
      )}

      {/* 과목 → 분류(편) → 장 → 카드. 위계는 크기·굵기·밑줄로 가른다 */}
      {bySubject.map((subj) => (
        <section key={subj.subject} className="pt-6 first:pt-0">
          <h2 className="text-lg font-extrabold text-foreground pb-1.5 border-b-2 border-primary">{subj.subject}</h2>
          {subj.categories.map((cat, ci) => (
            <section key={cat.category} className="pt-5 first:pt-3">
              <h3 className="text-[15px] font-bold text-foreground pb-1 border-b border-border">
                <Numbered mark={romanMark(ci)} width="w-7">{categoryLabel(cat.category, subj.subject)}</Numbered>
              </h3>
              {cat.chapters.map((ch, hi) => (
                <div key={ch.chapter} className="mt-4">
                  <h4 className="mb-1.5 text-sm font-semibold text-foreground">
                    <Numbered mark={`${hi + 1}.`} width="w-6">
                      {ch.chapter}
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">카드 {ch.cards.length}</span>
                    </Numbered>
                  </h4>
                  <div className="bg-card border border-border rounded-xl overflow-hidden">
                    {/* 레퍼런스와 같이 카드·유형·쪽수 열만 폭을 고정하고 변시·모의 열은 버튼 수만큼 나눠 갖는다 */}
                    <table className={TABLE}>
                      <colgroup>
                        <col className="w-14" />
                        <col className="w-48" />
                        <col />
                        <col />
                        <col className="w-24" />
                      </colgroup>
                      <thead className="max-sm:hidden">
                        <tr>
                          <th className={TH}>카드</th>
                          <th className={TH}>유형</th>
                          <th className={TH}>변시</th>
                          <th className={TH}>모의</th>
                          <th className={TH}>{TEXTBOOK[subj.subject] ?? '교재'}</th>
                        </tr>
                      </thead>
                      <tbody className="max-sm:block max-sm:divide-y max-sm:divide-border">
                        {ch.cards.map((c) => {
                          const bs = c.problems.filter((p) => p.kind === '변시')
                          const my = c.problems.filter((p) => p.kind === '모의')
                          const pages = c.pages && c.pages !== '—' ? c.pages : ''
                          return (
                            // 좁으면: 1줄 [카드번호 … 쪽수] / 2줄 유형 / 3·4줄 변시·모의 버튼 (빈 칸은 감춘다)
                            <tr key={c.id} className="max-sm:grid max-sm:grid-cols-[auto_1fr] max-sm:gap-x-3 max-sm:gap-y-1.5 max-sm:px-3 max-sm:py-2.5">
                              <td className={`${TD} whitespace-nowrap`}>
                                <button onClick={() => onOpen(c.id)} className="font-semibold tabular-nums text-primary hover:underline">
                                  {c.id}
                                </button>
                              </td>
                              <td className={`${TD} max-sm:col-span-2 max-sm:row-start-2`}>
                                <button
                                  onClick={() => onOpen(c.id)}
                                  className="text-left text-[13px] leading-snug text-foreground hover:text-primary transition-colors"
                                >
                                  {c.title}
                                </button>
                              </td>
                              {[bs, my].map((list, i) => (
                                <td key={i} className={`${TD} max-sm:col-span-2 ${list.length === 0 ? 'max-sm:hidden' : ''}`}>
                                  {list.length === 0 ? (
                                    DASH
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {list.map((p) => <ProblemButton key={p.id} card={c} p={p} onOpen={onOpen} />)}
                                    </div>
                                  )}
                                </td>
                              ))}
                              <td className={`${TD} text-muted-foreground max-sm:col-start-2 max-sm:row-start-1 max-sm:justify-self-end max-sm:text-right max-sm:text-[11px]`}>
                                {pages || DASH}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </section>
      ))}

      {byExam.map((g, gi) => {
        const kind = g.key.split('|')[0] as IndexProblem['kind']
        const exam = g.items[0]?.problem.exam ?? ''
        const newPart = gi === 0 || byExam[gi - 1].key.split('|')[0] !== kind
        // 시험 과목(답안이 있는 카드의 과목 기준) 순으로 세운다. 같은 시험 과목 안에서는 문항 순 그대로다(안정 정렬)
        const examSubjectOf = (it: (typeof g.items)[number]) => {
          const subject = byId.get(it.target.card)?.subject ?? ''
          return EXAM_SUBJECT[subject] ?? subject
        }
        const items = [...g.items].sort((a, b) => {
          const sa = examSubjectOf(a), sb = examSubjectOf(b)
          return examSubjectRank(sa) - examSubjectRank(sb) || sa.localeCompare(sb)
        })
        // ◀ ▶ 문항 이동이 따라갈 순서 — 이 회차 표의 표시 순서(시험 과목 순, 문항 순, 소문항 순) 그대로다
        const seq: SeqItem[] = items.map(({ problem: p, target }) => ({
          card: target.card,
          problem: target.problem,
          label: `${examShort(kind, exam)} · ${[p.qno, p.sub].filter(Boolean).join(' ')}`,
        }))
        // 시험 과목마다 표 하나. 한 행 = 한 문항, 같은 문항의 소문항은 같은 행의 버튼으로 모은다
        const parts: { name: string; rows: { qno: string; at: number[] }[] }[] = []
        items.forEach((it, i) => {
          const name = examSubjectOf(it)
          let part = parts[parts.length - 1]
          if (!part || part.name !== name) parts.push((part = { name, rows: [] }))
          const last = part.rows[part.rows.length - 1]
          if (last && last.qno === it.problem.qno) last.at.push(i)
          else part.rows.push({ qno: it.problem.qno, at: [i] })
        })
        const rowCount = parts.reduce((n, part) => n + part.rows.length, 0)
        return (
          <section key={g.key} className={newPart && gi > 0 ? 'pt-4' : undefined}>
            {newPart && (
              <h2 className="mb-3 text-base font-bold text-foreground pb-1.5 border-b-2 border-primary">
                {kind === '변시' ? '변호사시험' : '법전협 모의고사'}
              </h2>
            )}
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <KindBadge kind={kind} />
              {examTitle(kind, exam)}
              <span className="text-[11px] font-normal text-muted-foreground">{rowCount}문항</span>
            </h3>
            {parts.map(({ name, rows }) => (
              <Fragment key={name}>
                <h4 className="mb-1.5 text-sm font-semibold text-foreground">
                  {name || '과목 없음'}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{rows.length}문항</span>
                </h4>
                <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
                  <table className={`${TABLE} table-fixed`}>
                    <colgroup>
                      <col className="w-32" />
                      <col className="w-[38%]" />
                      <col />
                    </colgroup>
                    <thead className="max-sm:hidden">
                      <tr>
                        <th className={TH}>문항</th>
                        <th className={TH}>답안 (소문항·배점)</th>
                        <th className={TH}>유형 · 카드</th>
                      </tr>
                    </thead>
                    <tbody className="max-sm:block max-sm:divide-y max-sm:divide-border">
                      {rows.map((row) => {
                        const targets = row.at.map((i) => items[i].target)
                        // 유형·카드 열과 과목 태그는 답안이 있는 카드 기준 (stub 은 대상 카드)
                        const cardIds = [...new Set(targets.map((t) => t.card))]
                        const subjects = [...new Set(cardIds.map((id) => byId.get(id)?.subject).filter(Boolean))]
                        return (
                          <tr key={row.qno} className="max-sm:block max-sm:space-y-1.5 max-sm:px-3 max-sm:py-2.5">
                            <td className={`${TD} max-sm:block`}>
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="whitespace-nowrap text-[13px] text-foreground">{row.qno}</span>
                                {subjects.map((s) => (
                                  <span key={s} className="rounded border border-border px-1 text-[10px] text-muted-foreground">{s}</span>
                                ))}
                              </div>
                            </td>
                            <td className={`${TD} max-sm:block`}>
                              <div className="flex flex-wrap gap-1">
                                {row.at.map((i) => {
                                  const { problem: p } = items[i]
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => onOpen(seq[i].card, seq[i].problem, { items: seq, at: i })}
                                      title={p.stubFor ? `답안은 카드 ${seq[i].card} 에 있습니다` : undefined}
                                      className={`${BTN} ${KIND_CHIP[kind]}`}
                                    >
                                      {p.sub || '전체'}
                                      <span className="text-[10px] opacity-75">{p.points}점</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </td>
                            <td className={`${TD} max-sm:block text-muted-foreground leading-relaxed`}>
                              {cardIds.map((id, k) => (
                                <Fragment key={id}>
                                  {k > 0 && <span className="mx-1">/</span>}
                                  <span className="text-foreground/90">{byId.get(id)?.title ?? ''}</span>{' '}
                                  <button onClick={() => onOpen(id)} className="tabular-nums text-primary hover:underline">
                                    [{id}]
                                  </button>
                                </Fragment>
                              ))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            ))}
          </section>
        )
      })}
    </div>
  )
}
