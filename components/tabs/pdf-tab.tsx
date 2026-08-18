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

interface FileState {
  file: File
  displayName: string
  progress: number
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error' | 'paused'
  error?: string
  count?: number
  pageCount?: number
  chunkIndex?: number
  chunkTotal?: number
  resumable?: boolean
}

type UploadMode = 'file' | 'uri'

// 문제집 이름은 진행상황/PDF 캐시의 공통 키다
function sourceFileNameOf(f: { file: File; displayName: string }) {
  return f.displayName.trim() || f.file.name.replace(/\.pdf$/i, '')
}

// 저장된 진행상황으로 "중단됨" 상태의 파일 카드를 만든다
function restoredFileState(file: File, sourceFile: string, progress: PdfParseProgress): FileState {
  return {
    file,
    displayName: sourceFile,
    progress: (Math.max(0, progress.chunkIndex + 1) / Math.max(1, progress.chunkTotal)) * 100,
    status: 'paused',
    count: progress.fileQuestionCount,
    pageCount: progress.pageCount,
    chunkIndex: progress.chunkIndex + 1,
    chunkTotal: progress.chunkTotal,
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
  // 새로고침 후에도 남아 있는, 이어서 처리할 수 있는 파싱 기록
  const [pendingJobs, setPendingJobs] = useState<{ sourceFile: string; progress: PdfParseProgress }[]>([])
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
    const jobs = listPdfProgress()
    setPendingJobs(jobs)

    // 보관된 PDF 원본이 있으면 파일 재선택 없이 "중단됨" 카드로 되살린다.
    // 새로고침만으로 API를 소모하지 않도록 파싱 자체는 자동 시작하지 않는다.
    let cancelled = false
    ;(async () => {
      const restored: FileState[] = []
      for (const job of jobs) {
        const file = await loadPdfFile(job.sourceFile)
        if (file) restored.push(restoredFileState(file, job.sourceFile, job.progress))
      }
      if (cancelled || restored.length === 0) return
      setFiles((prev) => (prev.length > 0 ? prev : restored))
      // 중단 시점의 과목/시험 구분도 복원해야 재개가 0문제로 헛돌지 않는다
      const withMeta = jobs.find((j) => j.progress.subjects?.length || j.progress.examTypes?.length)
      if (withMeta?.progress.subjects?.length) {
        if (getAppMode() === 'general') setGeneralSubjectText(withMeta.progress.subjects[0])
        else setSubjects(withMeta.progress.subjects as Subject[])
      }
      if (withMeta?.progress.examTypes?.length) setExamTypes(withMeta.progress.examTypes as ExamType[])
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
    setPendingJobs(listPdfProgress())
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
    setFiles(
      selected.map((f) => ({
        file: f,
        displayName: f.name.replace(/\.pdf$/i, ''),
        progress: 0,
        status: 'pending',
      }))
    )
    setSummary(null)
  }

  function updateDisplayName(i: number, name: string) {
    setFiles((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], displayName: name }
      return next
    })
  }

  async function processFile(i: number, startChunk: number, signal?: AbortSignal): Promise<{ added: number; merged: number; aborted: boolean }> {
    const entry = files[i]
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
        subjects: activeSubjects,
        examTypes,
      })
    }

    try {
      const sourcePdf = await PDFDocument.load(await entry.file.arrayBuffer())
      totalPages = sourcePdf.getPageCount()
      chunkTotal = Math.ceil(totalPages / CHUNK_SIZE)
      updateFile(i, {
        status: 'uploading',
        progress: (startChunk / chunkTotal) * 100,
        pageCount: totalPages,
        chunkIndex: startChunk,
        chunkTotal,
        error: undefined,
        resumable: false,
      })

      for (let chunkIndex = startChunk; chunkIndex < chunkTotal; chunkIndex++) {
        const chunkPdf = await PDFDocument.create()
        const startPage = chunkIndex * CHUNK_SIZE
        const endPage = Math.min(startPage + CHUNK_SIZE, totalPages)
        const pages = await chunkPdf.copyPages(
          sourcePdf,
          Array.from({ length: endPage - startPage }, (_, p) => startPage + p)
        )
        pages.forEach((page) => chunkPdf.addPage(page))
        const chunkBytes = await chunkPdf.save()
        const chunkFile = new File(
          [chunkBytes.buffer as ArrayBuffer],
          `${entry.file.name.replace(/\.pdf$/i, '')}-chunk-${chunkIndex + 1}.pdf`,
          { type: 'application/pdf' }
        )

        updateFile(i, { status: 'uploading', progress: (chunkIndex / chunkTotal) * 100, chunkIndex: chunkIndex + 1 })
        let uri = ''
        try {
          uri = await uploadPdfToFileApi(apiKey, chunkFile, (pct) => {
            const overallProgress = ((chunkIndex + pct / 100) / chunkTotal) * 100
            updateFile(i, { progress: overallProgress })
          }, signal)
          updateFile(i, {
            status: 'analyzing',
            progress: ((chunkIndex + 0.9) / chunkTotal) * 100,
            chunkIndex: chunkIndex + 1,
          })
          await waitForFileActive(apiKey, uri)
          for (const s of activeSubjects) {
            for (const et of examTypes) {
              const questions = await extractQuestionsFromPdf(apiKey, uri, s, et, new Date().getFullYear(), signal)
              const result = addQuestions(questions, sourceFile)
              deltaAdded += result.added
              deltaMerged += result.merged
              fileQuestionCount += questions.length
            }
          }
          updateFile(i, {
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
      updateFile(i, { status: 'done', progress: 100, chunkIndex: chunkTotal, resumable: false })
      clearPdfProgress(sourceFile)
      await deletePdfFile(sourceFile)
    } catch (err) {
      // 사용자가 중단한 경우: 마지막으로 저장된 청크까지는 그대로 두고 재개 가능 상태로 표시
      aborted = isAbortError(err)
      // 첫 청크 도중에 멈춰도 "대기 중" 기록은 남겨서 새로고침 후 목록에 뜨게 한다
      if (chunkTotal > 0) saveProgress(lastCompletedChunk)
      updateFile(i, {
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
  function resolveStartChunk(entry: FileState): number {
    const saved = getPdfProgress(sourceFileNameOf(entry))
    if (!saved || saved.chunkIndex < 0) return 0
    if (saved.fileName && saved.fileName !== entry.file.name) return 0
    return saved.chunkIndex + 1
  }

  async function startAnalysis() {
    if (!apiKey || files.length === 0 || examTypes.length === 0 || activeSubjects.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    setSummary(null)
    let totalAdded = 0
    let totalMerged = 0

    for (let i = 0; i < files.length; i++) {
      const result = await processFile(i, resolveStartChunk(files[i]), controller.signal)
      totalAdded += result.added
      totalMerged += result.merged
      if (result.aborted) break // 남은 파일은 손대지 않고 대기 상태로 둔다
    }

    abortRef.current = null
    setSummary({ added: totalAdded, merged: totalMerged })
    setIsRunning(false)
    refreshSourceFiles()
    onQuestionsAdded()
  }

  async function handleResume(i: number) {
    if (!apiKey) return
    if (activeSubjects.length === 0 || examTypes.length === 0) {
      alert('과목과 시험 구분을 먼저 선택해주세요. 선택하지 않으면 문제가 추출되지 않은 채 청크만 소모됩니다.')
      return
    }
    const startChunk = resolveStartChunk(files[i])

    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    const result = await processFile(i, startChunk, controller.signal)
    abortRef.current = null
    setSummary((prev) => ({
      added: (prev?.added ?? 0) + result.added,
      merged: (prev?.merged ?? 0) + result.merged,
    }))
    setIsRunning(false)
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

    const job = pendingJobs.find((j) => j.sourceFile === sourceFile)
    if (!job) return

    if (
      job.progress.fileName &&
      picked.name !== job.progress.fileName &&
      !confirm(
        `저장된 파일명은 "${job.progress.fileName}"인데 "${picked.name}"을 선택했습니다.\n` +
        '페이지 구성이 다르면 청크 위치가 어긋나 엉뚱한 부분부터 처리됩니다. 계속할까요?'
      )
    ) return

    // 중단 시점의 과목/시험 구분 복원 (없으면 현재 선택값 유지)
    if (job.progress.subjects?.length) {
      if (isGeneral) setGeneralSubjectText(job.progress.subjects[0])
      else setSubjects(job.progress.subjects as Subject[])
    }
    if (job.progress.examTypes?.length) setExamTypes(job.progress.examTypes as ExamType[])

    const restored = restoredFileState(picked, sourceFile, job.progress)
    setFiles((prev) => {
      const idx = prev.findIndex((f) => sourceFileNameOf(f) === sourceFile)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = restored
        return next
      }
      return [...prev, restored]
    })
    setUploadMode('file')
  }

  function discardPendingJob(sourceFile: string) {
    if (!confirm(`"${sourceFile}"의 이어서 처리 기록을 삭제할까요? 이미 추가된 문제는 그대로 남습니다.`)) return
    clearPdfProgress(sourceFile)
    void deletePdfFile(sourceFile)
    setFiles((prev) => prev.filter((f) => sourceFileNameOf(f) !== sourceFile))
    setPendingJobs(listPdfProgress())
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

        {/* 새로고침 후에도 남아 있는 이어서 처리 대기 목록 */}
        {pendingJobs.filter((j) => !files.some((f) => sourceFileNameOf(f) === j.sourceFile)).length > 0 && (
          <div className="space-y-2 border border-orange-500/30 bg-orange-500/5 rounded-xl p-3">
            <p className="text-xs font-medium text-orange-400">⏸ 이어서 처리 대기 중</p>
            <p className="text-xs text-muted-foreground">
              원본 PDF가 보관된 항목은 위 파일 목록에 자동으로 복원됩니다. 여기 남은 항목은 원본이 없으니
              같은 PDF를 다시 선택해주세요. 어느 쪽이든 중단된 청크부터 이어서 처리합니다.
            </p>
            {pendingJobs
              .filter((j) => !files.some((f) => sourceFileNameOf(f) === j.sourceFile))
              .map((j) => (
                <div key={j.sourceFile} className="bg-muted rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{j.sourceFile}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {Math.max(0, j.progress.chunkIndex + 1)}/{j.progress.chunkTotal} 청크
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {j.progress.fileName ?? '파일명 기록 없음'}
                    {j.progress.fileQuestionCount > 0 && ` · ${j.progress.fileQuestionCount}문제 수집됨`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => requestResumeFromDisk(j.sourceFile)}
                      disabled={isRunning}
                      className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      파일 다시 선택
                    </button>
                    <button
                      onClick={() => discardPendingJob(j.sourceFile)}
                      disabled={isRunning}
                      className="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      기록 삭제
                    </button>
                  </div>
                </div>
              ))}
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
                    {(f.status === 'error' || f.status === 'paused') && (
                      <div className="space-y-1.5">
                        {f.status === 'paused' ? (
                          <p className="text-xs text-orange-400">
                            사용자가 중단했습니다. 완료된 청크까지는 저장되어 있습니다.
                          </p>
                        ) : (
                          <p className="text-xs text-red-400 break-all">{f.error}</p>
                        )}
                        {f.resumable && (
                          <button
                            onClick={() => handleResume(i)}
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

            {/* 💡 subjects.length === 0 대신 activeSubjects.length === 0 적용 */}
            <div className="flex gap-2">
              <button
                onClick={startAnalysis}
                disabled={isRunning || !apiKey || files.length === 0 || examTypes.length === 0 || activeSubjects.length === 0}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {isRunning ? '분석 중...' : '분석 시작'}
              </button>
              {isRunning && (
                <button
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
  }[status]
  return <span className={`font-medium ${map.cls}`}>{map.label}</span>
}