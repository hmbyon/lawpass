import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// 함수가 플랫폼 제한(maxDuration)에 걸려 죽으면 응답 본문이 우리 것이 아니게 된다.
// 그러면 클라이언트는 JSON 대신 HTML을 받아 "Gateway Timeout"이라는 정체불명 오류만 보고,
// 재시도할지 쪼갤지 판단할 근거를 잃는다. 그래서 제한보다 넉넉히 앞선 시점에 우리가 먼저 응답한다.
// 예전에는 폴링 예산(30회 × 2초 = 60초)이 maxDuration과 같아서 우리 504는 도달조차 못 했다
const BUDGET_MS = 45_000
// 대부분의 청크는 1~3초면 ACTIVE가 된다. 그 흔한 경우까지 왕복을 한 번 더 시키지 않도록
// 서버에서 잠깐만 기다려 보고, 그 안에 안 되면 브라우저에게 넘긴다 (브라우저에는 시간 제한이 없다)
const GRACE_MS = 8_000
const POLL_INTERVAL_MS = 1_500

const BASE = 'https://generativelanguage.googleapis.com'

type FileState = 'ACTIVE' | 'PROCESSING' | 'FAILED' | string

async function fetchState(apiKey: string, fileUri: string): Promise<FileState> {
  const fileName = fileUri.split('/').pop()
  const res = await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`)
  if (!res.ok) throw new Error(`Failed to check file state (${res.status})`)
  const data = await res.json()
  return (data?.state as FileState) ?? 'PROCESSING'
}

// deadline까지만 ACTIVE를 기다린다. 시간이 다하면 예외 대신 마지막 상태를 돌려주고,
// 판단(더 기다릴지 / 포기할지)은 호출부에 맡긴다
async function pollUntilActive(apiKey: string, fileUri: string, deadline: number): Promise<FileState> {
  let state: FileState = 'PROCESSING'
  while (Date.now() < deadline) {
    state = await fetchState(apiKey, fileUri)
    if (state === 'ACTIVE' || state === 'FAILED') return state
    if (Date.now() + POLL_INTERVAL_MS >= deadline) break
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return state
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const formData = await req.formData()
    const apiKey = formData.get('apiKey') as string | null
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
    }

    // ── 상태 확인 모드: 업로드는 이미 끝났고 ACTIVE가 됐는지만 묻는다 ──
    // 브라우저가 이 모드를 반복 호출하며 기다린다. 한 번 호출이 1초 남짓이라 함수 제한과 무관하다
    const pendingUri = formData.get('fileUri') as string | null

    // ── 삭제 모드: 그 청크를 다 쓰고 나서 올린 쪽이 정리한다 ──
    // 예전에는 /api/analyze가 분석 직후에 지웠는데, 한 파일로 과목·시험구분 조합만큼
    // 분석을 돌리는 통에 두 번째 호출부터 403(없는 파일)이 났다
    if (pendingUri && formData.get('action') === 'delete') {
      const fileName = pendingUri.split('/').pop()
      const res = await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`, { method: 'DELETE' })
      // 이미 지워졌으면 404가 온다. 정리 작업이라 그것도 성공으로 친다
      return NextResponse.json({ deleted: res.ok || res.status === 404 })
    }

    if (pendingUri) {
      const state = await fetchState(apiKey, pendingUri)
      return NextResponse.json({ fileUri: pendingUri, state })
    }

    // ── 업로드 모드 ──
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

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
      return NextResponse.json({ error: `File API init failed: ${err}` }, { status: 502 })
    }

    const uploadUrl = initRes.headers.get('X-Goog-Upload-URL')
    if (!uploadUrl) {
      return NextResponse.json({ error: 'No upload URL returned from Gemini' }, { status: 502 })
    }

    // 2. Upload in chunks (5 MB)
    const CHUNK = 5 * 1024 * 1024
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    let offset = 0
    let fileUri = ''

    while (offset < buffer.byteLength) {
      const end = Math.min(offset + CHUNK, buffer.byteLength)
      const chunk = buffer.subarray(offset, end)
      const isLast = end >= buffer.byteLength
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
        return NextResponse.json({ error: `Chunk upload failed: ${err}` }, { status: 502 })
      }

      if (isLast) {
        const data = await chunkRes.json()
        fileUri = data?.file?.uri ?? ''
      }

      offset = end
    }

    if (!fileUri) {
      return NextResponse.json({ error: 'No fileUri returned after upload' }, { status: 502 })
    }

    // 3. 잠깐만 ACTIVE를 기다려 본다.
    // 여기서 오래 붙잡고 있으면 함수가 제한에 걸려 죽으므로, 남은 예산과 grace 중 짧은 쪽만 쓴다
    const deadline = Math.min(startedAt + BUDGET_MS, Date.now() + GRACE_MS)
    const state = await pollUntilActive(apiKey, fileUri, deadline)

    if (state === 'FAILED') {
      return NextResponse.json({ error: 'Gemini file processing failed', fileUri }, { status: 502 })
    }

    // ★업로드 자체는 성공했다. 아직 ACTIVE가 아닐 뿐이므로 오류가 아니다.
    // fileUri를 함께 돌려줘 브라우저가 상태 확인 모드로 이어서 기다리게 한다.
    // 예전에는 이 상황을 504로 내려보내 업로드 결과를 통째로 버렸다
    return NextResponse.json({ fileUri, state }, { status: state === 'ACTIVE' ? 200 : 202 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
