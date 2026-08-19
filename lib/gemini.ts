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

// 503(모델 과부하) 발생 시 3초 대기 후 최대 3회 재시도.
// 중단된 경우 fetch가 AbortError를 던지므로 재시도 없이 그대로 전파된다
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 503 || attempt >= MAX_RETRIES) return res
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(RETRY_DELAY_MS)
  }
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

  const { raw } = await res.json()

  let parsed: {
    문제번호: number
    연도?: number
    단원?: string
    지문: string
    선지: Record<string, string>
    정답: string
    해설: string | null
    보기정답?: Record<string, boolean> | null
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
    const match = (raw as string).match(/\[[\s\S]*\]/)
    parsed = match ? JSON.parse(match[0]) : []
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

  return parsed.map((item) => ({
    id: `${subject}_${examType}_${year}_${item.문제번호}_${Date.now()}`,
    no: item.문제번호,
    subject,
    examType,
    year: item.연도 ?? year,  // AI가 추출한 연도 우선, 없으면 fallback
    unit: item.단원 ?? undefined,
    passage: item.지문,
    choices: LABELS.map((l) => ({ label: l, text: item.선지?.[l] ?? '' })),
    answer: item.정답,
    explanation: item.해설,
    addedAt: Date.now(),
    subChoiceAnswers: item.보기정답 ?? undefined,
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

  const { raw } = await res.json()

  try {
    return JSON.parse(raw) as ErrorAnalysis
  } catch {
    const match = (raw as string).match(/\{[\s\S]*\}/)
    return match ? (JSON.parse(match[0]) as ErrorAnalysis) : fallbackAnalysis()
  }
}

function fallbackAnalysis(): ErrorAnalysis {
  return {
    핵심개념: '분석 실패',
    관련조문: '-',
    오답원인: { 가설A: '-', 가설B: '-', 가설C: '-' },
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
