'use client'

import { useEffect, useRef, useState } from 'react'
import type { QuestionImage } from '@/lib/types'
import { compressImage } from '@/lib/imageCompress'
import {
  deleteQuestionImage,
  fetchQuestionImages,
  newQuestionImageId,
  saveQuestionImage,
} from '@/lib/firebaseServices/questionImages'
import { attachQuestionImages, detachQuestionImage } from '@/lib/store'

/**
 * 문제에 붙인 도면 이미지 — 첨부·보기·떼기.
 *
 * 표 편집기와 경쟁하지 않는다. 꺾인(L자형) 토지 배치처럼 rowspan·colspan 으로 **원천적으로**
 * 표현이 안 되는 모양만 여기로 온다. 표로 되는 것은 표로 둔다.
 *
 * 그림은 이 화면을 펼칠 때 그 문제 것만 읽는다 — 앱을 열 때 전부 받지 않는다.
 * 장당 수백 KB라 전체 pull 에 섞으면 시작이 그만큼 느려진다
 * (자세한 이유는 lib/firebaseServices/questionImages.ts)
 */

interface Props {
  questionId: string
  /** Question.images — 저장된 순서가 곧 표시 순서다 */
  imageIds: string[] | undefined
  /** 표 편집·표 만들기와 같은 판정을 그대로 받는다. 여기서 따로 가리지 않는다 */
  isAdmin?: boolean
  /** 붙이거나 뗀 뒤 상위 목록을 다시 읽도록 */
  onChanged?: () => void
  /**
   * 선학습·CBT 처럼 문제를 푸는 화면. 관리자여도 첨부·삭제는 검토 화면에서만 한다 —
   * 여기서는 '이미지 첨부' 머리말도 빼고 그림만, 풀면서 읽을 수 있는 크기로 보여준다
   */
  readOnly?: boolean
}

const button =
  'px-2 py-0.5 border border-border text-muted-foreground rounded text-[11px] hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`

export function QuestionImages({ questionId, imageIds, isAdmin: isAdminProp = false, onChanged, readOnly = false }: Props) {
  const ids = imageIds ?? []
  const isAdmin = isAdminProp && !readOnly
  const [images, setImages] = useState<QuestionImage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 이 컴포넌트가 그려지는 순간 = 상세를 펼친 순간. 그때 필요한 문서만 읽는다
  useEffect(() => {
    let alive = true
    if (ids.length === 0) {
      setImages([])
      return
    }
    setImages(null)
    fetchQuestionImages(ids)
      .then((list) => {
        if (alive) setImages(list)
      })
      .catch((e) => {
        if (!alive) return
        setImages([])
        setError(e instanceof Error ? e.message : '이미지를 불러오지 못했습니다')
      })
    return () => {
      alive = false
    }
    // ID 목록이 바뀔 때만 다시 읽는다 (문자열로 견준다 — 배열은 매 렌더 새 객체다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, ids.join(',')])

  async function handleFiles(files: FileList | null) {
    // 숨김만으로는 부족하다 — 버튼을 거치지 않고 불릴 수 있어 여기서도 막는다
    if (!isAdmin || !files || files.length === 0) return
    setBusy(true)
    setError(null)
    const added: QuestionImage[] = []
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file)
        console.log(
          '[question-image] 압축',
          file.name,
          `${kb(compressed.originalBytes)} → ${kb(compressed.bytes)}`,
          `(${compressed.width}×${compressed.height}, 화질 ${compressed.quality})`
        )
        const image: QuestionImage = {
          id: newQuestionImageId(),
          questionId,
          dataUrl: compressed.dataUrl,
          createdAt: Date.now(),
        }
        // 원격에 먼저 올리고, 성공한 뒤에야 문제에 ID 를 적는다. 순서가 반대면
        // 올리기가 실패했을 때 문제에는 있는데 열 수 없는 ID 가 남는다
        await saveQuestionImage(image)
        attachQuestionImages(questionId, [image.id])
        added.push(image)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 첨부하지 못했습니다')
    } finally {
      // 같은 파일을 다시 고를 수 있게 비운다 (같은 값이면 change 가 안 온다)
      if (fileRef.current) fileRef.current.value = ''
      if (added.length > 0) {
        setImages((prev) => [...(prev ?? []), ...added])
        onChanged?.()
      }
      setBusy(false)
    }
  }

  async function handleDelete(image: QuestionImage) {
    if (!isAdmin) return
    setBusy(true)
    setError(null)
    try {
      await deleteQuestionImage(image.id)
      detachQuestionImage(questionId, image.id)
      setImages((prev) => (prev ?? []).filter((x) => x.id !== image.id))
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 지우지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  // 붙일 수도 없고 붙은 것도 없으면 자리만 차지한다
  if (!isAdmin && ids.length === 0) return null

  return (
    <div className="space-y-1">
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground">
          이미지 첨부{ids.length > 0 ? ` (${ids.length}장)` : ''}
        </p>
        {isAdmin && (
          <>
            <button type="button" className={button} disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? '처리 중…' : '이미지 고르기'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <span className="text-[11px] text-muted-foreground">
              표로 표현이 안 되는 도면만 — 긴 변 1600px·JPEG 로 줄여 올립니다
            </span>
          </>
        )}
      </div>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {images === null ? (
        <p className="text-[11px] text-muted-foreground">이미지를 불러오는 중…</p>
      ) : (
        images.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {images.map((image, i) => (
              <div key={image.id} className="space-y-0.5">
                {/* 도면은 작게 보면 쓸모가 없다. 새 탭에서 원본 크기로 열 수 있게 링크로 감싼다 */}
                <a href={image.dataUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt={image.caption ?? `첨부 이미지 ${i + 1}`}
                    className={`${
                      readOnly ? 'max-h-80 max-w-full' : 'h-24'
                    } w-auto rounded border border-border bg-card object-contain`}
                  />
                </a>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(image)}
                    className="px-2 py-0.5 border border-red-400/40 text-red-400 rounded text-[11px] hover:bg-red-400/10 disabled:opacity-40 transition-colors"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
