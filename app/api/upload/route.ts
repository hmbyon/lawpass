import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const BASE = 'https://generativelanguage.googleapis.com'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const apiKey = formData.get('apiKey') as string | null

    if (!file || !apiKey) {
      return NextResponse.json({ error: 'file and apiKey are required' }, { status: 400 })
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

    // 3. Wait for ACTIVE state (poll up to 60 s)
    const fileName = fileUri.split('/').pop()
    for (let i = 0; i < 30; i++) {
      const stateRes = await fetch(`${BASE}/v1beta/files/${fileName}?key=${apiKey}`)
      if (!stateRes.ok) {
        return NextResponse.json({ error: 'Failed to check file state' }, { status: 502 })
      }
      const stateData = await stateRes.json()
      if (stateData.state === 'ACTIVE') {
        return NextResponse.json({ fileUri })
      }
      if (stateData.state === 'FAILED') {
        return NextResponse.json({ error: 'Gemini file processing failed' }, { status: 502 })
      }
      await new Promise((r) => setTimeout(r, 2000))
    }

    return NextResponse.json({ error: 'File did not become ACTIVE in time' }, { status: 504 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}