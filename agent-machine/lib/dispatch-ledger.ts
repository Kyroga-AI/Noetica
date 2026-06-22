/**
 * dispatch-ledger — §10.3 Evidence. The deterministic spine: every dispatch is a
 * content-addressed, hash-chained entry that REPLAYS. Truth = Law × Evidence — a
 * dispatch is lawful (POS@T1) iff its ledger entry recomputes to its recorded hash
 * and links to its predecessor. Tamper anywhere upstream diverges every downstream
 * attestation. Local-first: appends to ~/.noetica/ledger/dispatch.jsonl, no network.
 *
 * Records the Law side (the action/cell + the gate decision: did the fidelity bar
 * clear, with what residual) and the Evidence side (request + answer content hashes,
 * model, outcome), so the whole decision replays even though the generated text does
 * not — determinism of the DECISION, integrity of the record (§1.8, carried).
 */
import { ledgerHash } from './verb-sort.js'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { readJsonl } from './jsonl.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.noetica', 'ledger')
const LOG = join(DIR, 'dispatch.jsonl')
const GENESIS = 'genesis'

export interface DispatchInput {
  session: string
  requestHash: string                       // SEAM-C hash of (user content + context snapshot)
  action: string; polarity: string          // the tangent vector
  tier: string; target: string; phase: string | null // route + MeshRush phase
  barCleared: boolean; residual: string[]   // the gate decision (Law)
  model: string; answerHash: string; latencyMs: number; grounded: boolean // outcome (Evidence)
  verdict: 'POS' | 'ZERO' | 'NEG'
}
export interface DispatchEntry extends DispatchInput {
  seq: number; ts: string; prev: string; attestation: string; evidenceTier: 'T1'
}

// In-memory chain head, rehydrated from disk so the chain continues across restarts.
let head = { seq: 0, hash: GENESIS, loaded: false }
function rehydrate(): void {
  if (head.loaded) return
  head.loaded = true
  try {
    if (!existsSync(LOG)) return
    const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    if (lines.length === 0) return
    const last = JSON.parse(lines[lines.length - 1]!) as DispatchEntry
    head = { seq: last.seq + 1, hash: last.attestation, loaded: true }
  } catch { /* start fresh on a corrupt tail */ }
}

/** The hashed body = everything that defines the decision, plus the prev link. The
 *  attestation is its SEAM-C hash. (Excludes seq/ts/attestation themselves.) */
function bodyOf(e: Omit<DispatchEntry, 'attestation' | 'evidenceTier'>): unknown {
  const { attestation: _a, evidenceTier: _t, ...body } = e as DispatchEntry
  return body
}

/** Record a dispatch, chained to the predecessor. Returns the attested entry. */
export function recordDispatch(input: DispatchInput): DispatchEntry {
  rehydrate()
  const base = { ...input, seq: head.seq, ts: new Date().toISOString(), prev: head.hash }
  const attestation = ledgerHash(bodyOf(base as unknown as DispatchEntry))
  const entry: DispatchEntry = { ...base, attestation, evidenceTier: 'T1' }
  try {
    mkdirSync(DIR, { recursive: true })
    appendFileSync(LOG, JSON.stringify(entry) + '\n')
  } catch { /* best-effort persistence */ }
  head = { seq: head.seq + 1, hash: attestation, loaded: true }
  return entry
}

export interface ReplayResult { ok: boolean; count: number; brokenAt?: number; reason?: string }

/** Replay the chain: recompute each attestation from its body + prev, and verify the
 *  prev-link. ok ⇒ the whole ledger is POS@T1 (deterministic + tamper-evident). */
export function replayLedger(): ReplayResult {
  if (!existsSync(LOG)) return { ok: true, count: 0 }
  let prev = GENESIS, count = 0
  try {
    const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    for (const line of lines) {
      const e = JSON.parse(line) as DispatchEntry
      if (e.prev !== prev) return { ok: false, count, brokenAt: e.seq, reason: 'prev-link mismatch' }
      const recomputed = ledgerHash(bodyOf(e))
      if (recomputed !== e.attestation) return { ok: false, count, brokenAt: e.seq, reason: 'attestation mismatch (tampered)' }
      prev = e.attestation
      count++
    }
    return { ok: true, count }
  } catch (err) {
    return { ok: false, count, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** SEAM-C convenience: content hash of a string (request/answer bodies). */
export function contentHash(s: string): string { return ledgerHash(s) }

/** Read recorded dispatch entries (most-recent `limit`) — e.g. for energy accounting. */
export function readDispatches(limit = 10_000): DispatchEntry[] {
  return readJsonl<DispatchEntry>(LOG, { limit })
}
