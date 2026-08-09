'use client'

import type { Question, Subject, ExamType, ErrorAnalysis, QuestionStatus } from './types'

const BASE = 'https://generativelanguage.googleapis.com'

// ── Upload PDF directly from browser to Gemini File API ──────────────────────
export async function uploadPdfToFileApi(
  apiKey: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  onProgress?.(5)

  // 1. Initiate resumable upload
  const initRes = await fetch(
    `${BASE}/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': 'application/pdf',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    }
  )

  if (!initRes.ok) {
    const err = await initRes.text()
    throw new Error(`File API init failed: ${err}`)
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) throw new Error('No upload URL returned')

  // 2. Upload in chunks (5 MB each)
  const CHUNK = 5 * 1024 * 1024
  let offset = 0
  let fileUri = ''

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size)
    const chunk = file.slice(offset, end)
    const isLast = end >= file.size
    const command = isLast ? 'upload, finalize' : 'upload'

    const chunkRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': command,
        'X-Goog-Upload-Offset': String(offset),
        'Content-Length': String(end - offset),
        'Content-Type': 'application/pdf',
      },
      body: chunk,
    })

    if (!chunkRes.ok) {
      const err = await chunkRes.text()
      throw new Error(`Chunk upload failed: ${err}`)
    }

    offset = end
    onProgress?.(Math.round((offset / file.size) * 80))

    if (isLast) {
      const data = await chunkRes.json()
      fileUri = data?.file?.uri ?? ''
    }
  }

  if (!fileUri) throw new Error('No file URI returned after upload')

  // 3. Wait for ACTIVE
  onProgress?.(85)
  const fileName = fileUri.split('/').pop()
  for (let i = 0; i < 30; i++) {
    const stateRes = await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`)
    if (!stateRes.ok) throw new Error('Failed to check file state')
    const stateData = await stateRes.json()
    if (stateData.state === 'ACTIVE') {
      onProgress?.(100)
      return fileUri
    }
    if (stateData.state === 'FAILED') throw new Error('Gemini file processing failed')
    await new Promise((r) => setTimeout(r, 2000))
  }

  throw new Error('File did not become ACTIVE in time')
}

// ── waitForFileActive & deleteFile ───────────────────────────────────────────
export async function waitForFileActive(_apiKey: string, _fileUri: string): Promise<void> {
  // No-op: handled inside uploadPdfToFileApi
}

export async function deleteFile(apiKey: string, fileUri: string): Promise<void> {
  const fileName = fileUri.split('/').pop()
  await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`, { method: 'DELETE' }).catch(() => { })
}

// ── Parse questions from PDF via server proxy ────────────────────────────────
export async function extractQuestionsFromPdf(
  apiKey: string,
  fileUri: string,
  subject: Subject,
  examType: ExamType,
  year: number
): Promise<Question[]> {
  const res = await fetch('/api/analyze', {
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
    지문: string
    선지: Record<string, string>
    정답: string
    해설: string | null
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
    year,
    passage: item.지문,
    choices: LABELS.map((l) => ({ label: l, text: item.선지?.[l] ?? '' })),
    answer: item.정답,
    explanation: item.해설,
    addedAt: Date.now(),
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
  const res = await fetch('/api/analyze', {
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