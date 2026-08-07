'use client'

import { useState, useRef } from 'react'
import { getApiKey, addQuestions } from '@/lib/store'
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
}

export function PdfTab({ onQuestionsAdded }: { onQuestionsAdded: () => void }) {
  const [apiKey, setApiKeyLocal] = useState(() => getApiKey())
  const [apiStatus, setApiStatus] = useState<'untested' | 'ok' | 'error'>('untested')
  const [files, setFiles] = useState<FileState[]>([])
  const [subject, setSubject] = useState<Subject>('민법')
  const [examType, setExamType] = useState<ExamType>('변호사시험')
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [isRunning, setIsRunning] = useState(false)
  const [summary, setSummary] = useState<{ added: number; merged: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function saveKey(k: string) {
    setApiKeyLocal(k)
    setApiStatus('untested')
    if (typeof window !== 'undefined') {
      localStorage.setItem('lawpass_api_key', k)
    }
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
      updateFile(i, { status: 'uploading', progress: 0 })

      let fileUri = ''
      try {
        fileUri = await uploadPdfToFileApi(apiKey, entry.file, (pct) => {
          updateFile(i, { progress: pct })
        })
        updateFile(i, { status: 'analyzing', progress: 100 })

        await waitForFileActive(apiKey, fileUri)

        const questions = await extractQuestionsFromPdf(apiKey, fileUri, subject, examType, year)
        const result = addQuestions(questions)
        totalAdded += result.added
        totalMerged += result.merged

        updateFile(i, { status: 'done', count: questions.length })
      } catch (err) {
        updateFile(i, { status: 'error', error: String(err) })
      } finally {
        if (fileUri) {
          deleteFile(apiKey, fileUri).catch(() => {})
        }
      }
    }

    setSummary({ added: totalAdded, merged: totalMerged })
    setIsRunning(false)
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
        {apiStatus === 'ok' && (
          <p className="text-xs text-emerald-400">연결 성공 — gemini-2.5-flash 사용 가능</p>
        )}
        {apiStatus === 'error' && (
          <p className="text-xs text-red-400">연결 실패 — API 키를 확인하세요</p>
        )}
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
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">시험 유형</label>
            <select
              value={examType}
              onChange={(e) => setExamType(e.target.value as ExamType)}
              className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {EXAM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">연도</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* File Upload */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm text-foreground">PDF 업로드</h2>
        <div
          className="border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-8 text-center cursor-pointer transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <div className="text-4xl mb-2">📄</div>
          <p className="text-sm text-muted-foreground">
            PDF 파일을 클릭하여 선택하거나 여러 파일을 동시에 업로드하세요
          </p>
          <p className="text-xs text-muted-foreground mt-1">Gemini File API로 대용량 파일 처리</p>
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
                {f.status === 'analyzing' && (
                  <p className="text-xs text-primary animate-pulse">Gemini 분석 중...</p>
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

        {summary && (
          <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3 text-sm">
            <p className="text-emerald-300 font-medium">
              완료: <span className="font-bold">{summary.added}문제</span> 추가,{' '}
              <span className="font-bold">{summary.merged}문제</span> 병합 (중복 해설 통합)
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
