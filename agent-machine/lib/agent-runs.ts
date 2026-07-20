// Agent runs + routines — the shared spine for Dispatch (manual, standalone agent runs) and Routines
// (scheduled recurring runs). A "run" is an agent executing OUTSIDE a chat: it drives the same headless
// tool loop dispatch_agent uses (runSubAgent in server.ts), but as a top-level, persisted job. Both
// stores are encrypted at rest (at-rest.ts) under ~/.noetica.

import path from 'node:path'
import os from 'node:os'
import { writeJson, readJson } from './at-rest.js'

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type RunSource = 'manual' | 'routine'

export interface AgentRun {
  id: string
  title: string
  prompt: string
  role: string
  status: RunStatus
  source: RunSource
  routineId?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  error?: string
}

export type ScheduleKind = 'hourly' | 'daily' | 'weekly'
export interface Schedule {
  kind: ScheduleKind
  hour?: number     // 0–23 (daily / weekly)
  minute?: number   // 0–59
  weekday?: number  // 0–6, Sun=0 (weekly)
}

export interface Routine {
  id: string
  title: string
  prompt: string
  role: string
  schedule: Schedule
  enabled: boolean
  createdAt: number
  lastRun?: number
  nextRun: number
}

const RUNS_PATH = path.join(os.homedir(), '.noetica', 'agent-runs.json')
const ROUTINES_PATH = path.join(os.homedir(), '.noetica', 'routines.json')
const MAX_RUNS = 200   // keep the store bounded — oldest runs age out

// ── Runs ────────────────────────────────────────────────────────────────────
export function loadRuns(): AgentRun[] { return readJson<AgentRun[]>(RUNS_PATH) ?? [] }
function saveRuns(runs: AgentRun[]): void { writeJson(RUNS_PATH, runs.slice(-MAX_RUNS)) }
export function listRuns(limit = 50): AgentRun[] { return loadRuns().slice(-limit).reverse() }
export function getRun(id: string): AgentRun | null { return loadRuns().find((r) => r.id === id) ?? null }
export function upsertRun(run: AgentRun): void {
  const runs = loadRuns()
  const i = runs.findIndex((r) => r.id === run.id)
  if (i >= 0) runs[i] = run
  else runs.push(run)
  saveRuns(runs)
}

// ── Routines ──────────────────────────────────────────────────────────────────
export function loadRoutines(): Routine[] { return readJson<Routine[]>(ROUTINES_PATH) ?? [] }
function saveRoutines(rs: Routine[]): void { writeJson(ROUTINES_PATH, rs) }
export function upsertRoutine(r: Routine): void {
  const rs = loadRoutines()
  const i = rs.findIndex((x) => x.id === r.id)
  if (i >= 0) rs[i] = r
  else rs.push(r)
  saveRoutines(rs)
}
export function deleteRoutine(id: string): void { saveRoutines(loadRoutines().filter((r) => r.id !== id)) }

// ── Schedule math ─────────────────────────────────────────────────────────────
// Next fire time (ms epoch) strictly after `from` for a schedule. v1 supports hourly / daily / weekly.
export function computeNextRun(s: Schedule, from: number): number {
  const hour = s.hour ?? 9, minute = s.minute ?? 0
  if (s.kind === 'hourly') {
    const n = new Date(from); n.setMinutes(minute, 0, 0)
    if (n.getTime() <= from) n.setHours(n.getHours() + 1)
    return n.getTime()
  }
  if (s.kind === 'daily') {
    const n = new Date(from); n.setHours(hour, minute, 0, 0)
    if (n.getTime() <= from) n.setDate(n.getDate() + 1)
    return n.getTime()
  }
  // weekly
  const wd = s.weekday ?? 1
  const n = new Date(from); n.setHours(hour, minute, 0, 0)
  let add = (wd - n.getDay() + 7) % 7
  if (add === 0 && n.getTime() <= from) add = 7
  n.setDate(n.getDate() + add)
  return n.getTime()
}

export function describeSchedule(s: Schedule): string {
  const hh = String(s.hour ?? 9).padStart(2, '0'), mm = String(s.minute ?? 0).padStart(2, '0')
  if (s.kind === 'hourly') return `Hourly at :${mm}`
  if (s.kind === 'daily') return `Daily at ${hh}:${mm}`
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `Weekly · ${days[s.weekday ?? 1]} at ${hh}:${mm}`
}

// Routines whose nextRun has passed and that are enabled — due to fire.
export function dueRoutines(now: number): Routine[] {
  return loadRoutines().filter((r) => r.enabled && r.nextRun <= now)
}
