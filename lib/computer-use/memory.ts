'use client'

// Episodic memory for computer use sessions.
// Stores traces of past goal → steps sequences, indexed by inferred app/domain,
// so the Agent S planner can surface relevant past experience before acting.

export interface EpisodicTrace {
  id: string
  goal: string
  appContext: string    // inferred from goal: "Safari", "TextEdit", "Finder", etc.
  stepSummary: string  // short summary of what was done
  succeeded: boolean
  createdAt: string
}

const MEMORY_KEY = 'noetica:computer-use:memory'
const MAX_TRACES = 50

function load(): EpisodicTrace[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '[]') as EpisodicTrace[]
  } catch { return [] }
}

function save(traces: EpisodicTrace[]): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(traces.slice(-MAX_TRACES))) } catch { /* quota */ }
}

export function saveTrace(trace: Omit<EpisodicTrace, 'id' | 'createdAt'>): void {
  const traces = load()
  traces.push({ ...trace, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
  save(traces)
}

export function getRelevantTraces(goal: string, limit = 5): EpisodicTrace[] {
  const traces = load()
  const goalLower = goal.toLowerCase()
  // Score by keyword overlap
  return traces
    .map((t) => {
      const words = goalLower.split(/\s+/)
      const score = words.filter((w) => t.goal.toLowerCase().includes(w) || t.appContext.toLowerCase().includes(w)).length
      return { trace: t, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ trace }) => trace)
}

export function getAllTraces(): EpisodicTrace[] {
  return load().slice().reverse()
}

export function clearMemory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(MEMORY_KEY)
}
