'use client'

import type { Question, Subject, ExamType, ErrorAnalysis, QuestionStatus } from './types'

const RETRY_DELAY_MS = 3000
const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 503(모델 과부하) 발생 시 3초 대기 후 최대 3회 재시도
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 503 || attempt >= MAX_RETRIES) return res
    await sleep(RETRY_DELAY_MS)
  }
}

// ── Upload PDF via server proxy ──────────────────────────────────────────────
export async function uploadPdfToFileApi(
  apiKey: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  onProgress?.(10)

  const form = new FormData()
  form.append('file', file)
  form.append('apiKey', apiKey)

  const res = await fetchWithRetry('/api/upload', { method: 'POST', body: form })

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
  year: number
): Promise<Question[]> {
  const res = await fetchWithRetry('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, mode: 'extract', fileUri, subject, examType, year }),
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
    선지별설명?: Record<string, string> | null
  }[]

  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = (raw as string).match(/\[[\s\S]*\]/)
    parsed = match ? JSON.parse(match[0]) : []
  }

  const LABELS = ['①', '②', '③', '④', '⑤']

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
    choiceExplanations: item.선지별설명 ?? undefined,
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
  chunkIndex: number // 마지막으로 성공한 청크 인덱스 (0-based). 이어서 처리 시 chunkIndex + 1부터 재시작
  chunkTotal: number
  totalAdded: number
  totalMerged: number
  fileQuestionCount: number
}

export function savePdfProgress(sourceFile: string, progress: PdfParseProgress) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${PDF_PROGRESS_PREFIX}${sourceFile}`, JSON.stringify(progress))
  } catch (e) {
    console.error('[gemini] PDF 진행상황 저장 실패', e)
  }
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
