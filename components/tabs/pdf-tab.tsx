'use client'

import { useState, useRef, useEffect } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getApiKey, setApiKey, addQuestions, getSourceFiles, deleteQuestionsBySource } from '@/lib/store'
import { uploadPdfToFileApi, waitForFileActive, extractQuestionsFromPdf, deleteFile } from '@/lib/gemini'
import type { Subject, ExamType } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const CHUNK_SIZE = 5

interface FileState {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error'
  error?: string
  count?: number
  pageCount?: number
  chunkIndex?: number
  chunkTotal?: number
}

type UploadMode = 'file' | 'uri'

export function PdfTab({ onQuestionsAdded }: { onQuestionsAdded: () => void }) {
  const [apiKey, setApiKeyLocal] = useState(() => getApiKey())
  const [apiStatus, setApiStatus] = useState<'untested' | 'ok' | 'error'>('untested')
  const [uploadMode, setUploadMode] = useState<UploadMode>('file')
  const [files, setFiles] = useState<FileState[]>([])
  const [fileUri, setFileUri] = useState('')
  const [subject, setSubject] = useState<Subject>('민법')
  const [examTypes, setExamTypes] = useState<ExamType[]>(['변호사시험'])
  const [isRunning, setIsRunning] = useState(false)
  const [summary, setSummary] = useState<{ added: number; merged: number } | null>(null)
  const [uriStatus, setUriStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [uriError, setUriError] = useState('')
  const [sourceFiles, setSourceFiles] = useState<{ name: string; count: number }[]>([])
  useEffect(() => {
    setSourceFiles(getSourceFiles())
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)

  function refreshSourceFiles() {
    setSourceFiles(getSourceFiles())
  }

  function saveKey(k: string) {
    setApiKeyLocal(k)
    setApiStatus('untested')
    setApiKey(k)
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
    setFiles(selected.map((f) => ({ file: f, progress: 0, status: 'pending' })))
    setSummary(null)
  }

  async function startAnalysis() {
    if (!apiKey || files.length === 0 || examTypes.length === 0) return
    setIsRunning(true)
    setSummary(null)
    let totalAdded = 0
    let totalMerged = 0

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]
      const sourceFile = entry.file.name
      try {
        const sourcePdf = await PDFDocument.load(await entry.file.arrayBuffer())
        const totalPages = sourcePdf.getPageCount()
        const chunkTotal = Math.ceil(totalPages / CHUNK_SIZE)
        updateFile(i, { status: 'uploading', progress: 0, pageCount: totalPages, chunkIndex: 0, chunkTotal })

        let fileQuestionCount = 0
        for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex++) {
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

          updateFile(i, { status: 'uploading', progress: 0, chunkIndex: chunkIndex + 1 })
          let uri = ''
          try {
            uri = await uploadPdfToFileApi(apiKey, chunkFile, (pct) => {
              const overallProgress = ((chunkIndex + pct / 100) / chunkTotal) * 100
              updateFile(i, { progress: overallProgress })
            })
            updateFile(i, {
              status: 'analyzing',
              progress: ((chunkIndex + 0.9) / chunkTotal) * 100,
              chunkIndex: chunkIndex + 1,
            })
            await waitForFileActive(apiKey, uri)
            for (const et of examTypes) {
              const questions = await extractQuestionsFromPdf(apiKey, uri, subject, et, new Date().getFullYear())
              const result = addQuestions(questions, sourceFile)
              totalAdded += result.added
              totalMerged += result.merged
              fileQuestionCount += questions.length
            }
            updateFile(i, {
              progress: ((chunkIndex + 1) / chunkTotal) * 100,
              chunkIndex: chunkIndex + 1,
              count: fileQuestionCount,
            })
          } finally {
            if (uri) await deleteFile(apiKey, uri).catch(() => {})
          }
        }
        updateFile(i, { status: 'done', progress: 100, chunkIndex: chunkTotal })
      } catch (err) {
        updateFile(i, { status: 'error', error: String(err) })
      }
    }

    setSummary({ added: totalAdded, merged: totalMerged })
    setIsRunning(false)
    refreshSourceFiles()
    onQuestionsAdded()
  }

  async function startUriAnalysis() {
    if (!apiKey || !fileUri.trim() || examTypes.length === 0) return
    setUriStatus('analyzing')
    setUriError('')
    setSummary(null)

    try {
      let totalAdded = 0
      let totalMerged = 0
      const sourceFile = fileUri.trim().split('/').pop() ?? 'URI 업로드'
      for (const et of examTypes) {
        const questions = await extractQuestionsFromPdf(apiKey, fileUri.trim(), subject, et, new Date().getFullYear())
        const result = addQuestions(questions, sourceFile)
        totalAdded += result.added
        totalMerged += result.merged
      }
      setSummary({ added: totalAdded, merged: totalMerged })
      setUriStatus('done')
      refreshSourceFiles()
      onQuestionsAdded()
    } catch (err) {
      setUriError(String(err))
      setUriStatus('error')
    }
  }

  function handleDeleteSource(name: string) {
    if (!confirm(`"${name}" 파일의 문제를 모두 삭제할까요?`)) return
    deleteQuestionsBySource(name)
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
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="AIza..."
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={testApiKey}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            연결 확인
          </button>
        </div>
        {apiStatus === 'ok' && <p className="text-xs text-emerald-400">연결 성공</p>}
        {apiStatus === 'error' && <p className="text-xs text-red-400">연결 실패 — API 키를 확인하세요</p>}
      </div>

      {/* 업로드된 파일 목록 */}
      {sourceFiles.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">업로드된 문제집</h2>
          <div className="space-y-2">
            {sourceFiles.map(({ name, count }) => (
              <div key={name} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">{count}문제</p>
                </div>
                <button
                  onClick={() => handleDeleteSource(name)}
                  className="text-xs text-red-400 hover:text-red-300 shrink-0 transition-colors"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제집 정보</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">과목</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value as Subject)}
              className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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
                  <div key={i} className="bg-muted rounded-lg p-3 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium truncate max-w-[60%]">{f.file.name}</span>
                      <StatusChip status={f.status} count={f.count} />
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
                    {f.status === 'error' && (
                      <p className="text-xs text-red-400 break-all">{f.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={startAnalysis}
              disabled={isRunning || !apiKey || files.length === 0 || examTypes.length === 0}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isRunning ? '분석 중...' : '분석 시작'}
            </button>
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

            <button
              onClick={startUriAnalysis}
              disabled={uriStatus === 'analyzing' || !apiKey || !fileUri.trim() || examTypes.length === 0}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {uriStatus === 'analyzing' ? 'Gemini 분석 중...' : '분석 시작'}
            </button>
          </div>
        )}

        {summary && (
          <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3 text-sm">
            <p className="text-emerald-300 font-medium">
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
    done: { label: count !== undefined ? `${count}문제` : '완료', cls: 'text-emerald-400' },
    error: { label: '오류', cls: 'text-red-400' },
  }[status]
  return <span className={`font-medium ${map.cls}`}>{map.label}</span>
}
