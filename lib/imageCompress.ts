/**
 * 첨부 이미지 압축.
 *
 * 도면 이미지는 Firestore 문서 하나에 base64 문자열로 통째로 들어간다. 문서 한도는 1MiB고,
 * 원본 캡쳐는 그것을 쉽게 넘긴다(맥 화면 캡쳐 한 장이 2~5MB). 그래서 **올리기 전에** 여기서
 * 줄인다. Storage(Blaze)를 쓰지 않는 한 이 단계는 선택이 아니다.
 *
 * 줄이는 순서:
 *  1. 긴 변을 1600px 로 맞춘다 (원본이 더 작으면 늘리지 않는다)
 *  2. JPEG 로 굽는다 — 화질 0.75 → 0.6 → 0.5 순으로, 600KB 아래로 들어갈 때까지
 *  3. 0.5 로도 안 들어가면 **더 뭉개지 않고 멈춘다.** 읽을 수 없게 만든 도면은 첨부하지 않은
 *     것보다 나쁘다. 사람이 원본을 잘라 다시 넣는 편이 낫다
 *
 * 크기는 인코딩 결과(blob)가 아니라 **data URL 문자열의 바이트 수**로 잰다. Firestore 에
 * 실제로 저장되는 것이 그 문자열이고, base64 는 원본보다 약 1.37배 크다 — blob 기준으로
 * 재면 한도를 통과한 줄 알고 1MiB 를 넘길 수 있다
 */

/** 긴 변의 최대 길이(px) */
export const MAX_EDGE = 1600
/** 저장될 data URL 문자열의 상한 (Firestore 문서 1MiB 한도 안쪽으로 넉넉히) */
export const TARGET_BYTES = 600_000
/** 시도할 JPEG 화질. 앞에서부터 차례로 굽는다 */
export const QUALITY_STEPS = [0.75, 0.6, 0.5] as const

export interface CompressedImage {
  dataUrl: string
  /** data URL 문자열의 바이트 수 = Firestore 에 저장될 크기 */
  bytes: number
  /** 고른 원본 파일의 바이트 수 (로그·안내용) */
  originalBytes: number
  width: number
  height: number
  quality: number
}

export class ImageTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(
      `이미지가 너무 큽니다 — 가장 낮은 화질로 줄여도 ${Math.round(bytes / 1024)}KB 입니다 ` +
        `(한 장에 ${Math.round(TARGET_BYTES / 1024)}KB 까지). 필요한 부분만 잘라서 다시 넣어주세요`
    )
  }
}

/** data URL 문자열이 차지하는 바이트 수. base64 는 ASCII 라 글자 수가 곧 바이트 수다 */
export function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length
}

/** 비율을 지키며 긴 변을 max 로 맞춘다. 원본이 더 작으면 그대로 둔다 (늘리면 화질만 버린다) */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 화질을 낮춰 가며 굽는다. 브라우저 API 를 직접 부르지 않고 encode 를 받는다 —
 * 이 계단(0.75 → 0.6 → 0.5 → 포기)이 코드 밖에서도 확인 가능해야 하기 때문이다
 */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<string> | string,
  budget: number = TARGET_BYTES
): Promise<{ dataUrl: string; bytes: number; quality: number }> {
  let last: { dataUrl: string; bytes: number; quality: number } = {
    dataUrl: '',
    bytes: Number.POSITIVE_INFINITY,
    quality: QUALITY_STEPS[0],
  }
  for (const quality of QUALITY_STEPS) {
    const dataUrl = await encode(quality)
    const bytes = dataUrlBytes(dataUrl)
    last = { dataUrl, bytes, quality }
    if (bytes <= budget) return last
  }
  throw new ImageTooLargeError(last.bytes)
}

/** 파일을 <img> 로 읽는다. createImageBitmap 이 없는 브라우저(구형 Safari)도 있어 이 길로 간다 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지를 읽지 못했습니다 — 지원하지 않는 형식일 수 있습니다'))
    }
    img.src = url
  })
}

/**
 * 고른 파일 하나를 저장 가능한 data URL 로 만든다.
 *
 * 실패는 두 가지다: 읽지 못한 파일(형식)과 줄여도 큰 파일(ImageTooLargeError).
 * 둘 다 호출부가 사람에게 그대로 보여줄 수 있는 문장을 담아 던진다
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const img = await loadImage(file)
  const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이미지를 변환하지 못했습니다 (canvas 를 쓸 수 없습니다)')
  // JPEG 에는 투명이 없다. 흰 바탕을 깔지 않으면 PNG 의 투명한 곳이 검게 굳는다
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const { dataUrl, bytes, quality } = await encodeWithinBudget((q) => canvas.toDataURL('image/jpeg', q))
  return { dataUrl, bytes, originalBytes: file.size, width, height, quality }
}
