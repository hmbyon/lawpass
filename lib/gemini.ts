'use client'

import type { Question, SubItem, ExplanationBlock, TableBlock, Subject, ExamType, ErrorAnalysis, QuestionStatus } from './types'

const RETRY_DELAY_MS = 3000
const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 사용자가 중단(AbortController.abort)해서 끝난 요청인지 판별
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// 503(모델 과부하)과 429(rate limit) 발생 시 재시도.
// 429는 동시 요청이 많을 때 나므로 지수 백오프로 간격을 벌린다.
// 중단된 경우 fetch가 AbortError를 던지므로 재시도 없이 그대로 전파된다
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init)
    const retryable = res.status === 503 || res.status === 429
    if (!retryable || attempt >= MAX_RETRIES) return res
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // 503은 고정 간격, 429는 2배씩 늘려 한도가 회복될 시간을 준다
    const delay = res.status === 429 ? RETRY_DELAY_MS * 2 ** attempt : RETRY_DELAY_MS
    await sleep(delay)
  }
}

// 동시 실행 수를 제한하며 순서를 보존해 매핑한다.
// 무제한 Promise.all은 오답이 많을 때 429를 유발하므로 워커 풀로 제한한다
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onSettled?: (completed: number, total: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let completed = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
      completed++
      onSettled?.(completed, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// 본문이 끝까지 오지 않으면 res.json()이 브라우저마다 다른 문구의 SyntaxError를 던진다.
// (Safari는 잘린 위치에 따라 "Property name must be a string literal"처럼 원인과 무관한 문구를 낸다)
// 어느 호출의 응답이 몇 자에서 깨졌는지 남겨 원인을 짚을 수 있게 한다
async function readJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      `${what} 응답을 읽지 못했습니다 (받은 길이 ${text.length}자). 통신이 중간에 끊겼을 수 있습니다.`
    )
  }
}

// AI가 돌려준 JSON 자체가 깨졌을 때 쓰는 오류 문구. 응답 끝부분을 붙여 어디서 끊겼는지 보여준다
function badJsonError(raw: string): Error {
  const tail = raw.slice(-120).replace(/\s+/g, ' ')
  return new Error(
    `AI 응답을 JSON으로 읽지 못했습니다 (길이 ${raw.length}자). 중간에서 잘렸을 가능성이 큽니다. 끝부분: …${tail}`
  )
}

// ── Upload PDF via server proxy ──────────────────────────────────────────────
export async function uploadPdfToFileApi(
  apiKey: string,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<string> {
  onProgress?.(10)

  const form = new FormData()
  form.append('file', file)
  form.append('apiKey', apiKey)

  const res = await fetchWithRetry('/api/upload', { method: 'POST', body: form, signal })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(data?.error ?? `Upload failed (${res.status})`)
  }

  const data = await res.json()
  if (!data.fileUri) throw new Error('No fileUri returned from upload API')

  onProgress?.(100)
  return data.fileUri as string
}

// ── waitForFileActive & deleteFile ───────────────────────────────────────────
export async function waitForFileActive(_apiKey: string, _fileUri: string): Promise<void> {
  // No-op: handled server-side in /api/upload
}

export async function deleteFile(_apiKey: string, _fileUri: string): Promise<void> {
  // No-op: handled server-side in /api/analyze
}

// ── Parse questions from PDF via server proxy ────────────────────────────────
export async function extractQuestionsFromPdf(
  apiKey: string,
  fileUri: string,
  subject: Subject,
  examType: ExamType,
  year: number,
  signal?: AbortSignal
): Promise<Question[]> {
  const res = await fetchWithRetry('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, mode: 'extract', fileUri, subject, examType, year }),
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(data?.error ?? `Analyze failed (${res.status})`)
  }

  const { raw } = await readJson<{ raw: string }>(res, '문제 추출')

  let parsed: {
    문제번호: number
    연도?: number
    단원?: string
    지문: string
    선지: Record<string, string>
    정답: string
    해설: string | null
    보기정답?: Record<string, boolean> | null
    선지정오?: Record<string, boolean> | null
    선지별설명?: Record<string, string | { type?: string; title?: string; content?: string }[]> | null
    선지별설명요약?: Record<string, string> | null
    보기별설명?: Record<string, string> | null
    표서식?: { title?: string; rows?: ({ cells?: unknown[] } | unknown[])[] }[] | null
    보기목록?: {
      label?: string
      text?: string
      isCorrect?: boolean
      explanation?: string | { type?: string; title?: string; content?: string }[]
      explanationSummary?: string
    }[] | null
  }[]

  try {
    parsed = JSON.parse(raw)
  } catch {
    // 모델이 JSON 앞뒤에 설명을 붙였을 때를 위한 구제 시도.
    // 여기서도 실패하면 조용히 []를 돌려주면 안 된다 — 그 청크의 문제가 통째로 사라진 채
    // '완료'로 기록돼 재개해도 복구되지 않는다. 오류로 던져 청크를 다시 처리할 수 있게 남긴다
    const match = (raw as string).match(/\[[\s\S]*\]/)
    if (!match) throw badJsonError(raw)
    try {
      parsed = JSON.parse(match[0])
    } catch {
      throw badJsonError(raw)
    }
  }

  const LABELS = ['①', '②', '③', '④', '⑤']

  // 해설을 항상 블록 배열로 정규화한다. 옛 형식(문자열)으로 와도 단일 text 블록으로 취급
  function toExplanationBlocks(raw: unknown): ExplanationBlock[] {
    if (typeof raw === 'string') {
      const content = raw.trim()
      return content ? [{ type: 'text', content }] : []
    }
    if (!Array.isArray(raw)) return []
    return raw
      .map((b) => {
        const content = String((b as { content?: unknown })?.content ?? '').trim()
        const title = String((b as { title?: unknown })?.title ?? '').trim()
        const type: ExplanationBlock['type'] =
          (b as { type?: unknown })?.type === 'lawBox' ? 'lawBox' : 'text'
        const block: ExplanationBlock = { type, content }
        if (type === 'lawBox' && title) block.title = title
        return block
      })
      .filter((b) => b.content)
  }

  // 표/서식 정규화. 행이 배열로 와도({cells} 없이) 받아들이고, 빈 칸·빈 행은 걸러낸다
  function toPassageTables(raw: typeof parsed[number]['표서식']): TableBlock[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const tables = raw
      .map((t) => {
        const rows = (Array.isArray(t?.rows) ? t.rows : [])
          .map((r) => {
            const rawCells = Array.isArray(r) ? r : (r as { cells?: unknown[] })?.cells
            const cells = (Array.isArray(rawCells) ? rawCells : [])
              .map((c) => String(c ?? '').trim())
            return { cells }
          })
          .filter((r) => r.cells.some((c) => c))
        const title = String(t?.title ?? '').trim()
        const table: TableBlock = { rows }
        if (title) table.title = title
        return table
      })
      .filter((t) => t.rows.length > 0)
    return tables.length > 0 ? tables : undefined
  }

  // 선지별 해설도 같은 블록 구조로 정규화한다 (옛 형식인 문자열은 단일 text 블록으로)
  function toChoiceExplanations(
    raw: typeof parsed[number]['선지별설명']
  ): Record<string, ExplanationBlock[]> | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const result: Record<string, ExplanationBlock[]> = {}
    for (const [label, value] of Object.entries(raw)) {
      const blocks = toExplanationBlocks(value)
      if (blocks.length > 0) result[label] = blocks
    }
    return Object.keys(result).length > 0 ? result : undefined
  }

  // 라벨과 본문이 모두 있는 항목만 취한다 (라벨은 원본 표기 그대로 유지)
  function toSubItems(raw: typeof parsed[number]['보기목록']): SubItem[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const items = raw
      .map((it) => ({
        label: String(it?.label ?? '').trim(),
        text: String(it?.text ?? '').trim(),
        isCorrect: Boolean(it?.isCorrect),
        explanation: toExplanationBlocks(it?.explanation),
        explanationSummary: String(it?.explanationSummary ?? '').trim() || undefined,
      }))
      .filter((it) => it.label && it.text)
    return items.length > 0 ? items : undefined
  }

  // AI가 연도를 확인하지 못하면 null을 준다. 이때 '오늘 연도'로 채우면
  // 존재하지도 않는 회차의 기출이 만들어지고, 그 값이 특정 한 해로 쏠린다.
  // 0(연도 미상)으로 남겨 파싱 검토 화면에서 눈에 띄게 하고 사람이 고치게 한다
  const resolveYear = (raw: number | null | undefined): number =>
    typeof raw === 'number' && raw >= 1900 && raw <= 2100 ? raw : 0

  return parsed.map((item) => ({
    // id에는 실제 판정된 연도를 쓴다. 폴백 연도(호출 시점의 올해)를 박으면
    // year 필드가 2023인데 id에는 2026이 들어가 데이터가 어긋난다
    id: `${subject}_${examType}_${resolveYear(item.연도)}_${item.문제번호}_${Date.now()}`,
    no: item.문제번호,
    subject,
    examType,
    year: resolveYear(item.연도),
    unit: item.단원 ?? undefined,
    passage: item.지문,
    choices: LABELS.map((l) => ({ label: l, text: item.선지?.[l] ?? '' })),
    answer: item.정답,
    explanation: item.해설,
    addedAt: Date.now(),
    subChoiceAnswers: item.보기정답 ?? undefined,
    choiceIsCorrectStatement: item.선지정오 ?? undefined,
    choiceExplanations: toChoiceExplanations(item.선지별설명),
    choiceExplanationSummaries: item.선지별설명요약 ?? undefined,
    subChoiceExplanations: item.보기별설명 ?? undefined,
    subItems: toSubItems(item.보기목록),
    passageTable: toPassageTables(item.표서식),
  }))
}

// ── Error analysis via server proxy ─────────────────────────────────────────
export async function analyzeWrongAnswer(
  apiKey: string,
  question: Question,
  userAnswer: string,
  questionStatus: QuestionStatus,
  isStudyMode: boolean
): Promise<ErrorAnalysis> {
  const res = await fetchWithRetry('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      mode: 'error',
      question: {
        subject: question.subject,
        passage: question.passage,
        choices: question.choices,
        answer: question.answer,
        explanation: question.explanation ?? null,
      },
      userAnswer,
      questionStatus,
      isStudyMode,
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(data?.error ?? `Error analysis failed (${res.status})`)
  }

  const { raw } = await readJson<{ raw: string }>(res, '오답 분석')

  try {
    return JSON.parse(raw) as ErrorAnalysis
  } catch {
    // 오답 분석은 실패해도 학습을 막지 않는다. 문제 추출과 달리 여기서는 대체값을 쓴다
    const match = (raw as string).match(/\{[\s\S]*\}/)
    if (!match) return fallbackAnalysis()
    try {
      return JSON.parse(match[0]) as ErrorAnalysis
    } catch {
      return fallbackAnalysis()
    }
  }
}

function fallbackAnalysis(): ErrorAnalysis {
  return {
    핵심개념: '분석 실패',
    관련조문: '-',
    오답원인: { 판정: 'C', 원인명: '분석 실패', 상세분석: '-' },
    원인상세: '분석 중 오류가 발생했습니다.',
    개념요약: '-',
    혼동주의: '-',
    체크포인트: '-',
    위험도: 3,
  }
}

// ── PDF 파싱 이어서 처리 (청크 단위 진행상황 임시 저장) ──────────────────────
const PDF_PROGRESS_PREFIX = 'lawpass_pdf_progress_'

export interface PdfParseProgress {
  chunkIndex: number // 마지막으로 성공한 청크 인덱스 (0-based). 이어서 처리 시 chunkIndex + 1부터 재시작. 아직 없으면 -1
  chunkTotal: number
  totalAdded: number
  totalMerged: number
  fileQuestionCount: number
  // 새로고침 후 재개 UI를 복원하기 위한 정보 (옛 기록에는 없을 수 있어 전부 optional)
  fileName?: string // 원본 PDF 파일명 (재선택 시 대조용)
  pageCount?: number
  chunkSize?: number // 이 파일에 적용된 청크 페이지 수. 재개 시 같은 값을 써야 청크 번호가 가리키는 페이지가 어긋나지 않는다
  subjects?: string[] // 중단 시점에 선택돼 있던 과목 — 복원하지 않으면 재개가 0문제로 헛돈다
  examTypes?: string[]
  updatedAt?: number
}

export function savePdfProgress(sourceFile: string, progress: PdfParseProgress) {
  if (typeof window === 'undefined') return
  try {
    const record: PdfParseProgress = { ...progress, updatedAt: Date.now() }
    localStorage.setItem(`${PDF_PROGRESS_PREFIX}${sourceFile}`, JSON.stringify(record))
  } catch (e) {
    console.error('[gemini] PDF 진행상황 저장 실패', e)
  }
}

// 저장된 모든 진행상황 조회 (새로고침 후 "이어서 처리 대기 중" 목록 복원용)
export function listPdfProgress(): { sourceFile: string; progress: PdfParseProgress }[] {
  if (typeof window === 'undefined') return []
  const items: { sourceFile: string; progress: PdfParseProgress }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PDF_PROGRESS_PREFIX)) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      items.push({ sourceFile: key.slice(PDF_PROGRESS_PREFIX.length), progress: JSON.parse(raw) as PdfParseProgress })
    } catch {
      // 손상된 기록은 무시
    }
  }
  return items.sort((a, b) => (b.progress.updatedAt ?? 0) - (a.progress.updatedAt ?? 0))
}

export function getPdfProgress(sourceFile: string): PdfParseProgress | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${PDF_PROGRESS_PREFIX}${sourceFile}`)
    return raw ? (JSON.parse(raw) as PdfParseProgress) : null
  } catch {
    return null
  }
}

export function clearPdfProgress(sourceFile: string) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(`${PDF_PROGRESS_PREFIX}${sourceFile}`)
}
