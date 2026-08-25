'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getApiKey, setApiKey, addQuestions, getSourceFiles, deleteQuestionsBySource, mergeSourceFiles, getQuestions, getWrongNotes } from '@/lib/store'
import { ParseReview, type ReparseRequest } from '@/components/parse-review'
import { formatMissing } from '@/lib/parseReview'
import {
  uploadPdfToFileApi, waitForFileActive, extractQuestionsFromPdf, deleteFile,
  savePdfProgress, getPdfProgress, clearPdfProgress, listPdfProgress, isAbortError,
} from '@/lib/gemini'
import type { PdfParseProgress } from '@/lib/gemini'
import { isIncompleteResponseError, IncompleteResponseError } from '@/lib/gemini'
import { savePdfFile, loadPdfFile, deletePdfFile } from '@/lib/pdfCache'
import { getAppMode } from '@/lib/appMode'
import type { Subject, ExamType } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const CHUNK_SIZE = 5
const CHUNK_OVERLAP = 1

const MAX_UPLOAD_BYTES = 4_000_000
// 구간을 쪼개 다시 시도할 값어치는 있지만, 1페이지까지 좁혀도 안 될 때 '건너뛰기'로 처리하면
// 안 되는 실패 사유. 페이지 내용이 아니라 통신·플랫폼이 원인이라 다음에는 멀쩡히 될 수 있다
const TRANSPORT_REASONS = ['UPLOAD_TIMEOUT', 'ACTIVE_TIMEOUT']
const CHUNK_BUDGET_BYTES = 3_600_000

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

function chunkRange(chunkIndex: number, chunkSize: number, totalPages: number) {
  return {
    startPage: Math.max(0, chunkIndex * chunkSize - (chunkIndex > 0 ? CHUNK_OVERLAP : 0)),
    endPage: Math.min(chunkIndex * chunkSize + chunkSize, totalPages),
  }
}

async function buildChunkBytes(sourcePdf: PDFDocument, startPage: number, endPage: number) {
  const chunkPdf = await PDFDocument.create()
  const pages = await chunkPdf.copyPages(
    sourcePdf,
    Array.from({ length: endPage - startPage }, (_, p) => startPage + p)
  )
  pages.forEach((page) => chunkPdf.addPage(page))
  return chunkPdf.save()
}

async function calibrateChunkSize(
  sourcePdf: PDFDocument,
  totalPages: number,
  sourceBytes: number
): Promise<number> {
  const avgPerPage = totalPages > 0 && sourceBytes > 0 ? sourceBytes / totalPages : 0

  let size = CHUNK_SIZE
  for (let attempt = 0; attempt < 5 && size > 1; attempt++) {
    const pagesInWorstChunk = Math.min(size + CHUNK_OVERLAP, totalPages)
    const head = (await buildChunkBytes(sourcePdf, 0, pagesInWorstChunk)).byteLength
    const tailStart = Math.max(0, totalPages - pagesInWorstChunk)
    const tail = tailStart > 0 ? (await buildChunkBytes(sourcePdf, tailStart, totalPages)).byteLength : 0
    const worst = Math.max(head, tail, avgPerPage * pagesInWorstChunk)
    if (worst <= CHUNK_BUDGET_BYTES) break
    const fit = Math.floor(size * (CHUNK_BUDGET_BYTES / worst))
    size = Math.max(1, Math.min(size - 1, fit))
  }
  return size
}

export function estimatePageRange(
  nos: number[],
  missing: number[],
  totalPages: number
): { from: number; to: number } {
  if (totalPages <= 0) return { from: 1, to: 1 }
  if (nos.length === 0 || missing.length === 0) return { from: 1, to: totalPages }
  const totalQuestions = nos.length + missing.length
  const ratioBefore = (n: number) =>
    (nos.filter((x) => x < n).length + missing.filter((x) => x < n).length) / totalQuestions
  const margin = Math.max(2, Math.ceil(totalPages * 0.05))
  const first = Math.min(...missing)
  const last = Math.max(...missing)
  const from = Math.max(1, Math.floor(ratioBefore(first) * totalPages) + 1 - margin)
  const to = Math.min(totalPages, Math.ceil(ratioBefore(last) * totalPages) + 1 + margin)
  return { from, to: Math.max(from, to) }
}

interface ReparseState {
  req: ReparseRequest
  file: File | null
  pageCount: number
  fromPage: number
  toPage: number
  status: 'ready' | 'needFile' | 'running' | 'done' | 'error'
  error: string | null
  donePages: number
  added: number
  merged: number
}

interface JobView {
  progress: number
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error' | 'paused' | 'resumable'
  error?: string
  count?: number
  pageCount?: number
  chunkIndex?: number
  chunkTotal?: number
  chunkSize?: number
  resumable?: boolean
  skippedPages?: number[] // 읽지 못해 건너뛴 페이지(1-based)
}

interface FileState extends JobView {
  file: File
  displayName: string
}

interface ResumeJob {
  sourceFile: string
  saved: PdfParseProgress
  file: File | null
  view: JobView
}

type UploadMode = 'file' | 'uri'

interface ParseMeta {
  subjects: Subject[]
  examTypes: ExamType[]
}

function sourceFileNameOf(f: { file: File; displayName: string }) {
  return f.displayName.trim() || f.file.name.replace(/\.pdf$/i, '')
}

function resumeJobView(progress: PdfParseProgress): JobView {
  return {
    progress: (Math.max(0, progress.chunkIndex + 1) / Math.max(1, progress.chunkTotal)) * 100,
    status: 'resumable',
    count: progress.fileQuestionCount,
    pageCount: progress.pageCount,
    chunkIndex: progress.chunkIndex + 1,
    chunkTotal: progress.chunkTotal,
    chunkSize: progress.chunkSize,
    skippedPages: progress.skippedPages,
    resumable: true,
  }
}

interface ProgressRow {
  examType: ExamType
  year: number
  unit: string
  total: number
  solved: number
}

function computeProgress(): Record<string, ProgressRow[]> {
  const questions = getQuestions()
  const wrongNotes = getWrongNotes()
  const solvedIds = new Set(
    wrongNotes.filter((n) => (n.totalCount ?? 0) > 0).map((n) => n.questionId)
  )

  const rowMap = new Map<string, ProgressRow & { subject: Subject }>()
  for (const q of questions) {
    const unit = q.unit?.trim() || '(단원 미지정)'
    const key = `${q.subject}|${q.examType}|${q.year}|${unit}`
    const row = rowMap.get(key) ?? { subject: q.subject, examType: q.examType, year: q.year, unit, total: 0, solved: 0 }
    row.total += 1
    if (solvedIds.has(q.id)) row.solved += 1
    rowMap.set(key, row)
  }

  const bySubject: Record<string, ProgressRow[]> = {}
  for (const { subject, ...row } of rowMap.values()) {
    if (!bySubject[subject]) bySubject[subject] = []
    bySubject[subject].push(row)
  }
  for (const subject in bySubject) {
    bySubject[subject].sort((a, b) =>
      a.examType !== b.examType
        ? a.examType.localeCompare(b.examType)
        : b.year !== a.year
          ? b.year - a.year
          : a.unit.localeCompare(b.unit)
    )
  }
  return bySubject
}

function groupRowsByYear(rows: ProgressRow[]) {
  const map = new Map<number, ProgressRow[]>()
  for (const r of rows) {
    const arr = map.get(r.year) ?? []
    arr.push(r)
    map.set(r.year, arr)
  }
  return Array.from(map.entries())
    .map(([year, yearRows]) => ({
      year,
      rows: yearRows.slice().sort((a, b) => a.examType.localeCompare(b.examType) || a.unit.localeCompare(b.unit)),
      total: yearRows.reduce((sum, r) => sum + r.total, 0),
      solved: yearRows.reduce((sum, r) => sum + r.solved, 0),
    }))
    .sort((a, b) => b.year - a.year)
}

function groupRowsByUnit(rows: ProgressRow[]) {
  const map = new Map<string, ProgressRow[]>()
  for (const r of rows) {
    const arr = map.get(r.unit) ?? []
    arr.push(r)
    map.set(r.unit, arr)
  }
  return Array.from(map.entries())
    .map(([unit, unitRows]) => ({
      unit,
      total: unitRows.reduce((sum, r) => sum + r.total, 0),
      solved: unitRows.reduce((sum, r) => sum + r.solved, 0),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit))
}

function progressStatus(solved: number, total: number) {
  const icon = solved === 0 ? '⬜' : solved === total ? '✅' : '🔄'
  const label = solved === 0 ? '미완료' : solved === total ? '완료' : '진행중'
  return { icon, label }
}

type ProgressViewMode = 'year' | 'unit' | 'all'
const PROGRESS_VIEW_OPTIONS: { id: ProgressViewMode; label: string }[] = [
  { id: 'year', label: '연도별' },
  { id: 'unit', label: '단원별' },
  { id: 'all', label: '전체목록' },
]

export function PdfTab({
  onQuestionsAdded,
  syncedAt = 0,
}: {
  onQuestionsAdded: () => void
  syncedAt?: number
}) {
  const [appMode] = useState(() => getAppMode())
  const isGeneral = appMode === 'general'

  const [apiKey, setApiKeyLocal] = useState(() => getApiKey())
  const [apiStatus, setApiStatus] = useState<'untested' | 'ok' | 'error'>('untested')
  const [showApiKeyInfo, setShowApiKeyInfo] = useState(false)
  const [uploadMode, setUploadMode] = useState<UploadMode>('file')
  const [files, setFiles] = useState<FileState[]>([])
  const [fileUri, setFileUri] = useState('')

  const [subjects, setSubjects] = useState<Subject[]>([])
  const [generalSubjectText, setGeneralSubjectText] = useState('')
  const [examTypes, setExamTypes] = useState<ExamType[]>(isGeneral ? ['모의고사'] : [])

  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const [resumeJobs, setResumeJobs] = useState<ResumeJob[]>([])
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const resumeInputRef = useRef<HTMLInputElement>(null)
  const resumeTargetRef = useRef<string | null>(null)
  const [summary, setSummary] = useState<{ added: number; merged: number; skipped: number[] } | null>(null)
  const [reparse, setReparse] = useState<ReparseState | null>(null)
  const reparseInputRef = useRef<HTMLInputElement>(null)
  const reparsePanelRef = useRef<HTMLDivElement>(null)
  const [reviewFiles, setReviewFiles] = useState<string[]>([])
  const [reviewRefresh, setReviewRefresh] = useState(0)

  function showReview(names: string[], replace = false) {
    setReviewFiles((prev) => {
      if (replace) return names
      const next = prev.slice()
      for (const n of names) if (!next.includes(n)) next.push(n)
      return next
    })
    setReviewRefresh((v) => v + 1)
  }

  const reviewQuestions = useMemo(
    () => (reviewFiles.length === 0 ? [] : getQuestions().filter((q) => q.sourceFile && reviewFiles.includes(q.sourceFile))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewFiles, reviewRefresh]
  )
  const [uriStatus, setUriStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [uriError, setUriError] = useState('')
  const [sourceFiles, setSourceFiles] = useState<{ name: string; count: number }[]>([])
  const [progress, setProgress] = useState<Record<string, ProgressRow[]>>({})
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  const [progressView, setProgressView] = useState<ProgressViewMode>('all')
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSourceFiles(getSourceFiles())
    setProgress(computeProgress())

    let cancelled = false
    ;(async () => {
      const jobs = listPdfProgress()
      const restored: ResumeJob[] = []
      for (const job of jobs) {
        const file = await loadPdfFile(job.sourceFile)
        restored.push({ sourceFile: job.sourceFile, saved: job.progress, file, view: resumeJobView(job.progress) })
      }
      if (cancelled) return
      setResumeJobs(restored)

      const metas = jobs
        .map((j) => j.progress)
        .filter((pg) => pg.subjects?.length || pg.examTypes?.length)
      const sameMeta =
        metas.length > 0 &&
        metas.every(
          (pg) =>
            JSON.stringify(pg.subjects ?? []) === JSON.stringify(metas[0].subjects ?? []) &&
            JSON.stringify(pg.examTypes ?? []) === JSON.stringify(metas[0].examTypes ?? [])
        )
      if (sameMeta) {
        const [first] = metas
        if (first.subjects?.length) {
          if (getAppMode() === 'general') setGeneralSubjectText(first.subjects[0])
          else setSubjects(first.subjects as Subject[])
        }
        if (first.examTypes?.length) setExamTypes(first.examTypes as ExamType[])
      }
      setHydrated(true)
    })()
    return () => { cancelled = true }
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)

  const activeSubjects: Subject[] = isGeneral
    ? (generalSubjectText.trim() ? [generalSubjectText.trim() as Subject] : [])
    : subjects

  function refreshSourceFiles() {
    setSourceFiles(getSourceFiles())
    setProgress(computeProgress())
  }

  const reparseOpen = reparse !== null
  useEffect(() => {
    if (reparseOpen) reparsePanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [reparseOpen])

  useEffect(() => {
    if (syncedAt === 0) return
    refreshSourceFiles()
    setReviewRefresh((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedAt])

  function toggleSubjectExpand(s: string) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleYearExpand(key: string) {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function saveKey(k: string) {
    setApiKeyLocal(k)
    setApiStatus('untested')
    setApiKey(k)
  }

  function toggleSubject(s: Subject) {
    setSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  function toggleExamType(t: ExamType) {
    setExamTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    )
  }

  async function testApiKey() {
    if (!apiKey) return
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      )
      setApiStatus(res.ok ? 'ok' : 'error')
    } catch {
      setApiStatus('error')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []).filter((f) => f.type === 'application/pdf')
    setFiles(
      selected.map((f) => ({
        file: f,
        displayName: f.name.replace(/\.pdf$/i, ''),
        progress: 0,
        status: 'pending' as const,
      }))
    )
    setSummary(null)
    setActionError(null)
  }

  function resetBookForm() {
    setSubjects([])
    setGeneralSubjectText('')
    setExamTypes(isGeneral ? ['모의고사'] : [])
  }

  function clearQueue() {
    setFiles([])
    resetBookForm()
    setSummary(null)
    setReviewFiles([])
    setActionError(null)
  }

  function updateDisplayName(i: number, name: string) {
    setFiles((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], displayName: name }
      return next
    })
  }

  // 💡 [에러 발생 시 1페이지 세분화 루프가 포함된 처리 루틴]
  // 한 페이지 구간을 추출해 저장한다.
  //
  // 구간을 통째로 못 읽는 경우(MAX_TOKENS·RECITATION·깨진 JSON)에는 반으로 쪼개 다시 시도하고,
  // 1페이지까지 좁혀도 안 되면 그 페이지만 건너뛰고 나머지를 계속 처리한다.
  // 곧장 1페이지로 쪼개지 않고 반씩 줄이는 이유: 5페이지 청크가 분량으로 걸린 경우 보통 2+3이면
  // 통과하는데, 1페이지씩 5번 부르면 API 호출이 그만큼 낭비된다.
  //
  // RECITATION은 분량이 아니라 내용이 원인이라 아무리 쪼개도 같은 페이지에서 다시 발동한다.
  // 그래서 '건너뛰기'가 선택이 아니라 필수다 — 이게 없으면 그 파일은 영영 진행되지 않는다.
  //
  // 사용자가 누른 중단(AbortError)은 절대 삼키지 않고 그대로 올려보낸다
  async function extractRange(
    sourcePdf: PDFDocument,
    startPage: number,
    endPage: number,
    fileName: string,
    sourceFile: string,
    meta: ParseMeta,
    signal: AbortSignal | undefined,
    sink: {
      onCount: (added: number, merged: number, parsed: number) => void
      onProgress: (donePagesInChunk: number) => void
      skipped: number[]
    },
    chunkStart = startPage
  ): Promise<void> {
    let uri = ''
    try {
      const bytes = await buildChunkBytes(sourcePdf, startPage, endPage)
      // 413은 서버가 아니라 플랫폼이 되돌려주므로 보내기 전에 걸러야 한다.
      // 예전에는 여기서 그냥 던져 파일 전체가 멈췄다 — 이제는 쪼갤 수 있는 실패로 취급한다
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new IncompleteResponseError(
          `${startPage + 1}~${endPage}쪽이 ${mb(bytes.byteLength)}MB로 업로드 한도(4.5MB)를 넘습니다.`,
          'TOO_LARGE'
        )
      }
      const chunkFile = new File(
        [bytes.buffer as ArrayBuffer],
        `${fileName.replace(/\.pdf$/i, '')}-p${startPage + 1}-${endPage}.pdf`,
        { type: 'application/pdf' }
      )
      uri = await uploadPdfToFileApi(apiKey, chunkFile, undefined, signal)
      await waitForFileActive(apiKey, uri, signal)
      for (const s of meta.subjects) {
        for (const et of meta.examTypes) {
          const questions = await extractQuestionsFromPdf(
            apiKey, uri, s, et, new Date().getFullYear(), signal
          )
          const result = addQuestions(questions, sourceFile)
          sink.onCount(result.added, result.merged, questions.length)
        }
      }
      sink.onProgress(endPage - chunkStart)
      return
    } catch (err) {
      if (isAbortError(err)) throw err
      // 네트워크 끊김·인증 오류처럼 쪼갠다고 풀리지 않는 실패는 그대로 올려보낸다
      if (!isIncompleteResponseError(err)) throw err

      const pages = endPage - startPage
      if (pages <= 1) {
        // 여기서 성격을 갈라야 한다.
        // 내용이 원인인 실패(RECITATION·분량 초과·깨진 JSON)는 몇 번을 다시 보내도 같은 결과이므로
        // 그 페이지를 포기하는 게 맞다. 반면 업로드가 안 되는 것은 그 페이지의 성질이 아니라
        // 통신·플랫폼 문제여서, 건너뛰면 멀쩡한 문제를 잃는다.
        // 특히 장애 중이면 모든 페이지가 똑같이 실패하므로, 건너뛰기로 처리했다간
        // 문서 전체가 '완료'로 기록된 채 통째로 비어버린다. 그래서 이쪽은 오류로 올려보낸다
        if (TRANSPORT_REASONS.includes(err.reason)) {
          console.error(`[p.${startPage + 1}] ${err.reason} — 통신 문제라 건너뛰지 않고 중단합니다:`, err.message)
          throw err
        }
        console.warn(`[p.${startPage + 1}] ${err.reason} — 이 페이지는 건너뜁니다:`, err.message)
        if (!sink.skipped.includes(startPage + 1)) sink.skipped.push(startPage + 1)
        sink.onProgress(endPage - chunkStart)
        return
      }
      const mid = startPage + Math.floor(pages / 2)
      console.warn(
        `[p.${startPage + 1}~${endPage}] ${err.reason} — ` +
          `${startPage + 1}~${mid}쪽과 ${mid + 1}~${endPage}쪽으로 나눠 다시 시도합니다`
      )
      await extractRange(sourcePdf, startPage, mid, fileName, sourceFile, meta, signal, sink, chunkStart)
      await extractRange(sourcePdf, mid, endPage, fileName, sourceFile, meta, signal, sink, chunkStart)
    } finally {
      if (uri) await deleteFile(apiKey, uri).catch(() => {})
    }
  }

  async function processEntry(
    entry: { file: File; displayName: string },
    startChunk: number,
    update: (patch: Partial<JobView>) => void,
    meta: ParseMeta,
    signal?: AbortSignal
  ): Promise<{ added: number; merged: number; aborted: boolean; skipped: number[] }> {
    const sourceFile = sourceFileNameOf(entry)
    const savedProgress = getPdfProgress(sourceFile)
    await savePdfFile(sourceFile, entry.file)
    let fileQuestionCount = savedProgress?.fileQuestionCount ?? 0
    let deltaAdded = 0
    let deltaMerged = 0
    let aborted = false
    let lastCompletedChunk = startChunk - 1
    let chunkTotal = 0
    let totalPages = 0
    let chunkSize = CHUNK_SIZE
    // 어떤 크기로 쪼개도 읽지 못해 포기한 페이지(1-based). 무엇을 잃었는지 남겨야
    // 사용자가 결번 재파싱으로 회수를 시도할 수 있다
    const skippedPages: number[] = [...(savedProgress?.skippedPages ?? [])]

    const saveProgress = (chunkIndexDone: number) => {
      savePdfProgress(sourceFile, {
        chunkIndex: chunkIndexDone,
        chunkTotal,
        totalAdded: (savedProgress?.totalAdded ?? 0) + deltaAdded,
        totalMerged: (savedProgress?.totalMerged ?? 0) + deltaMerged,
        fileQuestionCount,
        fileName: entry.file.name,
        pageCount: totalPages,
        chunkSize,
        subjects: meta.subjects,
        examTypes: meta.examTypes,
        skippedPages,
      })
    }

    try {
      const sourceBuffer = await entry.file.arrayBuffer()
      const sourcePdf = await PDFDocument.load(sourceBuffer)
      totalPages = sourcePdf.getPageCount()
      chunkSize =
        startChunk > 0
          ? (savedProgress?.chunkSize ?? CHUNK_SIZE)
          : await calibrateChunkSize(sourcePdf, totalPages, sourceBuffer.byteLength)
      chunkTotal = Math.ceil(totalPages / chunkSize)
      update({
        status: 'uploading',
        progress: (startChunk / chunkTotal) * 100,
        pageCount: totalPages,
        chunkSize,
        chunkIndex: startChunk,
        chunkTotal,
        error: undefined,
        resumable: false,
      })

      for (let chunkIndex = startChunk; chunkIndex < chunkTotal; chunkIndex++) {
        const { startPage, endPage } = chunkRange(chunkIndex, chunkSize, totalPages)
        update({
          status: 'analyzing',
          progress: (chunkIndex / chunkTotal) * 100,
          chunkIndex: chunkIndex + 1,
        })

        // 구간을 통째로 못 읽으면 extractRange가 반으로 쪼개 다시 시도하고,
        // 1페이지까지 좁혀도 안 되는 페이지는 건너뛴다. 그래서 이 호출은 청크를 막지 않는다
        await extractRange(sourcePdf, startPage, endPage, entry.file.name, sourceFile, meta, signal, {
          onCount: (added, merged, parsed) => {
            deltaAdded += added
            deltaMerged += merged
            fileQuestionCount += parsed
            update({ count: fileQuestionCount })
          },
          onProgress: (donePages) => {
            const within = (endPage - startPage) > 0 ? donePages / (endPage - startPage) : 1
            update({ progress: ((chunkIndex + within) / chunkTotal) * 100 })
          },
          skipped: skippedPages,
        })

        update({
          progress: ((chunkIndex + 1) / chunkTotal) * 100,
          chunkIndex: chunkIndex + 1,
          count: fileQuestionCount,
          skippedPages: [...skippedPages],
        })
        lastCompletedChunk = chunkIndex
        saveProgress(chunkIndex)
      }
      update({
        status: 'done',
        progress: 100,
        chunkIndex: chunkTotal,
        resumable: false,
        skippedPages: [...skippedPages],
      })
      clearPdfProgress(sourceFile)
      await deletePdfFile(sourceFile)
    } catch (err) {
      aborted = isAbortError(err)
      if (chunkTotal > 0) saveProgress(lastCompletedChunk)
      update({
        status: aborted ? 'paused' : 'error',
        error: aborted ? undefined : String(err),
        resumable: true,
        count: fileQuestionCount,
        skippedPages: [...skippedPages],
      })
    }

    return { added: deltaAdded, merged: deltaMerged, aborted, skipped: skippedPages }
  }

  function stopAnalysis() {
    abortRef.current?.abort()
  }

  function resolveStartChunk(entry: { file: File; displayName: string }): number {
    const saved = getPdfProgress(sourceFileNameOf(entry))
    if (!saved || saved.chunkIndex < 0) return 0
    if (saved.fileName && saved.fileName !== entry.file.name) return 0
    return saved.chunkIndex + 1
  }

  function resolveMeta(saved: PdfParseProgress | null | undefined): ParseMeta {
    return {
      subjects: saved?.subjects?.length ? (saved.subjects as Subject[]) : activeSubjects,
      examTypes: saved?.examTypes?.length ? (saved.examTypes as ExamType[]) : examTypes,
    }
  }

  function applyMetaToForm(meta: ParseMeta) {
    if (meta.subjects.length) {
      if (isGeneral) setGeneralSubjectText(meta.subjects[0])
      else setSubjects(meta.subjects)
    }
    if (meta.examTypes.length) setExamTypes(meta.examTypes)
  }

  async function startAnalysis() {
    if (!apiKey || files.length === 0 || examTypes.length === 0 || activeSubjects.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    setSummary(null)
    let totalAdded = 0
    let totalMerged = 0
    const totalSkipped: number[] = []
    const processedFiles: string[] = []

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]
      processedFiles.push(sourceFileNameOf(entry))
      setRunningKey(sourceFileNameOf(entry))
      const result = await processEntry(
        entry,
        resolveStartChunk(entry),
        (patch) => updateFile(i, patch),
        { subjects: activeSubjects, examTypes },
        controller.signal
      )
      totalAdded += result.added
      totalMerged += result.merged
      totalSkipped.push(...result.skipped)
      if (result.aborted) break
    }

    setRunningKey(null)
    abortRef.current = null
    setSummary({ added: totalAdded, merged: totalMerged, skipped: totalSkipped })
    showReview(processedFiles, true)
    setIsRunning(false)
    setFiles((prev) => {
      const rest = prev.filter((f) => f.status !== 'done')
      if (rest.length === 0) resetBookForm()
      return rest
    })
    refreshSourceFiles()
    onQuestionsAdded()
  }

  async function handleResumeFile(i: number) {
    const entry = files[i]
    if (!entry) {
      setActionError('파일 정보를 찾을 수 없습니다. 페이지를 새로고침해주세요.')
      return
    }
    if (!apiKey) {
      setActionError('Gemini API 키를 먼저 입력해주세요.')
      return
    }
    const meta = resolveMeta(getPdfProgress(sourceFileNameOf(entry)))
    if (meta.subjects.length === 0 || meta.examTypes.length === 0) {
      setActionError('과목과 시험 구분을 먼저 선택해주세요.')
      return
    }
    applyMetaToForm(meta)
    setActionError(null)

    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    setRunningKey(sourceFileNameOf(entry))
    const result = await processEntry(
      entry,
      resolveStartChunk(entry),
      (patch) => updateFile(i, patch),
      meta,
      controller.signal
    )
    setRunningKey(null)
    abortRef.current = null
    setSummary((prev) => ({
      added: (prev?.added ?? 0) + result.added,
      merged: (prev?.merged ?? 0) + result.merged,
      skipped: [...(prev?.skipped ?? []), ...result.skipped],
    }))
    showReview([sourceFileNameOf(entry)])
    setIsRunning(false)
    refreshSourceFiles()
    onQuestionsAdded()
  }

  function updateResumeJob(sourceFile: string, patch: Partial<JobView>) {
    setResumeJobs((prev) =>
      prev.map((j) => (j.sourceFile === sourceFile ? { ...j, view: { ...j.view, ...patch } } : j))
    )
  }

  async function handleResumeJob(sourceFile: string) {
    const job = resumeJobs.find((j) => j.sourceFile === sourceFile)
    if (!job || !job.file) {
      setActionError('원본 PDF가 없습니다. "파일 다시 선택"으로 같은 PDF를 지정해주세요.')
      return
    }
    if (!apiKey) {
      setActionError('Gemini API 키를 먼저 입력해주세요.')
      return
    }
    const meta = resolveMeta(job.saved)
    if (meta.subjects.length === 0 || meta.examTypes.length === 0) {
      setActionError('과목과 시험 구분을 먼저 선택해주세요.')
      return
    }
    applyMetaToForm(meta)
    setActionError(null)

    const entry = { file: job.file, displayName: sourceFile }
    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    setRunningKey(sourceFile)
    const result = await processEntry(
      entry,
      resolveStartChunk(entry),
      (patch) => updateResumeJob(sourceFile, patch),
      meta,
      controller.signal
    )
    setRunningKey(null)
    abortRef.current = null
    setIsRunning(false)
    setSummary((prev) => ({
      added: (prev?.added ?? 0) + result.added,
      merged: (prev?.merged ?? 0) + result.merged,
      skipped: [...(prev?.skipped ?? []), ...result.skipped],
    }))
    showReview([sourceFile])
    if (!getPdfProgress(sourceFile)) {
      setResumeJobs((prev) => prev.filter((j) => j.sourceFile !== sourceFile))
    }
    refreshSourceFiles()
    onQuestionsAdded()
  }

  // 💡 [에러 청크 건너뛰기 로직 구현]
  function skipCurrentChunk(sourceFile: string) {
    const saved = getPdfProgress(sourceFile)
    if (!saved) return
    const nextChunkIndex = saved.chunkIndex + 1
    savePdfProgress(sourceFile, { ...saved, chunkIndex: nextChunkIndex })

    setResumeJobs((prev) =>
      prev.map((j) =>
        j.sourceFile === sourceFile
          ? {
              ...j,
              saved: { ...j.saved, chunkIndex: nextChunkIndex },
              view: resumeJobView({ ...j.saved, chunkIndex: nextChunkIndex }),
            }
          : j
      )
    )
    setActionError(`[${sourceFile}] 오류 청크를 건너뛰었습니다. '이어서 처리하기'를 눌러주세요.`)
  }

  function requestResumeFromDisk(sourceFile: string) {
    resumeTargetRef.current = sourceFile
    resumeInputRef.current?.click()
  }

  function handleResumeFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    const sourceFile = resumeTargetRef.current
    resumeTargetRef.current = null
    if (!picked || !sourceFile) return

    const job = resumeJobs.find((j) => j.sourceFile === sourceFile)
    if (!job) return

    if (
      job.saved.fileName &&
      picked.name !== job.saved.fileName &&
      !confirm(
        `저장된 파일명은 "${job.saved.fileName}"인데 "${picked.name}"을 선택했습니다.\n` +
        '계속할까요?'
      )
    ) return

    applyMetaToForm(resolveMeta(job.saved))
    void savePdfFile(sourceFile, picked)
    setResumeJobs((prev) => prev.map((j) => (j.sourceFile === sourceFile ? { ...j, file: picked } : j)))
    setActionError(null)
  }

  function discardResumeJob(sourceFile: string) {
    if (!confirm(`"${sourceFile}"의 이어서 처리 기록을 삭제할까요?`)) return
    clearPdfProgress(sourceFile)
    void deletePdfFile(sourceFile)
    setResumeJobs((prev) => prev.filter((j) => j.sourceFile !== sourceFile))
  }

  async function prepareReparse(req: ReparseRequest, file: File) {
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer())
      const pageCount = pdf.getPageCount()
      const { from, to } = estimatePageRange(req.nos, req.missing, pageCount)
      setReparse({
        req, file, pageCount, fromPage: from, toPage: to,
        status: 'ready', error: null, donePages: 0, added: 0, merged: 0,
      })
    } catch (err) {
      setReparse({
        req, file: null, pageCount: 0, fromPage: 1, toPage: 1,
        status: 'error', error: `PDF를 읽지 못했습니다: ${String(err)}`,
        donePages: 0, added: 0, merged: 0,
      })
    }
  }

  async function openReparse(req: ReparseRequest) {
    setActionError(null)
    setReparse({
      req, file: null, pageCount: 0, fromPage: 1, toPage: 1,
      status: 'needFile', error: null, donePages: 0, added: 0, merged: 0,
    })
    const cached = await loadPdfFile(req.sourceFile)
    if (cached) await prepareReparse(req, cached)
  }

  async function handleReparseFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked || !reparse) return
    await prepareReparse(reparse.req, picked)
  }

  function updateReparse(patch: Partial<ReparseState>) {
    setReparse((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function runReparse() {
    const target = reparse
    if (!target?.file || !apiKey || target.status === 'running') return

    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    updateReparse({ status: 'running', error: null, donePages: 0, added: 0, merged: 0 })

    let added = 0
    let merged = 0
    try {
      const sourceBuffer = await target.file.arrayBuffer()
      const sourcePdf = await PDFDocument.load(sourceBuffer)
      const totalPages = sourcePdf.getPageCount()
      const from = Math.max(1, Math.min(target.fromPage, totalPages))
      const to = Math.max(from, Math.min(target.toPage, totalPages))
      const chunkSize = await calibrateChunkSize(sourcePdf, totalPages, sourceBuffer.byteLength)

      for (let start = from - 1; start < to; start += chunkSize) {
        const end = Math.min(start + chunkSize, to)
        const chunkBytes = await buildChunkBytes(sourcePdf, start, end)
        if (chunkBytes.byteLength > MAX_UPLOAD_BYTES) {
          throw new Error(
            `${start + 1}~${end}페이지가 ${mb(chunkBytes.byteLength)}MB로 업로드 한도를 넘습니다.`
          )
        }
        const chunkFile = new File(
          [chunkBytes.buffer as ArrayBuffer],
          `${target.req.sourceFile}-재파싱-${start + 1}-${end}.pdf`,
          { type: 'application/pdf' }
        )
        let uri = ''
        try {
          uri = await uploadPdfToFileApi(apiKey, chunkFile, undefined, controller.signal)
          await waitForFileActive(apiKey, uri, controller.signal)
          const questions = await extractQuestionsFromPdf(
            apiKey,
            uri,
            target.req.subject as Subject,
            target.req.examType as ExamType,
            new Date().getFullYear(),
            controller.signal
          )
          const result = addQuestions(questions, target.req.sourceFile)
          added += result.added
          merged += result.merged
        } finally {
          if (uri) await deleteFile(apiKey, uri).catch(() => {})
        }
        updateReparse({ donePages: end - (from - 1), added, merged })
      }
      updateReparse({ status: 'done', donePages: to - (from - 1), added, merged })
      showReview([target.req.sourceFile])
      onQuestionsAdded()
    } catch (err) {
      updateReparse({
        status: isAbortError(err) ? 'ready' : 'error',
        error: isAbortError(err) ? null : String(err),
        added,
        merged,
      })
      if (added > 0 || merged > 0) {
        showReview([target.req.sourceFile])
        onQuestionsAdded()
      }
    } finally {
      abortRef.current = null
      setIsRunning(false)
      refreshSourceFiles()
    }
  }

  async function startUriAnalysis() {
    if (!apiKey || !fileUri.trim() || examTypes.length === 0 || activeSubjects.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setUriStatus('analyzing')
    setUriError('')
    setSummary(null)

    try {
      let totalAdded = 0
      let totalMerged = 0
      const sourceFile = fileUri.trim().split('/').pop() ?? 'URI 업로드'
      for (const s of activeSubjects) {
        for (const et of examTypes) {
          const questions = await extractQuestionsFromPdf(apiKey, fileUri.trim(), s, et, new Date().getFullYear(), controller.signal)
          const result = addQuestions(questions, sourceFile)
          totalAdded += result.added
          totalMerged += result.merged
        }
      }
      setSummary({ added: totalAdded, merged: totalMerged, skipped: [] })
      showReview([sourceFile], true)
      setUriStatus('done')
      refreshSourceFiles()
      onQuestionsAdded()
    } catch (err) {
      if (isAbortError(err)) {
        setUriStatus('idle')
      } else {
        setUriError(String(err))
        setUriStatus('error')
      }
    } finally {
      abortRef.current = null
    }
  }

  function handleDeleteSource(name: string) {
    if (!confirm(`"${name}" 파일의 문제를 모두 삭제할까요?`)) return
    deleteQuestionsBySource(name)
    refreshSourceFiles()
    onQuestionsAdded()
  }

  function toggleMergeMode() {
    setMergeMode((v) => !v)
    setMergeSelected(new Set())
  }

  function toggleMergeSelect(name: string) {
    setMergeSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function handleMergeComplete() {
    if (mergeSelected.size < 2) return
    const selectedNames = Array.from(mergeSelected)
    const defaultName = selectedNames.join(' + ')
    const newName = window.prompt('합친 문제집의 이름을 입력하세요', defaultName)
    if (!newName || !newName.trim()) return
    mergeSourceFiles(selectedNames, newName.trim())
    setMergeMode(false)
    setMergeSelected(new Set())
    refreshSourceFiles()
    onQuestionsAdded()
  }

  function updateFile(i: number, patch: Partial<FileState>) {
    setFiles((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], ...patch }
      return next
    })
  }

  const statusDot = {
    untested: 'bg-muted-foreground',
    ok: 'bg-emerald-400',
    error: 'bg-red-400',
  }[apiStatus]

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* API Key */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDot}`} />
          <h2 className="font-semibold text-sm text-foreground">Gemini API 키</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="AIza..."
            className="w-full sm:flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={testApiKey}
            className="w-full sm:w-auto shrink-0 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            연결 확인
          </button>
        </div>
        {apiStatus === 'ok' && <p className="text-xs text-emerald-600 dark:text-emerald-400">연결 성공</p>}
        {apiStatus === 'error' && <p className="text-xs text-red-400">연결 실패 — API 키를 확인하세요</p>}

        <div>
          <button
            onClick={() => setShowApiKeyInfo((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className={`transition-transform ${showApiKeyInfo ? 'rotate-90' : ''}`}>▶</span>
            API 키가 왜 필요한가요?
          </button>
          {showApiKeyInfo && (
            <div className="mt-2 bg-muted rounded-lg p-3 space-y-1 text-xs text-muted-foreground">
              <p>PDF 문제집에서 문제를 자동으로 추출·분석하기 위해 Google Gemini API를 사용합니다.</p>
              <p className="font-medium text-foreground pt-1">발급 방법 (무료)</p>
              <p>
                1.{' '}
                <a
                  href="https://aistudio.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  aistudio.google.com
                </a>
                {' '}접속 후 구글 계정으로 로그인
              </p>
              <p>2. 좌측 메뉴에서 "Get API key" 클릭</p>
              <p>3. "Create API key"로 새 키 발급</p>
              <p>4. 생성된 키를 복사해서 위 입력란에 붙여넣기</p>
            </div>
          )}
        </div>
      </div>

      {/* 업로드된 파일 목록 */}
      {sourceFiles.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sm text-foreground">업로드된 문제집</h2>
            <div className="flex items-center gap-3">
              {mergeMode && (
                <button
                  onClick={handleMergeComplete}
                  disabled={mergeSelected.size < 2}
                  className="text-xs text-primary border border-primary/30 rounded-lg px-2.5 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  합치기 완료 ({mergeSelected.size})
                </button>
              )}
              <button
                onClick={toggleMergeMode}
                className={`text-xs transition-colors ${mergeMode ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {mergeMode ? '취소' : '합치기'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {sourceFiles.map(({ name, count }) => (
              <div
                key={name}
                onClick={mergeMode ? () => toggleMergeSelect(name) : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                  mergeMode
                    ? `cursor-pointer border ${mergeSelected.has(name) ? 'bg-primary/10 border-primary/50' : 'bg-muted border-transparent hover:border-primary/30'}`
                    : 'bg-muted'
                }`}
              >
                {mergeMode && (
                  <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                    mergeSelected.has(name) ? 'bg-primary border-primary' : 'border-muted-foreground'
                  }`}>
                    {mergeSelected.has(name) && (
                      <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">{count}문제</p>
                </div>
                {!mergeMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSource(name) }}
                    className="text-xs text-red-400 hover:text-red-300 shrink-0 transition-colors"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 진도표 */}
      {Object.keys(progress).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-sm text-foreground">진도표</h2>
            <div className="flex gap-1.5">
              {PROGRESS_VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setProgressView(opt.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    progressView === opt.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {[
              ...SUBJECTS.filter((s) => progress[s]?.length),
              ...Object.keys(progress).filter((s) => !SUBJECTS.includes(s as Subject) && progress[s]?.length),
            ].map((s) => {
              const rows = progress[s]
              const total = rows.reduce((sum, r) => sum + r.total, 0)
              const solved = rows.reduce((sum, r) => sum + r.solved, 0)
              const expanded = expandedSubjects.has(s)
              return (
                <div key={s} className="bg-muted rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSubjectExpand(s)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/70 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`transition-transform text-muted-foreground ${expanded ? 'rotate-90' : ''}`}>▶</span>
                      <span className="text-sm font-medium text-foreground">{s}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {solved}/{total}문제
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-3 pb-3 space-y-1.5">
                      {progressView === 'all' &&
                        groupRowsByYear(rows).map((yg) => {
                          const yearKey = `${s}|${yg.year}`
                          const yearExpanded = expandedYears.has(yearKey)
                          return (
                            <div key={yg.year} className="bg-card border border-border rounded-lg overflow-hidden">
                              <button
                                onClick={() => toggleYearExpand(yearKey)}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`text-xs transition-transform text-muted-foreground ${yearExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  <span className="text-xs font-medium text-foreground">{yg.year}년</span>
                                </div>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {yg.solved}/{yg.total}문제
                                </span>
                              </button>
                              {yearExpanded && (
                                <div className="px-3 pb-2 space-y-1.5">
                                  {yg.rows.map((r, i) => {
                                    const { icon, label } = progressStatus(r.solved, r.total)
                                    return (
                                      <div
                                        key={i}
                                        className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-medium text-foreground truncate">
                                            {r.examType} · {r.unit}
                                          </p>
                                        </div>
                                        <span className="text-xs shrink-0">
                                          {icon} {label} ({r.solved}/{r.total})
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}

                      {progressView === 'year' &&
                        groupRowsByYear(rows).map((yg) => {
                          const { icon, label } = progressStatus(yg.solved, yg.total)
                          return (
                            <div
                              key={yg.year}
                              className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2"
                            >
                              <span className="text-xs font-medium text-foreground">{yg.year}년</span>
                              <span className="text-xs shrink-0">
                                {icon} {label} ({yg.solved}/{yg.total})
                              </span>
                            </div>
                          )
                        })}

                      {progressView === 'unit' &&
                        groupRowsByUnit(rows).map((ug) => {
                          const { icon, label } = progressStatus(ug.solved, ug.total)
                          return (
                            <div
                              key={ug.unit}
                              className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2"
                            >
                              <span className="text-xs font-medium text-foreground truncate">{ug.unit}</span>
                              <span className="text-xs shrink-0">
                                {icon} {label} ({ug.solved}/{ug.total})
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제집 정보</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {isGeneral ? '과목' : '과목 (복수 선택 가능)'}
            </label>
            {isGeneral ? (
              <input
                type="text"
                value={generalSubjectText}
                onChange={(e) => setGeneralSubjectText(e.target.value)}
                placeholder="예: 국어, 행정법, 한국사"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {SUBJECTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleSubject(s)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                      subjects.includes(s)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {activeSubjects.length === 0 && (
              <p className="text-xs text-red-400">
                과목을 {isGeneral ? '입력하세요' : '하나 이상 선택하세요'}
              </p>
            )}
          </div>
          {!isGeneral && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">시험 유형 (복수 선택 가능)</label>
              <div className="flex gap-2">
                {EXAM_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleExamType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border ${
                      examTypes.includes(t)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {examTypes.length === 0 && (
                <p className="text-xs text-red-400">시험 유형을 하나 이상 선택하세요</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upload Mode Toggle */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setUploadMode('file')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              uploadMode === 'file'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            📄 PDF 직접 업로드
          </button>
          <button
            onClick={() => setUploadMode('uri')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              uploadMode === 'uri'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            🔗 File URI 입력
          </button>
        </div>

        {/* 재개 대기 큐 */}
        {hydrated && resumeJobs.length > 0 && (
          <div className="space-y-2 border border-orange-500/30 bg-orange-500/5 rounded-xl p-3">
            <p className="text-xs font-medium text-orange-400">⏸ 이어서 처리 대기 중</p>
            <p className="text-xs text-muted-foreground">
              이전에 중단된 파일입니다. 아래 버튼을 직접 누를 때만 처리됩니다.
            </p>
            {resumeJobs.map((j) => {
              const busy = j.view.status === 'uploading' || j.view.status === 'analyzing'
              return (
                <div key={j.sourceFile} className="bg-muted rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{j.sourceFile}</span>
                    <StatusChip status={j.view.status} count={j.view.count} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {j.saved.fileName ?? '파일명 기록 없음'}
                    {` · ${Math.max(0, j.view.chunkIndex ?? 0)}/${j.view.chunkTotal ?? j.saved.chunkTotal} 청크`}
                    {(j.view.count ?? 0) > 0 && ` · ${j.view.count}문제 수집됨`}
                  </p>

                  {busy && (
                    <div className="w-full bg-border rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${j.view.progress}%` }}
                      />
                    </div>
                  )}
                  {j.view.status === 'paused' && (
                    <p className="text-xs text-orange-400">중단했습니다. 완료된 청크까지는 저장되어 있습니다.</p>
                  )}
                  {j.view.status === 'error' && j.view.error && (
                    <p className="text-xs text-red-400 break-all">{j.view.error}</p>
                  )}
                  <SkippedNote pages={j.view.skippedPages} />
                  {!j.file && (
                    <p className="text-xs text-muted-foreground">
                      보관된 원본이 없습니다. 같은 PDF를 다시 선택해주세요.
                    </p>
                  )}

                  <div className="flex gap-2 items-center flex-wrap">
                    {j.file ? (
                      <button
                        type="button"
                        onClick={() => handleResumeJob(j.sourceFile)}
                        disabled={isRunning}
                        className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {`${Math.max(0, j.saved.chunkIndex + 1)}/${j.saved.chunkTotal} 청크부터 이어서 처리하기`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => requestResumeFromDisk(j.sourceFile)}
                        disabled={isRunning}
                        className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        파일 다시 선택
                      </button>
                    )}

                    {/* 💡 [청크 건너뛰기 버튼 추가] */}
                    <button
                      type="button"
                      onClick={() => skipCurrentChunk(j.sourceFile)}
                      disabled={isRunning}
                      className="text-xs text-yellow-500 border border-yellow-500/30 rounded-lg px-2.5 py-1 hover:bg-yellow-500/10 disabled:opacity-40 transition-colors"
                    >
                      이 청크 건너뛰기
                    </button>

                    {isRunning && runningKey === j.sourceFile && (
                      <button
                        type="button"
                        onClick={stopAnalysis}
                        className="text-xs text-orange-400 border border-orange-500/40 rounded-lg px-3 py-1 hover:bg-orange-500/10 transition-colors"
                      >
                        ⏸ 중단
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => discardResumeJob(j.sourceFile)}
                      disabled={isRunning}
                      className="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40 transition-colors ml-auto"
                    >
                      기록 삭제
                    </button>
                  </div>
                </div>
              )
            })}
            <input
              ref={resumeInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleResumeFileSelected}
            />
          </div>
        )}

        {/* 직접 업로드 */}
        {uploadMode === 'file' && (
          <div className="space-y-3">
            <div
              className="border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-8 text-center cursor-pointer transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <div className="text-4xl mb-2">📄</div>
              <p className="text-sm text-muted-foreground">
                PDF 파일을 클릭하여 선택하거나 여러 파일을 동시에 업로드하세요
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                5페이지씩 자동 분할하여 처리 · 대용량 가능
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="bg-muted rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground truncate max-w-[60%]">{f.file.name}</span>
                      <StatusChip status={f.status} count={f.count} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">저장될 문제집 이름</label>
                      <input
                        type="text"
                        value={f.displayName}
                        onChange={(e) => updateDisplayName(i, e.target.value)}
                        disabled={isRunning}
                        placeholder="문제집 이름"
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      />
                    </div>
                    {(f.status === 'uploading' || f.status === 'analyzing') && (
                      <div className="w-full bg-border rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${f.progress}%` }}
                        />
                      </div>
                    )}
                    {f.chunkSize !== undefined && f.chunkSize < CHUNK_SIZE && (
                      <p className="text-xs text-muted-foreground">
                        페이지당 용량이 커서 청크를 {f.chunkSize}페이지로 자동 조정했습니다
                      </p>
                    )}
                    {f.status === 'uploading' && f.chunkTotal && (
                      <p className="text-xs text-primary animate-pulse">
                        청크 {f.chunkIndex ?? 1}/{f.chunkTotal} 업로드 중...
                      </p>
                    )}
                    {f.status === 'analyzing' && (
                      <p className="text-xs text-yellow-400 animate-pulse">
                        청크 {f.chunkIndex ?? 1}/{f.chunkTotal ?? 1} Gemini 분석 중...
                      </p>
                    )}
                    {(f.status === 'error' || f.status === 'paused' || f.status === 'resumable') && (
                      <div className="space-y-1.5">
                        {f.status === 'paused' && (
                          <p className="text-xs text-orange-400">사용자가 중단했습니다.</p>
                        )}
                        {f.status === 'error' && (
                          <p className="text-xs text-red-400 break-all">{f.error}</p>
                        )}
                        <SkippedNote pages={f.skippedPages} />
                        {f.resumable && (
                          <button
                            type="button"
                            onClick={() => handleResumeFile(i)}
                            disabled={isRunning}
                            className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1 hover:bg-primary/10 disabled:opacity-40 transition-colors"
                          >
                            {f.chunkIndex ? `${f.chunkIndex}/${f.chunkTotal} 청크부터 이어서 처리하기` : '이어서 처리하기'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {files.length > 0 && !isRunning && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  대기열 비우기
                </button>
              </div>
            )}

            {actionError && (
              <p className="text-xs text-red-400">{actionError}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={startAnalysis}
                disabled={isRunning || !apiKey || files.length === 0 || examTypes.length === 0 || activeSubjects.length === 0}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {isRunning ? '분석 중...' : '분석 시작'}
              </button>
              {isRunning && (
                <button
                  type="button"
                  onClick={stopAnalysis}
                  className="shrink-0 py-2.5 px-4 border border-orange-500/40 text-orange-400 rounded-lg font-medium text-sm hover:bg-orange-500/10 transition-colors"
                >
                  ⏸ 중단
                </button>
              )}
            </div>
          </div>
        )}

        {/* File URI 입력 */}
        {uploadMode === 'uri' && (
          <div className="space-y-3">
            <a
              href="https://aistudio.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full px-4 py-3 bg-blue-900/30 border border-blue-700/40 rounded-xl hover:bg-blue-900/50 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-blue-300">Google AI Studio에서 대용량 PDF 업로드</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  최대 2GB · 업로드 후 File URI 복사해서 아래에 붙여넣기
                </p>
              </div>
              <span className="text-blue-400 text-lg shrink-0">→</span>
            </a>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">File URI</label>
              <input
                type="text"
                value={fileUri}
                onChange={(e) => {
                  setFileUri(e.target.value)
                  setUriStatus('idle')
                  setUriError('')
                }}
                placeholder="https://generativelanguage.googleapis.com/v1beta/files/..."
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {uriStatus === 'error' && (
              <p className="text-xs text-red-400 break-all">{uriError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={startUriAnalysis}
                disabled={uriStatus === 'analyzing' || !apiKey || !fileUri.trim() || examTypes.length === 0 || activeSubjects.length === 0}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {uriStatus === 'analyzing' ? 'Gemini 분석 중...' : '분석 시작'}
              </button>
              {uriStatus === 'analyzing' && (
                <button
                  type="button"
                  onClick={stopAnalysis}
                  className="shrink-0 py-2.5 px-4 border border-orange-500/40 text-orange-400 rounded-lg font-medium text-sm hover:bg-orange-500/10 transition-colors"
                >
                  ⏸ 중단
                </button>
              )}
            </div>
          </div>
        )}

        {summary && (
          <div className="bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/40 rounded-lg p-3 text-sm">
            <p className="text-emerald-700 dark:text-emerald-300 font-medium">
              완료: <span className="font-bold">{summary.added}문제</span> 추가,{' '}
              <span className="font-bold">{summary.merged}문제</span> 병합
            </p>
            {summary.skipped.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                ⚠ {summary.skipped.length}개 페이지를 읽지 못해 건너뛰었습니다 (
                {summary.skipped.slice(0, 12).join(', ')}
                {summary.skipped.length > 12 && ` 외 ${summary.skipped.length - 12}개`}쪽).
                아래 검토에서 빠진 번호가 잡히면 &apos;이 구간 다시 파싱&apos;으로 그 쪽만 다시 시도할 수 있습니다
              </p>
            )}
          </div>
        )}

        {reparse && (
          <div ref={reparsePanelRef} className="border border-primary/40 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">결번 구간 다시 파싱</p>
                <p className="text-xs text-muted-foreground truncate">
                  {reparse.req.year} {reparse.req.examType} · {reparse.req.subject} · 빠진 번호{' '}
                  {formatMissing(reparse.req.missing)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReparse(null)}
                disabled={reparse.status === 'running'}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                닫기
              </button>
            </div>

            {reparse.status === 'needFile' ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground">{reparse.req.sourceFile}</span>의 원본을 다시 선택해주세요.
                </p>
                <button
                  type="button"
                  onClick={() => reparseInputRef.current?.click()}
                  className="px-3 py-1.5 border border-border rounded text-xs font-medium hover:bg-muted transition-colors"
                >
                  📄 원본 PDF 선택
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground truncate">
                  {reparse.file?.name} · 총 {reparse.pageCount}페이지
                </p>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">페이지</span>
                  <input
                    type="number"
                    min={1}
                    max={reparse.pageCount}
                    value={reparse.fromPage}
                    disabled={reparse.status === 'running'}
                    onChange={(e) => updateReparse({ fromPage: Number(e.target.value) || 1 })}
                    className="w-16 px-2 py-1 bg-input border border-border rounded text-center tabular-nums disabled:opacity-40"
                  />
                  <span className="text-muted-foreground">~</span>
                  <input
                    type="number"
                    min={1}
                    max={reparse.pageCount}
                    value={reparse.toPage}
                    disabled={reparse.status === 'running'}
                    onChange={(e) => updateReparse({ toPage: Number(e.target.value) || 1 })}
                    className="w-16 px-2 py-1 bg-input border border-border rounded text-center tabular-nums disabled:opacity-40"
                  />
                  <span className="text-muted-foreground">쪽</span>
                </div>
                {reparse.status === 'running' && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    분석 중… {reparse.donePages}/{Math.max(1, reparse.toPage - reparse.fromPage + 1)}페이지 ·{' '}
                    {reparse.added}문제 추가, {reparse.merged}문제 병합
                  </p>
                )}
                {reparse.status === 'done' && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    완료: {reparse.added}문제 추가, {reparse.merged}문제 병합
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={runReparse}
                    disabled={!apiKey || reparse.status === 'running'}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {reparse.status === 'running'
                      ? '분석 중...'
                      : `${Math.max(0, reparse.toPage - reparse.fromPage + 1)}쪽 다시 파싱`}
                  </button>
                  {reparse.status === 'running' && (
                    <button
                      type="button"
                      onClick={stopAnalysis}
                      className="px-3 py-1.5 border border-orange-500/40 text-orange-400 rounded text-xs font-medium hover:bg-orange-500/10 transition-colors"
                    >
                      ⏸ 중단
                    </button>
                  )}
                </div>
              </div>
            )}

            {reparse.error && <p className="text-xs text-red-400">{reparse.error}</p>}
            <input
              ref={reparseInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleReparseFileSelected}
            />
          </div>
        )}

        {reviewFiles.length > 0 && (
          <ParseReview
            questions={reviewQuestions}
            onUnitChanged={() => {
              setReviewRefresh((v) => v + 1)
              onQuestionsAdded()
            }}
            onReparse={openReparse}
            reparseDisabled={isRunning}
          />
        )}
      </div>
    </div>
  )
}

// 읽지 못해 건너뛴 페이지 안내. 무엇을 잃었는지 밝혀야 사용자가 회수를 시도할 수 있다
function SkippedNote({ pages }: { pages?: number[] }) {
  if (!pages || pages.length === 0) return null
  const shown = pages.slice(0, 12).join(', ')
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      ⚠ {pages.length}쪽 건너뜀 ({shown}
      {pages.length > 12 && ` 외 ${pages.length - 12}개`}쪽) — 분량 초과이거나 Gemini가 응답을 거부한 페이지입니다
    </p>
  )
}

function StatusChip({ status, count }: { status: FileState['status']; count?: number }) {
  const map = {
    pending: { label: '대기', cls: 'text-muted-foreground' },
    uploading: { label: '업로드', cls: 'text-blue-400' },
    analyzing: { label: '분석중', cls: 'text-yellow-400' },
    done: { label: count !== undefined ? `${count}문제` : '완료', cls: 'text-emerald-600 dark:text-emerald-400' },
    error: { label: '오류', cls: 'text-red-400' },
    paused: { label: '중단됨', cls: 'text-orange-400' },
    resumable: { label: '재개 대기', cls: 'text-orange-400' },
  }[status]
  return <span className={`font-medium ${map.cls}`}>{map.label}</span>
}