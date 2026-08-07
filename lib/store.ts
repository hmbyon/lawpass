'use client'

import type { Question, WrongNote } from './types'

const KEYS = {
  apiKey: 'lawpass_api_key',
  questions: 'lawpass_questions',
  wrongNotes: 'lawpass_wrong_notes',
} as const

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('[v0] localStorage write failed', e)
  }
}

// ── API Key ──────────────────────────────────────────────────────────────────
export function getApiKey(): string {
  return safeGet<string>(KEYS.apiKey, '')
}

export function setApiKey(key: string) {
  safeSet(KEYS.apiKey, key)
}

// ── Question Bank ─────────────────────────────────────────────────────────────
export function getQuestions(): Question[] {
  return safeGet<Question[]>(KEYS.questions, [])
}

export function saveQuestions(questions: Question[]) {
  safeSet(KEYS.questions, questions)
}

export function addQuestions(incoming: Question[]): { added: number; merged: number } {
  const existing = getQuestions()
  let added = 0
  let merged = 0

  const byPassage = new Map(existing.map((q) => [q.passage.slice(0, 100), q]))

  for (const q of incoming) {
    const key = q.passage.slice(0, 100)
    const found = byPassage.get(key)
    if (found) {
      // merge explanations
      const expl = new Set([
        ...(found.explanations ?? (found.explanation ? [found.explanation] : [])),
        ...(q.explanations ?? (q.explanation ? [q.explanation] : [])),
      ])
      found.explanations = Array.from(expl)
      found.explanation = Array.from(expl)[0] ?? null
      byPassage.set(key, found)
      merged++
    } else {
      byPassage.set(key, q)
      added++
    }
  }

  const merged_questions = Array.from(byPassage.values())
  saveQuestions(merged_questions)
  return { added, merged }
}

// ── Wrong Notes ───────────────────────────────────────────────────────────────
export function getWrongNotes(): WrongNote[] {
  return safeGet<WrongNote[]>(KEYS.wrongNotes, [])
}

export function saveWrongNotes(notes: WrongNote[]) {
  safeSet(KEYS.wrongNotes, notes)
}

export function addWrongNote(note: WrongNote) {
  const notes = getWrongNotes()
  const idx = notes.findIndex((n) => n.questionId === note.questionId)
  if (idx >= 0) {
    notes[idx] = note
  } else {
    notes.push(note)
  }
  saveWrongNotes(notes)
}

export function deleteWrongNote(id: string) {
  saveWrongNotes(getWrongNotes().filter((n) => n.id !== id))
}

export function clearAll() {
  if (typeof window === 'undefined') return
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
}
