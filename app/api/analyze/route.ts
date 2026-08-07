import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://generativelanguage.googleapis.com'
const MODEL = 'gemini-2.5-flash-preview-05-20'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { apiKey, mode } = body as { apiKey: string; mode: 'extract' | 'error' }

    if (!apiKey || !mode) {
      return NextResponse.json({ error: 'apiKey and mode are required' }, { status: 400 })
    }

    // ── Mode: extract questions from uploaded PDF ─────────────────────────
    if (mode === 'extract') {
      const { fileUri, subject, examType, year } = body as {
        fileUri: string
        subject: string
        examType: string
        year: number
      }

      if (!fileUri || !subject || !examType || !year) {
        return NextResponse.json(
          { error: 'fileUri, subject, examType, year are required for extract mode' },
          { status: 400 }
        )
      }

      const prompt = `당신은 변호사시험 문제 추출 전문가입니다.
이 PDF에서 모든 문제를 추출하여 JSON 배열만 출력하세요.
각 항목 형식: {"문제번호": number, "지문": string, "선지": {"①": string, "②": string, "③": string, "④": string, "⑤": string}, "정답": string, "해설": string|null}
- 문제가 없으면 빈 배열 []
- PDF 내용 이외의 법률 내용을 절대 생성하지 마세요
- JSON 외 다른 텍스트 출력 금지`

      const res = await fetch(
        `${BASE}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
        {
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
        }
      )

      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: `Gemini generate failed: ${err}` }, { status: 502 })
      }

      const data = await res.json()
      const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

      // Delete the file after extraction (fire-and-forget)
      const fileName = fileUri.split('/').pop()
      fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`, { method: 'DELETE' }).catch(
        () => { }
      )

      return NextResponse.json({ raw, subject, examType, year })
    }

    // ── Mode: analyse a wrong answer ──────────────────────────────────────
    if (mode === 'error') {
      const { question, userAnswer, questionStatus, isStudyMode } = body as {
        question: {
          subject: string
          passage: string
          choices: { label: string; text: string }[]
          answer: string
          explanation: string | null
        }
        userAnswer: string
        questionStatus: string | null
        isStudyMode: boolean
      }

      if (!question || !userAnswer) {
        return NextResponse.json(
          { error: 'question and userAnswer are required for error mode' },
          { status: 400 }
        )
      }

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

      const res = await fetch(
        `${BASE}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
          }),
        }
      )

      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: `Gemini analyze failed: ${err}` }, { status: 502 })
      }

      const data = await res.json()
      const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

      return NextResponse.json({ raw })
    }

    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}