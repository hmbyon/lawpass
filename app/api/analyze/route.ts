import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://generativelanguage.googleapis.com'
const MODEL = 'gemini-3.1-flash-lite'

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

      if (!fileUri || !subject || !examType) {
        return NextResponse.json(
          { error: 'fileUri, subject, examType, year are required for extract mode' },
          { status: 400 }
        )
      }

      const prompt = `당신은 변호사시험 문제 추출 전문가입니다.
이 PDF에서 모든 문제를 추출하여 JSON 배열만 출력하세요.
각 항목 형식: {"문제번호": number, "연도": number, "단원": string, "지문": string, "선지": {"①": string, "②": string, "③": string, "④": string,"⑤": string}, "정답": string, "해설": string|null, "보기정답": {"ㄱ": boolean, "ㄴ": boolean, "ㄷ": boolean, "ㄹ": boolean}|null, "선지별설명": {"①": string, "②": string, "③": string, "④": string, "⑤": string}|null}
- 단원은 아래 목록에서 반드시 하나만 선택하세요:
  민법: 민법총칙, 물권법, 채권총론, 채권각론, 가족법
  민사소송법: 소송요건, 소송절차, 증거, 상소, 강제집행
  상법: 총칙, 회사법, 어음수표법, 보험법, 해상법
  형법: 총론, 각론, 특별형법
  형사소송법: 수사, 공소, 공판, 증거, 상소
  헌법: 총론, 기본권, 통치구조
  행정법: 총론, 각론
- PDF에 단원 표시가 없으면 문제 내용으로 추론하세요
- 연도는 PDF 표지나 문제에서 직접 읽어서 추출하세요 (예: "2023년도 제12회 변호사시험" → 2023). 찾을 수 없으면 ${subject} ${examType} 시험의 실제 연도를 추론하세요.
- 해설 추출 규칙:
  - "해설", "풀이", "정답해설", "[해설]" 등 다양한 표기를 모두 해설 시작 표시로 인식하세요
  - 해당 표시 다음부터 시작해, 다음 문제 번호(예: "문 2.", "2.")가 나오기 직전까지의 모든 텍스트를 그 문제의 해설로 추출하세요
  - 해설이 없으면 null
- 지문에 "ㄱ.", "ㄴ.", "ㄷ.", "ㄹ."로 시작하는 보기 항목이 있으면, 각 항목을 독립적으로 판단해 "보기정답"에 boolean으로 표시하세요.
  - 정답 선지(①~⑤ 중 어느 것이 정답인지)와는 무관하게, 각 ㄱ/ㄴ/ㄷ/ㄹ 진술 자체가 법적으로 옳은 문장인지(true) 옳지 않은 문장인지(false)를 판단하세요
  - 판단 근거가 부족하면 해당 항목은 생략
  - 보기 항목이 없으면 "보기정답"은 null
- "선지별설명"은 각 선지(①~⑤)가 왜 옳은지/틀린지를 한 줄로 설명하세요. 해설이나 지문 근거로 판단하기 어려우면 null.
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
        console.error('Gemini API error:', res.status, res.statusText, err)
        return NextResponse.json({ error: `Gemini generate failed: [${res.status}] ${err}` }, { status: 502 })
      }

      const data = await res.json()
      const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

      const fileName = fileUri.split('/').pop()
      fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {})

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
Step5. 위험도는 반드시 1~5 사이의 정수로만 출력 (예: 4)
Step6. JSON만 출력

Grounding Rule: 입력 자료 외 법률 내용 생성 금지. 불확실하면 "근거부족" 표시.

출력 형식:
{"핵심개념": string, "관련조문": string, "오답원인": {"가설A": string, "가설B": string, "가설C": string, "선학습적용실패": string|null}, "원인상세": string, "개념요약": string, "혼동주의": string, "체크포인트": string, "위험도": 1~5 사이의 정수}`

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
        console.error('Gemini API error:', res.status, res.statusText, err)
        return NextResponse.json({ error: `Gemini analyze failed: [${res.status}] ${err}` }, { status: 502 })
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