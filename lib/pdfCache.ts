'use client'

// 파싱 중인 PDF 원본을 IndexedDB에 보관한다.
// localStorage에는 File을 담을 수 없어서, 새로고침 후 "파일 다시 선택" 없이 이어서
// 처리하려면 여기 저장된 원본이 필요하다. 파싱이 끝나면 반드시 지운다.

const DB_NAME = 'lawpass_pdf_cache'
const DB_VERSION = 1
const STORE = 'files'

interface CachedPdf {
  sourceFile: string // 문제집 이름 (진행상황 기록과 동일한 키)
  fileName: string
  blob: Blob
  savedAt: number
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
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

// 저장 성공 여부를 반환. 실패(용량 초과·시크릿 모드 등)해도 파싱 자체는 계속 진행한다
export async function savePdfFile(sourceFile: string, file: File): Promise<boolean> {
  try {
    const record: CachedPdf = { sourceFile, fileName: file.name, blob: file, savedAt: Date.now() }
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
    if (!record?.blob) return null
    // Blob으로 돌아오는 브라우저가 있어 항상 File로 복원한다
    return new File([record.blob], record.fileName, { type: 'application/pdf' })
  } catch (e) {
    console.error('[pdfCache] PDF 원본 불러오기 실패', e)
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
