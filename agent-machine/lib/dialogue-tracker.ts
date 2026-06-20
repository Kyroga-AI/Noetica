/**
 * dialogue-tracker — the conversation tracker + flow analytics layer (the piece
 * a Rasa-style stack calls the "tracker store" + "conversation analytics"). Every
 * turn is recorded as a typed TurnRecord; flow metrics are derived from the log:
 * intent distribution, the intent transition matrix (the actual conversation
 * "flow"), fallback rate, grounding rate, latency-by-intent, and the common paths.
 *
 * This is what turns the intent system from a router into something measurable —
 * you can see which intents dominate, where conversations fall back, how often we
 * ground, and how fast each intent resolves. No model calls; pure bookkeeping.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── The typed dialogue contract ─────────────────────────────────────────────
/** One recorded turn — the atomic unit of conversation analytics. */
export interface TurnRecord {
  session_id: string
  turn: number              // 0-based index within the session
  ts: string                // ISO timestamp
  intent: string
  intent_score: number
  fallback: boolean         // low-confidence / default route (the NLU "fell back")
  slots_expected: string[]  // slots this intent wants filled
  slots_filled: string[]    // slots actually resolved from the turn
  fill_rate: number         // slots_filled / slots_expected
  clarified: boolean        // turn asked a form/fallback question instead of answering
  entities: string[]        // glossary entities recognized in the turn
  surface: string           // product surface routed to
  skill: string             // specialist agent dispatched
  tools: string[]           // tools scoped to the turn
  capability: string        // model capability bucket
  model: string             // concrete model that ran
  retrieval: string         // retrieval strategy
  grounded: boolean         // turn was grounded (doc/glossary/graph)
  latency_ms: number
  worth?: number            // value-judgment quality score (0..1), when available
  reward?: number           // latency-aware multi-objective reward (feeds the policy)
  escalated?: boolean       // turn was bumped to a more capable model (struggle/low-confidence)
}

/** Derived conversation analytics over a window of TurnRecords. */
export interface FlowMetrics {
  turns: number
  sessions: number
  intent_distribution: Record<string, number>
  transition_matrix: Record<string, Record<string, number>> // from-intent → to-intent → count
  fallback_rate: number
  grounding_rate: number
  clarify_rate: number      // fraction of turns that asked a form/fallback question
  escalation_rate: number   // fraction of turns bumped to a more capable model
  slot_fill_rate: number    // mean fill_rate across turns that expected slots
  entity_coverage: number   // fraction of turns where ≥1 entity was recognized
  avg_latency_ms_by_intent: Record<string, number>
  top_paths: { path: string; count: number }[] // most common 3-intent sequences
}

const DIR = join(homedir(), '.noetica', 'analytics')
const LOG = join(DIR, 'turns.jsonl')

// In-memory per-session last-intent, so we can record transitions without re-reading.
const lastIntentBySession = new Map<string, string>()
const turnCountBySession = new Map<string, number>()

/** Record a turn. Returns the saved record (also appended to the JSONL log). */
export function recordTurn(r: Omit<TurnRecord, 'turn' | 'ts'>): TurnRecord {
  const turn = turnCountBySession.get(r.session_id) ?? 0
  turnCountBySession.set(r.session_id, turn + 1)
  lastIntentBySession.set(r.session_id, r.intent)
  const rec: TurnRecord = { ...r, turn, ts: new Date().toISOString() }
  try {
    mkdirSync(DIR, { recursive: true })
    appendFileSync(LOG, JSON.stringify(rec) + '\n')
  } catch { /* analytics persistence is best-effort — never block a turn */ }
  return rec
}

/** How many of the session's most-recent turns failed to resolve, counted back from
 *  the latest. "Unresolved" = asked to clarify, low-confidence fallback, or a low
 *  reward. Drives escalation: grind on a cheap model too long → call a bigger one. */
export function sessionStruggle(sessionId: string): { consecutiveUnresolved: number; lastReward?: number } {
  const turns = readTurns().filter((t) => t.session_id === sessionId)
  let consecutive = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!
    const unresolved = t.clarified || t.fallback || (typeof t.reward === 'number' && t.reward < 0.4)
    if (unresolved) consecutive++
    else break
  }
  return { consecutiveUnresolved: consecutive, lastReward: turns.at(-1)?.reward }
}

/** Read the recorded turns (most-recent `limit`). */
export function readTurns(limit = 5000): TurnRecord[] {
  if (!existsSync(LOG)) return []
  try {
    const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => JSON.parse(l) as TurnRecord)
  } catch { return [] }
}

/** Compute flow metrics over the recorded turns (the conversation analytics). */
export function computeFlowMetrics(limit = 5000): FlowMetrics {
  const turns = readTurns(limit)
  const intent_distribution: Record<string, number> = {}
  const transition_matrix: Record<string, Record<string, number>> = {}
  const avg_latency_ms_by_intent: Record<string, number> = {}
  const latencySum: Record<string, number> = {}
  const latencyN: Record<string, number> = {}
  const sessions = new Set<string>()
  const bySession = new Map<string, string[]>() // session → ordered intents
  let fallbacks = 0
  let grounded = 0
  let withEntities = 0
  let clarifies = 0
  let escalations = 0
  let fillSum = 0
  let fillN = 0

  for (const t of turns) {
    sessions.add(t.session_id)
    intent_distribution[t.intent] = (intent_distribution[t.intent] ?? 0) + 1
    if (t.fallback) fallbacks++
    if (t.grounded) grounded++
    if (t.entities.length > 0) withEntities++
    if (t.clarified) clarifies++
    if (t.escalated) escalations++
    if (t.slots_expected.length > 0) { fillSum += t.fill_rate; fillN++ }
    latencySum[t.intent] = (latencySum[t.intent] ?? 0) + t.latency_ms
    latencyN[t.intent] = (latencyN[t.intent] ?? 0) + 1
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, [])
    bySession.get(t.session_id)!.push(t.intent)
  }

  // Transition matrix + common 3-intent paths from per-session ordered sequences.
  const pathCounts: Record<string, number> = {}
  for (const seq of bySession.values()) {
    for (let i = 1; i < seq.length; i++) {
      const from = seq[i - 1]!, to = seq[i]!
      transition_matrix[from] ??= {}
      transition_matrix[from][to] = (transition_matrix[from][to] ?? 0) + 1
    }
    for (let i = 2; i < seq.length; i++) {
      const path = `${seq[i - 2]} → ${seq[i - 1]} → ${seq[i]}`
      pathCounts[path] = (pathCounts[path] ?? 0) + 1
    }
  }

  for (const intent of Object.keys(latencySum)) {
    avg_latency_ms_by_intent[intent] = Math.round(latencySum[intent]! / latencyN[intent]!)
  }
  const top_paths = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([path, count]) => ({ path, count }))

  const n = turns.length || 1
  return {
    turns: turns.length,
    sessions: sessions.size,
    intent_distribution,
    transition_matrix,
    fallback_rate: Number((fallbacks / n).toFixed(3)),
    grounding_rate: Number((grounded / n).toFixed(3)),
    clarify_rate: Number((clarifies / n).toFixed(3)),
    escalation_rate: Number((escalations / n).toFixed(3)),
    slot_fill_rate: Number((fillN ? fillSum / fillN : 1).toFixed(3)),
    entity_coverage: Number((withEntities / n).toFixed(3)),
    avg_latency_ms_by_intent,
    top_paths,
  }
}
