'use client'

// 파싱 중인 PDF 원본을 IndexedDB에 보관한다.
// localStorage에는 File을 담을 수 없어서, 새로고침 후 "파일 다시 선택" 없이 이어서
// 처리하려면 여기 저장된 원본이 필요하다. 파싱이 끝나면 반드시 지운다.
//
// Blob/File이 아니라 ArrayBuffer로 저장하는 이유: Safari(WebKit)는 IndexedDB의 Blob을
// 별도 파일로 보관하는데, 이 파일을 잃어버리면 읽을 때 NotFoundError가 난다.
// ArrayBuffer는 레코드에 인라인으로 들어가 이 경로를 타지 않는다.

const DB_NAME = 'lawpass_pdf_cache'
const DB_VERSION = 1
const STORE = 'files'

interface CachedPdf {
  sourceFile: string // 문제집 이름 (진행상황 기록과 동일한 키)
  fileName: string
  bytes?: ArrayBuffer
  blob?: Blob // 옛 형식(Blob 저장) 호환용
  savedAt: number
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB를 사용할 수 없는 환경입니다'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'sourceFile' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB가 다른 탭에서 사용 중입니다'))
  })
}

// 스토어가 없는 손상된 DB를 통째로 지운다 (다음 open에서 새로 만들어진다)
function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve()
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

function runOnce<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // 스토어가 없으면 여기서 NotFoundError가 동기로 던져진다
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  let db = await openDb()
  try {
    return await runOnce(db, mode, fn)
  } catch (err) {
    if (!isNotFoundError(err)) throw err
    // 스토어가 사라진 DB → 삭제 후 한 번만 재시도
    console.warn('[pdfCache] 손상된 DB 감지, 재생성합니다', err)
    db.close()
    await deleteDb()
    db = await openDb()
    return await runOnce(db, mode, fn)
  } finally {
    db.close()
  }
}

// 저장 성공 여부를 반환. 실패(용량 초과·시크릿 모드 등)해도 파싱 자체는 계속 진행한다
export async function savePdfFile(sourceFile: string, file: File): Promise<boolean> {
  try {
    const record: CachedPdf = {
      sourceFile,
      fileName: file.name,
      bytes: await file.arrayBuffer(),
      savedAt: Date.now(),
    }
    await withStore<IDBValidKey>('readwrite', (store) => store.put(record))
    return true
  } catch (e) {
    console.error('[pdfCache] PDF 원본 저장 실패', e)
    return false
  }
}

export async function loadPdfFile(sourceFile: string): Promise<File | null> {
  try {
    const record = await withStore<CachedPdf | undefined>('readonly', (store) => store.get(sourceFile))
    if (!record) return null

    const source = record.bytes ?? record.blob
    if (!source) throw new Error('저장된 PDF 본문이 비어 있습니다')

    // 옛 Blob 형식은 여기서 읽는 순간 Safari가 NotFoundError를 던질 수 있다
    const bytes = record.bytes ?? (await (record.blob as Blob).arrayBuffer())
    return new File([bytes], record.fileName, { type: 'application/pdf' })
  } catch (e) {
    console.error('[pdfCache] PDF 원본 불러오기 실패', e)
    // 읽을 수 없는 기록은 남겨둬도 매번 실패하므로 정리한다 ("파일 다시 선택"으로 폴백)
    await deletePdfFile(sourceFile)
    return null
  }
}

export async function deletePdfFile(sourceFile: string): Promise<void> {
  try {
    await withStore<undefined>('readwrite', (store) => store.delete(sourceFile))
  } catch (e) {
    console.error('[pdfCache] PDF 원본 삭제 실패', e)
  }
}

/**
 * 캐시를 통째로 비운다. 계정이 바뀔 때 이전 사용자가 올린 PDF 원본이 남지 않게 한다.
 * 파싱 중이던 파일까지 사라지지만, 그 진행 상황 기록도 함께 지워지므로 어긋나지 않는다
 */
export async function clearPdfCache(): Promise<void> {
  try {
    await withStore<undefined>('readwrite', (store) => store.clear())
  } catch (e) {
    console.error('[pdfCache] 캐시 비우기 실패', e)
  }
}
