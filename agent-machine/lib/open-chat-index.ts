/**
 * open-chat-index.ts — the searchable store of OPT-IN open chats (the community commons).
 *
 * Only chats the user has explicitly opened live here, and only ever as REDACTED snapshots: every write goes
 * through gateOpenChat (open-chat-gate.ts) first, so raw PII/secrets never enter the corpus other users' agents
 * search. Publication FAILS CLOSED — if the gate can't run, nothing is indexed. Revocation is immediate: flipping
 * a chat back to private deletes its entry so no other agent can reach it (no cached window).
 *
 * Storage mirrors collections.ts: a Map keyed by sessionId (proto-safe), persisted encrypted-at-rest. The map
 * holds the masked text only — never the placeholder→value mapping (the gate discards it), so the store itself
 * cannot reverse a redaction even if exfiltrated.
 */
import * as path from 'node:path'
import * as os from 'node:os'
import { gateOpenChat, type OpenChatMessage, type GateFindings } from './open-chat-gate.js'
import { forwardPublish, forwardRevoke } from './commons-federation.js'

const STORE = path.join(os.homedir(), '.noetica', 'open-chats.json')

export interface OpenChatEntry {
  sessionId: string
  title: string
  /** Fully-redacted, exfil-scrubbed text — the ONLY chat content stored. */
  redacted: string
  publishedAt: string
  /** What the gate masked at publish time (for the author's records / audit). */
  findings: GateFindings
}

export interface OpenChatHit {
  sessionId: string
  title: string
  /** A redacted snippet around the match. */
  snippet: string
  score: number
  publishedAt: string
}

// Map (not a plain object) so a hostile sessionId ("__proto__"/"constructor") can't reach Object.prototype.
let cache: Map<string, OpenChatEntry> | null = null
function load(): Map<string, OpenChatEntry> {
  if (cache) return cache
  try { const { readJson } = require('./at-rest.js') as typeof import('./at-rest.js'); cache = new Map(Object.entries(readJson<Record<string, OpenChatEntry>>(STORE) ?? {})) }
  catch { cache = new Map() }
  return cache
}
function persist(): void {
  const obj = Object.fromEntries(cache ?? new Map<string, OpenChatEntry>())
  try { const { writeJson } = require('./at-rest.js') as typeof import('./at-rest.js'); writeJson(STORE, obj) }
  catch { /* in-memory only */ }
}

export interface PublishResult {
  ok: boolean
  /** Present when ok — what the gate masked, for the consent UX ("we masked 3 items before publishing"). */
  findings?: GateFindings
  /** Present when !ok — why publication was refused (gate failed, or ephemeral chat). */
  error?: string
}

/**
 * Open a chat into the commons. Runs the mandatory PII gate FIRST and refuses to index if it can't run — fail
 * closed. Ephemeral (security-lane) chats can NEVER be opened: that combination is a contradiction (an ephemeral
 * chat is obliterated and writes no memory), so it's rejected defensively here even if the UI already blocks it.
 * Idempotent: re-publishing an already-open chat re-runs the gate and refreshes the snapshot.
 */
export function publishOpenChat(sessionId: string, title: string, messages: OpenChatMessage[], opts?: { ephemeral?: boolean }): PublishResult {
  if (!sessionId) return { ok: false, error: 'sessionId required' }
  if (opts?.ephemeral) return { ok: false, error: 'ephemeral (security-lane) chats cannot be opened' }
  const gate = gateOpenChat(messages)
  if (!gate.ok) return { ok: false, error: gate.error ?? 'PII gate failed — not indexed' }
  const led = load()
  const cleanTitle = String(title || 'Untitled chat').slice(0, 200)
  led.set(sessionId, {
    sessionId,
    title: cleanTitle,
    redacted: gate.redacted,
    publishedAt: new Date().toISOString(),
    findings: gate.findings,
  })
  persist()
  // Forward the LOCALLY-REDACTED snapshot to the shared commons (if federation is configured). Best-effort — a
  // down aggregator never breaks opening a chat; the local commons is already updated above.
  forwardPublish(sessionId, cleanTitle, gate.redacted)
  return { ok: true, findings: gate.findings }
}

/** Revoke instantly — the entry is gone the moment a chat goes private. No cached window for other agents. */
export function revokeOpenChat(sessionId: string): { ok: boolean; removed: boolean } {
  const led = load()
  const removed = led.delete(sessionId)
  if (removed) persist()
  // Propagate the revoke to the shared commons too, so no other agent can reach it. Best-effort.
  forwardRevoke(sessionId)
  return { ok: true, removed }
}

export function isOpen(sessionId: string): boolean { return load().has(sessionId) }
export function listOpenChats(): OpenChatEntry[] {
  return [...load().values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/**
 * Lexical search over the redacted commons. Deliberately simple (term-overlap scoring on masked text + title) —
 * the corpus is already safe (redacted at write), so search just ranks it. Returns redacted snippets only.
 */
export function searchOpenChats(query: string, limit = 6): OpenChatHit[] {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length >= 2)
  if (!terms.length) return []
  const hits: OpenChatHit[] = []
  for (const e of load().values()) {
    const hay = `${e.title}\n${e.redacted}`.toLowerCase()
    let score = 0
    for (const t of terms) { const n = hay.split(t).length - 1; score += n }
    if (score <= 0) continue
    hits.push({ sessionId: e.sessionId, title: e.title, snippet: snippetAround(e.redacted, terms), score, publishedAt: e.publishedAt })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** A short redacted excerpt centred on the first matching term (falls back to the head of the text). */
function snippetAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i }
  const start = at < 0 ? 0 : Math.max(0, at - 60)
  return (start > 0 ? '…' : '') + text.slice(start, start + 200).trim() + (text.length > start + 200 ? '…' : '')
}
