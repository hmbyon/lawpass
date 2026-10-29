// 상대 경로: check:case-misses 스크립트(tsc CLI, 경로 별칭 없음)에서도 컴파일된다
import { parseBlockHtml } from './answerFormats'
import { extractAiItems, type AiCheckItem } from './aiCheck'
import { finalVerdict } from './aiCheckView'
import { problemLabel, sortCards } from './group'
import type { AiVerdict, CaseAttempt, StatuteMark } from './solve'
import { answerRefs, judgeStatutes, modelStatutes, statuteLabel, type StatuteRef } from './statuteCheck'
import type { Card } from './types'

/**
 * 사례형 오답노트 — 제출한 시도들의 조문 점검·AI 점검 결과에서 빠진 항목을 (문항 id, 항목 키) 단위로 모은다.
 * 순수 함수(DOM·Firestore 없음). 시도 읽기는 firebaseServices/caseAttempts 의 fetchSubmittedCaseAttempts.
 *
 * - 시도마다 최종 판정(직접 고친 값 우선)을 구해 제출 시각 순으로 쌓는다. AI '확인불가'는 건너뛴다
 * - 가장 최근 판정이 ✕·△ 면 빠짐, ✓ 면 해결됨(목록에서 빠진다)
 * - 항목 글은 현재 카드에서 다시 뽑는다. 현재 카드에 없는 키는 결과에서 빼고 개수만 센다(저장 데이터는 그대로)
 */

export type MissKind = 'statute' | 'case' | 'res'
export type MissVerdict = 'missing' | 'partial' // ✕(없음/누락) · △(부분)
type Verdict = MissVerdict | 'ok'

export interface MissItem {
  problemId: string
  key: string // 조문: statuteKey, 판례 취지·결론: AI 항목 키
  kind: MissKind
  subject: string
  cardId: string
  cardTitle: string
  problemLabel: string // '변시 15회 제1문 문1'
  label: string // '민법 제750조' 또는 '판례 취지'·'결론'
  text: string // 현재 카드의 모범답안 문장(조문은 처음 나오는 문단)
  missCount: number // ✕·△ 였던 시도 수
  lastMissedAt: number
  lastVerdict: MissVerdict
  lastOkAt?: number // 마지막으로 ✓ 였던 시각(있을 때만)
  evidence: string // AI: 가장 최근 시도가 내 답안에서 옮긴 문장. 조문은 ''
  note: string // AI: 가장 최근 시도의 note. 조문: '답안에 해당 조문이 없음' / '답안에 해당 조문이 일부만 있음'
}

export interface MissResult {
  items: MissItem[] // 빠짐만. 카드 순서(과목 → 교재 순서 → 문항 → 조문, 판례·결론)
  resolved: number // 해결된 항목 수(표시하지 않는다)
  excluded: number // 빠짐인데 현재 카드에서 키를 찾지 못해 뺀 항목 수
}

const KIND_LABEL = { case: '판례 취지', res: '결론' }
const STATUTE_NOTE: Record<MissVerdict, string> = { missing: '답안에 해당 조문이 없음', partial: '답안에 해당 조문이 일부만 있음' }
const AI_TO: Record<AiVerdict, Verdict | null> = { 담김: 'ok', 부분: 'partial', 누락: 'missing', 확인불가: null }

const submittedAt = (a: CaseAttempt) => a.submittedAt ?? a.updatedAt

interface Mark {
  at: number
  v: Verdict
  evidence: string
  note: string
}

/**
 * sanitize: 화면과 같은 sanitizer(sanitizeCaseHtml)를 넘겨야 AI 항목 키(블록 글자 해시)가 화면과 맞는다.
 * 순수하게 두려고 인자로 받는다(기본은 그대로)
 */
export function aggregateMisses(
  attempts: CaseAttempt[],
  cards: Card[],
  sanitize: (html: string) => string = (h) => h
): MissResult {
  const where = new Map<string, { card: Card; p: Card['problems'][number] }>()
  // sortCards 는 넘긴 카드 객체를 순서만 바꿔 돌려준다
  for (const card of sortCards(cards) as unknown as Card[]) for (const p of card.problems) if (p.answer?.blocks.length) where.set(p.id, { card, p })

  // 문항마다 한 번만 뽑는다
  const infoCache = new Map<string, ReturnType<typeof infoOf>>()
  function infoOf(pid: string) {
    const w = where.get(pid)!
    const clean = w.p.answer!.blocks.map((b) => sanitize(b.html))
    const model = modelStatutes(clean)
    const statute = new Map<string, { ref: StatuteRef; block: number }>()
    for (const { key, ref } of model.items) {
      const block = model.marks.findIndex((ms) => ms.some((keys) => keys.includes(key)))
      statute.set(key, { ref, block })
    }
    const ai = new Map<string, AiCheckItem>(extractAiItems(clean).map((it) => [it.key, it]))
    return { clean, model, statute, ai }
  }
  const info = (pid: string) => {
    if (!infoCache.has(pid)) infoCache.set(pid, infoOf(pid))
    return infoCache.get(pid)!
  }

  // (문항 id, 종류, 키) → 판정 기록. stale = 현재 카드에 없는 키
  const live = new Map<string, { pid: string; kind: MissKind; key: string; marks: Mark[] }>()
  const stale = new Map<string, Mark[]>()
  const push = (pid: string, kind: MissKind, key: string, m: Mark, known: boolean) => {
    const id = `${pid}\u0001${kind}\u0001${key}`
    if (!known) return void (stale.get(id) ?? stale.set(id, []).get(id)!).push(m)
    const e = live.get(id) ?? live.set(id, { pid, kind, key, marks: [] }).get(id)!
    e.marks.push(m)
  }

  const done = attempts.filter((a) => a.status === 'submitted').sort((a, b) => submittedAt(a) - submittedAt(b))
  for (const a of done) {
    const at = submittedAt(a)
    for (const { problemId: pid, boxes } of a.answers) {
      const known = where.has(pid)
      const st = a.statuteChecks?.[pid]
      const manual = st?.manual ?? {}
      // 조문: 화면과 같이 직접 고친 값 ?? 지금 카드로 낸 자동 판정
      if (known) {
        const { model, statute } = info(pid)
        const auto = judgeStatutes(model.items, answerRefs(boxes))
        for (const key of statute.keys()) push(pid, 'statute', key, { at, v: manual[key] ?? auto[key] ?? 'missing', evidence: '', note: '' }, true)
      }
      // 저장된 조문 키 중 지금 카드에 없는 것(카드가 고쳐짐)
      for (const key of new Set([...Object.keys(st?.auto ?? {}), ...Object.keys(manual)])) {
        if (known && info(pid).statute.has(key)) continue
        const v: StatuteMark = manual[key] ?? st!.auto[key] ?? 'missing'
        push(pid, 'statute', key, { at, v, evidence: '', note: '' }, false)
      }
      // AI: 점검한 항목만. 확인불가는 건너뛴다
      for (const [key, r] of Object.entries(a.aiChecks?.[pid]?.items ?? {})) {
        const v = AI_TO[finalVerdict(r)]
        if (!v) continue
        const it = known ? info(pid).ai.get(key) : undefined
        const kind: MissKind = it?.kind ?? (/:case:\d+-\d+$/.test(key) ? 'case' : 'res')
        push(pid, kind, key, { at, v, evidence: r.evidence, note: r.note }, !!it)
      }
    }
  }

  const items: MissItem[] = []
  let resolved = 0
  for (const { pid, kind, key, marks } of live.values()) {
    const last = marks[marks.length - 1]
    if (last.v === 'ok') {
      resolved++
      continue
    }
    const { card, p } = where.get(pid)!
    const { clean, statute, ai } = info(pid)
    const misses = marks.filter((m) => m.v !== 'ok')
    const okAt = marks.filter((m) => m.v === 'ok').pop()?.at
    const s = kind === 'statute' ? statute.get(key)! : null
    items.push({
      problemId: pid,
      key,
      kind,
      subject: card.subject,
      cardId: card.id,
      cardTitle: card.title,
      problemLabel: problemLabel(p),
      label: s ? statuteLabel(s.ref) : KIND_LABEL[kind as 'case' | 'res'],
      text: s ? (s.block >= 0 ? parseBlockHtml(clean[s.block]).text : '') : ai.get(key)!.text,
      missCount: misses.length,
      lastMissedAt: last.at,
      lastVerdict: last.v,
      ...(okAt !== undefined ? { lastOkAt: okAt } : {}),
      evidence: s ? '' : last.evidence,
      note: s ? STATUTE_NOTE[last.v] : last.note,
    })
  }
  // 카드 순서대로: where 는 sortCards 순서로 채웠다. 같은 문항 안에서는 조문 → 판례·결론, 각자 처음 나온 순서
  const rank = new Map([...where.keys()].map((pid, i) => [pid, i]))
  const order = (x: MissItem) => rank.get(x.problemId)! * 2 + (x.kind === 'statute' ? 0 : 1)
  items.sort((a, b) => order(a) - order(b)) // 안정 정렬이라 같은 문항·같은 무리 안은 넣은 순서

  const excluded = [...stale.values()].filter((ms) => ms[ms.length - 1].v !== 'ok').length
  return { items, resolved, excluded }
}

// ── 정렬·필터·트리 ───────────────────────────────────────────

export type MissSort = 'recent' | 'count'

/** 최근 빠진 시각 순(기본) 또는 빠진 횟수 순(같으면 최근 순). 새 배열 */
export function sortMisses(items: MissItem[], by: MissSort = 'recent'): MissItem[] {
  return [...items].sort((a, b) =>
    by === 'count' ? b.missCount - a.missCount || b.lastMissedAt - a.lastMissedAt : b.lastMissedAt - a.lastMissedAt
  )
}

export type MissPeriod = 7 | 30 | 'all'

/** 과목(카드 subject), 종류, 기간(최근 빠진 시각 기준 최근 n일) */
export function filterMisses(
  items: MissItem[],
  f: { subject?: string; kind?: MissKind; period?: MissPeriod; now?: number }
): MissItem[] {
  const since = f.period && f.period !== 'all' ? (f.now ?? Date.now()) - f.period * 86_400_000 : -Infinity
  return items.filter(
    (x) => (!f.subject || x.subject === f.subject) && (!f.kind || x.kind === f.kind) && x.lastMissedAt >= since
  )
}

export interface MissTree {
  subject: string
  cards: { cardId: string; cardTitle: string; problems: { problemId: string; problemLabel: string; items: MissItem[] }[] }[]
}

/** 과목 → 카드(논점) → 문항 → 항목. 넘긴 순서대로 처음 나온 순서를 지킨다 */
export function missTree(items: MissItem[]): MissTree[] {
  const out: MissTree[] = []
  for (const x of items) {
    let s = out.find((t) => t.subject === x.subject)
    if (!s) out.push((s = { subject: x.subject, cards: [] }))
    let c = s.cards.find((t) => t.cardId === x.cardId)
    if (!c) s.cards.push((c = { cardId: x.cardId, cardTitle: x.cardTitle, problems: [] }))
    let p = c.problems.find((t) => t.problemId === x.problemId)
    if (!p) c.problems.push((p = { problemId: x.problemId, problemLabel: x.problemLabel, items: [] }))
    p.items.push(x)
  }
  return out
}

/** 시도에 나오는 문항이 든 카드 id 들(문항 id = '{카드 id}#{번호}') — 카드를 읽어 올 때 쓴다 */
export const cardIdsOf = (attempts: CaseAttempt[]) =>
  [...new Set(attempts.flatMap((a) => a.problemIds.map((pid) => pid.split('#')[0])))]
