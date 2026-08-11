'use client'

import { useState, useRef, useEffect } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getApiKey, setApiKey, addQuestions, getSourceFiles, deleteQuestionsBySource, getQuestions, getWrongNotes } from '@/lib/store'
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

export function PdfTab({ onQuestionsAdded }: { onQuestionsAdded: () => void }) {
  const [apiKey, setApiKeyLocal] = useState(() => getApiKey())
  const [apiStatus, setApiStatus] = useState<'untested' | 'ok' | 'error'>('untested')
  const [showApiKeyInfo, setShowApiKeyInfo] = useState(false)
  const [uploadMode, setUploadMode] = useState<UploadMode>('file')
  const [files, setFiles] = useState<FileState[]>([])
  const [fileUri, setFileUri] = useState('')
  const [subjects, setSubjects] = useState<Subject[]>(['민법'])
  const [examTypes, setExamTypes] = useState<ExamType[]>(['변호사시험'])
  const [isRunning, setIsRunning] = useState(false)
  const [summary, setSummary] = useState<{ added: number; merged: number } | null>(null)
  const [uriStatus, setUriStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [uriError, setUriError] = useState('')
  const [sourceFiles, setSourceFiles] = useState<{ name: string; count: number }[]>([])
  const [progress, setProgress] = useState<Record<string, ProgressRow[]>>({})
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())
  useEffect(() => {
    setSourceFiles(getSourceFiles())
    setProgress(computeProgress())
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)

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
    setFiles(selected.map((f) => ({ file: f, progress: 0, status: 'pending' })))
    setSummary(null)
  }

  async function startAnalysis() {
    if (!apiKey || files.length === 0 || examTypes.length === 0 || subjects.length === 0) return
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
            for (const s of subjects) {
              for (const et of examTypes) {
                const questions = await extractQuestionsFromPdf(apiKey, uri, s, et, new Date().getFullYear())
                const result = addQuestions(questions, sourceFile)
                totalAdded += result.added
                totalMerged += result.merged
                fileQuestionCount += questions.length
              }
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
    if (!apiKey || !fileUri.trim() || examTypes.length === 0 || subjects.length === 0) return
    setUriStatus('analyzing')
    setUriError('')
    setSummary(null)

    try {
      let totalAdded = 0
      let totalMerged = 0
      const sourceFile = fileUri.trim().split('/').pop() ?? 'URI 업로드'
      for (const s of subjects) {
        for (const et of examTypes) {
          const questions = await extractQuestionsFromPdf(apiKey, fileUri.trim(), s, et, new Date().getFullYear())
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

      {/* 진도표 */}
      {Object.keys(progress).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">진도표</h2>
          <div className="space-y-2">
            {SUBJECTS.filter((s) => progress[s]?.length).map((s) => {
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
                      {rows.map((r, i) => {
                        const icon = r.solved === 0 ? '⬜' : r.solved === r.total ? '✅' : '🔄'
                        const label = r.solved === 0 ? '미완료' : r.solved === r.total ? '완료' : '진행중'
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">
                                {r.examType} · {r.year}년 · {r.unit}
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
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">문제집 정보</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">과목 (복수 선택 가능)</label>
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
            {subjects.length === 0 && (
              <p className="text-xs text-red-400">과목을 하나 이상 선택하세요</p>
            )}
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
              disabled={isRunning || !apiKey || files.length === 0 || examTypes.length === 0 || subjects.length === 0}
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
              disabled={uriStatus === 'analyzing' || !apiKey || !fileUri.trim() || examTypes.length === 0 || subjects.length === 0}
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
