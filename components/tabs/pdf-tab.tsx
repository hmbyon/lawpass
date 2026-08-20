'use client'

import { useState, useRef, useEffect } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getApiKey, setApiKey, addQuestions, getSourceFiles, deleteQuestionsBySource, mergeSourceFiles, getQuestions, getWrongNotes } from '@/lib/store'
import {
  uploadPdfToFileApi, waitForFileActive, extractQuestionsFromPdf, deleteFile,
  savePdfProgress, getPdfProgress, clearPdfProgress, listPdfProgress, isAbortError,
} from '@/lib/gemini'
import type { PdfParseProgress } from '@/lib/gemini'
import { savePdfFile, loadPdfFile, deletePdfFile } from '@/lib/pdfCache'
import { getAppMode } from '@/lib/appMode'
import type { Subject, ExamType } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const CHUNK_SIZE = 5
// 청크 경계에 걸친 문제가 최소 한 청크에는 온전히 들어가도록 이전 청크의 마지막 페이지를 겹쳐 담는다.
// 청크 개수(=API 호출 횟수)는 그대로이고 청크당 페이지만 늘어난다
const CHUNK_OVERLAP = 1

// Vercel 서버리스 함수의 요청 본문 한도는 4.5MB이고 설정으로 늘릴 수 없다.
// 413은 함수가 실행되기도 전에 플랫폼이 반환하므로 서버 코드로는 막을 수 없다.
// multipart 경계·apiKey 필드 오버헤드를 감안해 여유를 두고 잡는다
const MAX_UPLOAD_BYTES = 4_000_000 // 업로드 직전 차단선
const CHUNK_BUDGET_BYTES = 3_200_000 // 청크 페이지 수를 정할 때의 목표치

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

// 청크가 담을 페이지 범위. 첫 청크는 그대로, 이후 청크는 시작점을 당겨 직전 청크의 마지막 페이지를 포함시킨다
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

// 스캔본처럼 페이지당 용량이 크면 5페이지 청크가 4.5MB를 넘어 413이 난다.
// 페이지 수만 세고 바이트를 안 보면 알 수 없으므로, 첫 청크를 실제로 만들어 재고
// 한도를 넘으면 페이지 수를 줄여 다시 만든다. 업로드 전에 끝나므로 API 호출은 낭비되지 않는다
async function calibrateChunkSize(sourcePdf: PDFDocument, totalPages: number): Promise<number> {
  let size = CHUNK_SIZE
  for (let attempt = 0; attempt < 4 && size > 1; attempt++) {
    // 첫 청크는 겹침 페이지가 없어 이후 청크보다 작다. 그걸로 재면 과소평가하므로
    // 겹침까지 포함한 최악 케이스(size + CHUNK_OVERLAP 페이지)로 잰다
    const endPage = Math.min(size + CHUNK_OVERLAP, totalPages)
    const bytes = await buildChunkBytes(sourcePdf, 0, endPage)
    if (bytes.byteLength <= CHUNK_BUDGET_BYTES) break
    const fit = Math.floor(size * (CHUNK_BUDGET_BYTES / bytes.byteLength))
    size = Math.max(1, Math.min(size - 1, fit)) // 최소 1페이지는 보장하고, 최소 1페이지씩은 줄인다
  }
  return size
}

// 파일 카드/재개 항목이 공통으로 쓰는 표시 상태
interface JobView {
  progress: number
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error' | 'paused' | 'resumable'
  error?: string
  count?: number
  pageCount?: number
  chunkIndex?: number
  chunkTotal?: number
  chunkSize?: number // 자동 조정된 청크 페이지 수 (기본값보다 작아졌을 때만 안내한다)
  resumable?: boolean
}

// 새로 업로드해서 처리를 기다리는 파일
interface FileState extends JobView {
  file: File
  displayName: string
}

// 이전에 중단돼 진행상황이 남아 있는 파일. 신규 업로드 큐와 완전히 분리해서 관리한다
interface ResumeJob {
  sourceFile: string
  saved: PdfParseProgress
  file: File | null // IndexedDB 복원 실패 시 null → "파일 다시 선택" 필요
  view: JobView
}

type UploadMode = 'file' | 'uri'

// 파싱에 쓰이는 선택 메타데이터. 폼 상태를 클로저로 읽지 않고 명시적으로 넘긴다
// (재개 항목은 중단 시점의 값으로 처리해야 하므로 둘이 다를 수 있다)
interface ParseMeta {
  subjects: Subject[]
  examTypes: ExamType[]
}

// 문제집 이름은 진행상황/PDF 캐시의 공통 키다
function sourceFileNameOf(f: { file: File; displayName: string }) {
  return f.displayName.trim() || f.file.name.replace(/\.pdf$/i, '')
}

// 저장된 진행상황으로 "재개 대기" 표시 상태를 만든다.
// 이번 세션에서 중단 버튼을 누른 것과 구분하려고 'paused'가 아닌 'resumable'을 쓴다
function resumeJobView(progress: PdfParseProgress): JobView {
  return {
    progress: (Math.max(0, progress.chunkIndex + 1) / Math.max(1, progress.chunkTotal)) * 100,
    status: 'resumable',
    count: progress.fileQuestionCount,
    pageCount: progress.pageCount,
    chunkIndex: progress.chunkIndex + 1,
    chunkTotal: progress.chunkTotal,
    chunkSize: progress.chunkSize,
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

// 과목별 진도표 계산: 최소 한 번 풀어본(정답/오답 기록이 있는) 문제 id 기준
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

// 과목 내 rows를 연도별로 묶고 연도 내림차순 정렬
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

// 과목 내 rows를 단원별로 묶고 단원명 오름차순 정렬
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

export function PdfTab({ onQuestionsAdded }: { onQuestionsAdded: () => void }) {
  const [appMode] = useState(() => getAppMode())
  const isGeneral = appMode === 'general'

  const [apiKey, setApiKeyLocal] = useState(() => getApiKey())
  const [apiStatus, setApiStatus] = useState<'untested' | 'ok' | 'error'>('untested')
  const [showApiKeyInfo, setShowApiKeyInfo] = useState(false)
  const [uploadMode, setUploadMode] = useState<UploadMode>('file')
  const [files, setFiles] = useState<FileState[]>([])
  const [fileUri, setFileUri] = useState('')
  
  // 💡 기본값 빈 배열([])로 수정
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [generalSubjectText, setGeneralSubjectText] = useState('')
  const [examTypes, setExamTypes] = useState<ExamType[]>(isGeneral ? ['모의고사'] : [])

  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // 이전에 중단된 파일들 (신규 업로드 큐와 완전히 분리)
  const [resumeJobs, setResumeJobs] = useState<ResumeJob[]>([])
  const [runningKey, setRunningKey] = useState<string | null>(null) // 현재 처리 중인 항목의 sourceFile
  const [hydrated, setHydrated] = useState(false) // IndexedDB 복원 완료 여부 (완료 전엔 대기 목록을 그리지 않는다)
  const [actionError, setActionError] = useState<string | null>(null)
  const resumeInputRef = useRef<HTMLInputElement>(null)
  const resumeTargetRef = useRef<string | null>(null)
  const [summary, setSummary] = useState<{ added: number; merged: number } | null>(null)
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

    // 보관된 PDF 원본이 있으면 파일 재선택 없이 카드로 되살린다.
    // 새로고침만으로 API를 소모하지 않도록 파싱 자체는 자동 시작하지 않는다.
    //
    // 대기 목록(pendingJobs)을 먼저 그린 뒤 복원 결과가 늦게 도착하면 섹션이 줄어들며
    // 버튼이 밀려서 첫 클릭이 씹힌다. 그래서 복원이 끝난 뒤 한 번에 반영한다.
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
      // 중단 시점의 과목/시험 구분을 폼에도 되살린다.
      // 각 재개 항목은 자기 저장값으로 처리되므로(resolveMeta) 이건 화면 표시용이다.
      // 항목마다 과목이 다르면 아무거나 하나를 골라 보여주는 게 오히려 오해를 부르므로 그때는 비워 둔다
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
    // 재개 대기 큐(resumeJobs)와는 완전히 분리된 배열이라 새 선택이 기존 재개 항목에 영향을 주지 않는다
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

  // 다음 문제집을 위해 문제집 정보 선택을 초기 상태로 되돌린다.
  // 재개 대기 항목은 각자 저장된 과목으로 처리되므로(resolveMeta) 여기서 비워도 영향이 없다
  function resetBookForm() {
    setSubjects([])
    setGeneralSubjectText('')
    setExamTypes(isGeneral ? ['모의고사'] : [])
  }

  // 큐를 비우면 문제집 정보도 함께 초기화한다 (다음 파일은 새로 고르게)
  function clearQueue() {
    setFiles([])
    resetBookForm()
    setSummary(null)
    setActionError(null)
  }

  function updateDisplayName(i: number, name: string) {
    setFiles((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], displayName: name }
      return next
    })
  }

  // 신규 업로드 카드와 재개 항목이 공유하는 처리 루틴.
  // 어느 목록에 속하는지는 update 콜백이 결정하므로 두 큐가 서로 간섭하지 않는다
  async function processEntry(
    entry: { file: File; displayName: string },
    startChunk: number,
    update: (patch: Partial<JobView>) => void,
    meta: ParseMeta,
    signal?: AbortSignal
  ): Promise<{ added: number; merged: number; aborted: boolean }> {
    const sourceFile = sourceFileNameOf(entry)
    // startChunk가 0이어도 기록을 읽어야 누적 문제 수/추가 수가 리셋되지 않는다
    const savedProgress = getPdfProgress(sourceFile)
    // 새로고침 후 파일 재선택 없이 이어서 처리할 수 있도록 원본을 보관 (완료 시 삭제)
    await savePdfFile(sourceFile, entry.file)
    let fileQuestionCount = savedProgress?.fileQuestionCount ?? 0
    let deltaAdded = 0
    let deltaMerged = 0
    let aborted = false
    let lastCompletedChunk = startChunk - 1 // 이번 실행에서 아직 끝낸 청크 없음
    let chunkTotal = 0
    let totalPages = 0
    let chunkSize = CHUNK_SIZE

    // 새로고침 후에도 재개할 수 있도록 파일명/과목까지 함께 남긴다
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
      })
    }

    try {
      const sourcePdf = await PDFDocument.load(await entry.file.arrayBuffer())
      totalPages = sourcePdf.getPageCount()
      // 재개 중이면 중단 시점의 청크 크기를 그대로 쓴다.
      // 여기서 값이 달라지면 저장된 청크 번호가 가리키는 페이지가 통째로 어긋난다
      chunkSize =
        startChunk > 0
          ? (savedProgress?.chunkSize ?? CHUNK_SIZE)
          : await calibrateChunkSize(sourcePdf, totalPages)
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
        const chunkBytes = await buildChunkBytes(sourcePdf, startPage, endPage)
        // 평균으로 고른 청크 크기가 유독 무거운 페이지에서 빗나갈 수 있다.
        // 413은 서버에서 못 막으므로 보내기 전에 여기서 걸러 원인을 분명히 알린다
        if (chunkBytes.byteLength > MAX_UPLOAD_BYTES) {
          throw new Error(
            `${chunkIndex + 1}번째 청크가 ${mb(chunkBytes.byteLength)}MB로 업로드 한도(4.5MB)를 넘습니다. ` +
              (chunkSize > 1
                ? `이 PDF는 페이지당 용량이 커서 청크를 ${chunkSize}페이지보다 더 잘게 나눠야 합니다. ` +
                  '기록을 삭제하고 다시 시작해주세요.'
                : '한 페이지만으로도 한도를 넘습니다. PDF를 압축하거나 해상도를 낮춰 다시 올려주세요.')
          )
        }
        const chunkFile = new File(
          [chunkBytes.buffer as ArrayBuffer],
          `${entry.file.name.replace(/\.pdf$/i, '')}-chunk-${chunkIndex + 1}.pdf`,
          { type: 'application/pdf' }
        )

        update({ status: 'uploading', progress: (chunkIndex / chunkTotal) * 100, chunkIndex: chunkIndex + 1 })
        let uri = ''
        try {
          uri = await uploadPdfToFileApi(apiKey, chunkFile, (pct) => {
            const overallProgress = ((chunkIndex + pct / 100) / chunkTotal) * 100
            update({ progress: overallProgress })
          }, signal)
          update({
            status: 'analyzing',
            progress: ((chunkIndex + 0.9) / chunkTotal) * 100,
            chunkIndex: chunkIndex + 1,
          })
          await waitForFileActive(apiKey, uri)
          for (const s of meta.subjects) {
            for (const et of meta.examTypes) {
              const questions = await extractQuestionsFromPdf(apiKey, uri, s, et, new Date().getFullYear(), signal)
              const result = addQuestions(questions, sourceFile)
              deltaAdded += result.added
              deltaMerged += result.merged
              fileQuestionCount += questions.length
            }
          }
          update({
            progress: ((chunkIndex + 1) / chunkTotal) * 100,
            chunkIndex: chunkIndex + 1,
            count: fileQuestionCount,
          })
          lastCompletedChunk = chunkIndex
          saveProgress(chunkIndex)
        } finally {
          if (uri) await deleteFile(apiKey, uri).catch(() => {})
        }
      }
      update({ status: 'done', progress: 100, chunkIndex: chunkTotal, resumable: false })
      clearPdfProgress(sourceFile)
      await deletePdfFile(sourceFile)
    } catch (err) {
      // 사용자가 중단한 경우: 마지막으로 저장된 청크까지는 그대로 두고 재개 가능 상태로 표시
      aborted = isAbortError(err)
      // 첫 청크 도중에 멈춰도 "대기 중" 기록은 남겨서 새로고침 후 목록에 뜨게 한다
      if (chunkTotal > 0) saveProgress(lastCompletedChunk)
      update({
        status: aborted ? 'paused' : 'error',
        error: aborted ? undefined : String(err),
        resumable: true,
        count: fileQuestionCount,
      })
    }

    return { added: deltaAdded, merged: deltaMerged, aborted }
  }

  // 진행 중인 업로드/분석 fetch를 중단. 완료된 청크는 savePdfProgress에 남아 있어 나중에 재개 가능
  function stopAnalysis() {
    abortRef.current?.abort()
  }

  // 저장된 진행상황이 있으면 그 다음 청크부터. 다른 PDF를 같은 이름으로 올린 경우엔 처음부터
  function resolveStartChunk(entry: { file: File; displayName: string }): number {
    const saved = getPdfProgress(sourceFileNameOf(entry))
    if (!saved || saved.chunkIndex < 0) return 0
    if (saved.fileName && saved.fileName !== entry.file.name) return 0
    return saved.chunkIndex + 1
  }

  // 재개 항목은 중단 시점에 선택돼 있던 과목/시험 구분으로 처리한다.
  // 폼의 현재값을 쓰면 대기열을 비웠거나 다른 문제집을 고른 뒤 재개할 때 엉뚱한 과목으로 저장된다
  function resolveMeta(saved: PdfParseProgress | null | undefined): ParseMeta {
    return {
      subjects: saved?.subjects?.length ? (saved.subjects as Subject[]) : activeSubjects,
      examTypes: saved?.examTypes?.length ? (saved.examTypes as ExamType[]) : examTypes,
    }
  }

  // 실제로 쓰이는 값을 폼에도 반영해 사용자가 무엇으로 처리되는지 볼 수 있게 한다
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

    // 재개 대기 큐(resumeJobs)는 여기서 절대 건드리지 않는다. 각 항목의 "이어서 처리하기"로만 시작된다
    for (let i = 0; i < files.length; i++) {
      const entry = files[i]
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
      if (result.aborted) break // 남은 파일은 손대지 않고 대기 상태로 둔다
    }

    setRunningKey(null)
    abortRef.current = null
    setSummary({ added: totalAdded, merged: totalMerged })
    setIsRunning(false)
    // 끝까지 처리된 파일만 큐에서 뺀다. 중단·오류 항목은 이어서 처리할 수 있게 남긴다
    setFiles((prev) => {
      const rest = prev.filter((f) => f.status !== 'done')
      if (rest.length === 0) resetBookForm()
      return rest
    })
    refreshSourceFiles()
    onQuestionsAdded()
  }

  async function handleResumeFile(i: number) {
    // 어떤 이유로든 아무 일도 안 일어난 것처럼 보이지 않도록 화면에 사유를 남긴다
    // (alert는 브라우저가 "추가 대화상자 표시 안 함"으로 억제할 수 있어 쓰지 않는다)
    const entry = files[i]
    if (!entry) {
      setActionError('파일 정보를 찾을 수 없습니다. 페이지를 새로고침해주세요.')
      return
    }
    if (!apiKey) {
      setActionError('Gemini API 키를 먼저 입력해주세요.')
      return
    }
    // 저장된 진행상황이 있으면 그때 고른 과목으로 이어간다 (폼을 다시 고를 필요 없음)
    const meta = resolveMeta(getPdfProgress(sourceFileNameOf(entry)))
    if (meta.subjects.length === 0 || meta.examTypes.length === 0) {
      setActionError('과목과 시험 구분을 먼저 선택해주세요. 선택하지 않으면 문제가 추출되지 않은 채 청크만 소모됩니다.')
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
    }))
    setIsRunning(false)
    refreshSourceFiles()
    onQuestionsAdded()
  }

  function updateResumeJob(sourceFile: string, patch: Partial<JobView>) {
    setResumeJobs((prev) =>
      prev.map((j) => (j.sourceFile === sourceFile ? { ...j, view: { ...j.view, ...patch } } : j))
    )
  }

  // 재개 대기 항목 하나만 처리한다. 신규 업로드 큐는 건드리지 않는다
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
    // 중단 시점의 과목/시험 구분으로 이어간다. 폼이 비어 있어도 재개가 막히지 않는다
    const meta = resolveMeta(job.saved)
    if (meta.subjects.length === 0 || meta.examTypes.length === 0) {
      setActionError('과목과 시험 구분을 먼저 선택해주세요. 선택하지 않으면 문제가 추출되지 않은 채 청크만 소모됩니다.')
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
    }))
    // 끝까지 처리된 항목은 진행상황 기록이 지워지므로 목록에서도 제거한다
    if (!getPdfProgress(sourceFile)) {
      setResumeJobs((prev) => prev.filter((j) => j.sourceFile !== sourceFile))
    }
    refreshSourceFiles()
    onQuestionsAdded()
  }

  // 새로고침 후 재개: File 객체는 localStorage에 담을 수 없어 같은 PDF를 다시 고르게 한다
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
        '페이지 구성이 다르면 청크 위치가 어긋나 엉뚱한 부분부터 처리됩니다. 계속할까요?'
      )
    ) return

    // 중단 시점의 과목/시험 구분 복원 (없으면 현재 선택값 유지)
    applyMetaToForm(resolveMeta(job.saved))

    // 다음 새로고침 때 다시 고르지 않도록 원본을 캐시에 넣어둔다
    void savePdfFile(sourceFile, picked)
    setResumeJobs((prev) => prev.map((j) => (j.sourceFile === sourceFile ? { ...j, file: picked } : j)))
    setActionError(null)
  }

  function discardResumeJob(sourceFile: string) {
    if (!confirm(`"${sourceFile}"의 이어서 처리 기록을 삭제할까요? 이미 추가된 문제는 그대로 남습니다.`)) return
    clearPdfProgress(sourceFile)
    void deletePdfFile(sourceFile)
    setResumeJobs((prev) => prev.filter((j) => j.sourceFile !== sourceFile))
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
      setSummary({ added: totalAdded, merged: totalMerged })
      setUriStatus('done')
      refreshSourceFiles()
      onQuestionsAdded()
    } catch (err) {
      if (isAbortError(err)) {
        setUriStatus('idle') // 중단: 같은 URI로 다시 시작할 수 있게 초기 상태로 되돌린다
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
              <p>PDF 문제집에서 문제를 자동으로 추출·분석하기 위해 Google Gemini API를 사용합니다. 이 작업에는 개인 API 키가 필요합니다.</p>
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
              <p className="pt-1">무료 요금제로도 충분히 사용 가능합니다.</p>
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

        {/* 재개 대기 큐: 신규 업로드와 완전히 분리된 별도 영역. 각 항목의 버튼으로만 시작된다 */}
        {hydrated && resumeJobs.length > 0 && (
          <div className="space-y-2 border border-orange-500/30 bg-orange-500/5 rounded-xl p-3">
            <p className="text-xs font-medium text-orange-400">⏸ 이어서 처리 대기 중</p>
            <p className="text-xs text-muted-foreground">
              이전에 중단된 파일입니다. 아래 버튼을 직접 누를 때만 처리되며, 새 파일 업로드나 &quot;분석 시작&quot;에는
              영향을 받지 않습니다.
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
                  {!j.file && (
                    <p className="text-xs text-muted-foreground">
                      보관된 원본이 없습니다. 같은 PDF를 다시 선택해주세요.
                    </p>
                  )}
                  {(j.saved.subjects?.length || j.saved.examTypes?.length) && (
                    <p className="text-xs text-muted-foreground">
                      중단 시점 선택: {[j.saved.subjects?.join(', '), j.saved.examTypes?.join(', ')]
                        .filter(Boolean)
                        .join(' · ')} (그대로 이어서 처리됩니다)
                    </p>
                  )}

                  <div className="flex gap-2 items-center">
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
                        (기본 {CHUNK_SIZE}페이지)
                      </p>
                    )}
                    {f.status === 'uploading' && f.chunkTotal && (
                      <p className="text-xs text-primary animate-pulse">
                        청크 {f.chunkIndex ?? 1}/{f.chunkTotal} 업로드 중...
                        {f.pageCount && ` (총 ${f.pageCount}페이지)`}
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
                          <p className="text-xs text-orange-400">
                            사용자가 중단했습니다. 완료된 청크까지는 저장되어 있습니다.
                          </p>
                        )}
                        {f.status === 'resumable' && (
                          <p className="text-xs text-orange-400">
                            이전에 처리하던 진행상황이 남아 있습니다. 아래 버튼으로 이어서 처리하세요.
                          </p>
                        )}
                        {f.status === 'error' && (
                          <p className="text-xs text-red-400 break-all">{f.error}</p>
                        )}
                        {f.resumable && (
                          <button
                            type="button"
                            onClick={() => handleResumeFile(i)}
                            disabled={isRunning}
                            className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

            {/* 💡 subjects.length === 0 대신 activeSubjects.length === 0 적용 */}
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

            <div className="bg-muted rounded-lg p-3 space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">AI Studio에서 File URI 얻는 법</p>
              <p>1. aistudio.google.com 접속</p>
              <p>2. 우측 상단 파일 아이콘 클릭 → PDF 업로드</p>
              <p>3. 업로드된 파일 클릭 → "Copy file URI" 선택</p>
              <p>4. 아래 입력란에 붙여넣기</p>
            </div>

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

            {/* 💡 subjects.length === 0 대신 activeSubjects.length === 0 적용 */}
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
          </div>
        )}
      </div>
    </div>
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