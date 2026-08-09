'use client'

import { useState, useRef } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getApiKey, setApiKey, addQuestions } from '@/lib/store'
import { uploadPdfToFileApi, waitForFileActive, extractQuestionsFromPdf, deleteFile } from '@/lib/gemini'
import type { Subject, ExamType, Question } from '@/lib/types'

const SUBJECTS: Subject[] = ['민법', '민사소송법', '상법', '형법', '형사소송법', '헌법', '행정법']
const EXAM_TYPES: ExamType[] = ['변호사시험', '모의고사']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 15 }, (_, i) => CURRENT_YEAR - i)

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
  const [examType, setExamType] = useState<ExamType>('변호사시험')
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [isRunning, setIsRunning] = useState(false)
  const [summary, setSummary] = useState<{ added: number; merged: number } | null>(null)
  const [uriStatus, setUriStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [uriError, setUriError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function saveKey(k: string) {
    setApiKeyLocal(k)
    setApiStatus('untested')
    setApiKey(k)
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
    if (!apiKey || files.length === 0) return
    setIsRunning(true)
    setSummary(null)
    let totalAdded = 0
    let totalMerged = 0

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]
      let totalPages = 0
      try {
        const sourcePdf = await PDFDocument.load(await entry.file.arrayBuffer())
        totalPages = sourcePdf.getPageCount()
        const chunkTotal = Math.ceil(totalPages / 50)
        updateFile(i, { status: 'uploading', progress: 0, pageCount: totalPages, chunkIndex: 0, chunkTotal })

        let fileQuestionCount = 0
        for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex++) {
          const chunkPdf = await PDFDocument.create()
          const startPage = chunkIndex * 50
          const endPage = Math.min(startPage + 50, totalPages)
          const pages = await chunkPdf.copyPages(sourcePdf, Array.from({ length: endPage - startPage }, (_, page) => startPage + page))
          pages.forEach((page) => chunkPdf.addPage(page))
          const chunkBytes = await chunkPdf.save()
          const chunkFile = new File([chunkBytes], `${entry.file.name.replace(/\.pdf$/i, '')}-chunk-${chunkIndex + 1}.pdf`, { type: 'application/pdf' })

          updateFile(i, { status: 'uploading', progress: 0, chunkIndex: chunkIndex + 1 })
          let uri = ''
          try {
            uri = await uploadPdfToFileApi(apiKey, chunkFile, (pct) => {
              const overallProgress = ((chunkIndex + pct / 100) / chunkTotal) * 100
              updateFile(i, { progress: overallProgress })
            })
            updateFile(i, { status: 'analyzing', progress: ((chunkIndex + 0.9) / chunkTotal) * 100, chunkIndex: chunkIndex + 1 })
            await waitForFileActive(apiKey, uri)
            const questions = await extractQuestionsFromPdf(apiKey, uri, subject, examType, year)
            const result = addQuestions(questions)
            totalAdded += result.added
            totalMerged += result.merged
            fileQuestionCount += questions.length
            updateFile(i, { progress: ((chunkIndex + 1) / chunkTotal) * 100, chunkIndex: chunkIndex + 1, count: fileQuestionCount })
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
    onQuestionsAdded()
  }

  async function startUriAnalysis() {
    if (!apiKey || !fileUri.trim()) return
    setUriStatus('analyzing')
    setUriError('')
    setSummary(null)

    try {
      const questions = await extractQuestionsFromPdf(apiKey, fileUri.trim(), subject, examType, year)
      const result = addQuestions(questions)
      setSummary({ added: result.added, merged: result.merged })
      setUriStatus('done')
      onQuestionsAdded()
    } catch (err) {
      setUriError(String(err))
      setUriStatus('error')
    }
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

      {/* Meta */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제집 정보</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            <label className="text-xs text-muted-foreground">시험 유형</label>
            <select
              value={examType}
              onChange={(e) => setExamType(e.target.value as ExamType)}
              className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">연도</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
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
              <p className="text-xs text-muted-foreground mt-1">50페이지씩 자동 분할하여 처리 · 대용량 가능</p>
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
                          style={{ width: `${f.status === 'analyzing' ? 100 : f.progress}%` }}
                        />
                      </div>
                    )}
                    {f.status === 'uploading' && f.chunkTotal && (
                      <p className="text-xs text-primary animate-pulse">
                        청크 {f.chunkIndex ?? 1}/{f.chunkTotal} 업로드 중...
                      </p>
                    )}
                    {f.status === 'analyzing' && (
                      <p className="text-xs text-primary animate-pulse">
                        청크 {f.chunkIndex ?? 1}/{f.chunkTotal ?? 1} 분석 중...
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
              disabled={isRunning || !apiKey || files.length === 0}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isRunning ? '분석 중...' : '분석 시작'}
            </button>
          </div>
        )}

        {/* File URI 입력 */}
        {uploadMode === 'uri' && (
          <div className="space-y-3">
            
              <a href="https://aistudio.google.com"
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
              disabled={uriStatus === 'analyzing' || !apiKey || !fileUri.trim()}
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
