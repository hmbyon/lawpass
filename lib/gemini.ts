'use client'

import type { Question, Subject, ExamType, ErrorAnalysis, QuestionStatus } from './types'

const BASE = 'https://generativelanguage.googleapis.com'

// ── File API Upload ──────────────────────────────────────────────────────────
export async function uploadPdfToFileApi(
  apiKey: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  // 1. initiate resumable upload
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

  // 2. upload in chunks (5 MB each)
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
      throw new Error(`File upload chunk failed: ${err}`)
    }

    offset = end
    onProgress?.(Math.round((offset / file.size) * 100))

    if (isLast) {
      const data = await chunkRes.json()
      fileUri = data?.file?.uri ?? ''
    }
  }

  if (!fileUri) throw new Error('No file URI returned after upload')
  return fileUri
}

// ── Wait for file to be ACTIVE ──────────────────────────────────────────────
export async function waitForFileActive(apiKey: string, fileUri: string): Promise<void> {
  const fileName = fileUri.split('/').pop()
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`)
    if (!res.ok) throw new Error('Failed to check file state')
    const data = await res.json()
    if (data.state === 'ACTIVE') return
    if (data.state === 'FAILED') throw new Error('File processing failed on Gemini side')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('File did not become ACTIVE in time')
}

// ── Delete file ──────────────────────────────────────────────────────────────
export async function deleteFile(apiKey: string, fileUri: string): Promise<void> {
  const fileName = fileUri.split('/').pop()
  await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`, { method: 'DELETE' })
}

// ── Parse questions from PDF ─────────────────────────────────────────────────
export async function extractQuestionsFromPdf(
  apiKey: string,
  fileUri: string,
  subject: Subject,
  examType: ExamType,
  year: number
): Promise<Question[]> {
  const prompt = `당신은 변호사시험 문제 추출 전문가입니다.
이 PDF에서 모든 문제를 추출하여 JSON 배열만 출력하세요.
각 항목 형식: {"문제번호": number, "지문": string, "선지": {"①": string, "②": string, "③": string, "④": string, "⑤": string}, "정답": string, "해설": string|null}
- 문제가 없으면 빈 배열 []
- PDF 내용 이외의 법률 내용을 절대 생성하지 마세요
- JSON 외 다른 텍스트 출력 금지`

  const res = await fetch(`${BASE}/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { file_data: { mime_type: 'application/pdf', file_uri: fileUri } },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini generate failed: ${err}`)
  }

  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

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
    const match = raw.match(/\[[\s\S]*\]/)
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

// ── Error analysis ──────────────────────────────────────────────────────────
export async function analyzeWrongAnswer(
  apiKey: string,
  question: Question,
  userAnswer: string,
  questionStatus: QuestionStatus,
  isStudyMode: boolean
): Promise<ErrorAnalysis> {
  const statusNote = isStudyMode
    ? '선학습 후 틀림 → 가설B 또는 C 가중'
    : questionStatus === '찍음'
      ? '찍음 → 가설A 가중'
      : questionStatus === '헷갈림'
        ? '헷갈림 → 가설B 가중'
        : '확신 오답 → 가설C 가중'

  const prompt = `당신은 변호사시험 출제위원 경력 20년의 학습 코치입니다.

[문제]
과목: ${question.subject}
지문: ${question.passage}
선지:
${question.choices.map((c) => `${c.label} ${c.text}`).join('\n')}
정답: ${question.answer}
수험생 선택: ${userAnswer}
수험생 상태: ${statusNote}
해설: ${question.explanation ?? '제공 없음'}

Step1. 핵심 개념/조문/판례 한 줄 정의
Step2. 정답과 오답 선지의 결정적 차이 분석
Step3. 가설A(개념부족)/B(암기혼동)/C(지문오독) 각각 평가
Step4. 상태값 참고하여 최종 원인 가중치 반영
Step5. JSON만 출력

Grounding Rule: 입력 자료 외 법률 내용 생성 금지. 불확실하면 "근거부족" 표시.

출력 형식:
{"핵심개념": string, "관련조문": string, "오답원인": {"가설A": string, "가설B": string, "가설C": string, "선학습적용실패": string|null}, "원인상세": string, "개념요약": string, "혼동주의": string, "체크포인트": string, "위험도": number}`

  const res = await fetch(`${BASE}/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini analyze failed: ${err}`)
  }

  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  try {
    return JSON.parse(raw) as ErrorAnalysis
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
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
