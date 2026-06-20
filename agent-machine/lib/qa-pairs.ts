/**
 * qa-pairs — the question→answer training-data flywheel. Every high-reward turn is
 * harvested as a GOLD key→value pair (question → answer + metadata). These pairs are:
 *
 *  • the training set (export for distillation / fine-tuning),
 *  • the few-shot memory (inject the best exemplars for a matching intent — in-context
 *    "training" that sharpens the common cases without a model update),
 *  • the substrate for Pareto analysis: the ~20% of intents that cover ~80% of volume
 *    are the HEAD we invest in (gold exemplars + per-head regression); the rest is the
 *    long tail, served by the general path.
 *
 * Hierarchy: intent (tier 1) → the intent's exemplar pairs (tier 2). Gating on the
 * latency-aware reward means only genuinely good turns become training data.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Gold gate is on WORTH (answer quality), not the latency-aware reward — a great
// answer is training data even if a slow model produced it (slowness is a routing
// concern, not a data-quality one). Reward is still stored for per-head regression.
const GOLD_WORTH = 0.6

export interface QAPair {
  id: string
  question: string
  answer: string       // truncated to keep the store lean
  intent: string
  worth: number
  reward: number
  grounded: boolean
  model: string
  ts: string
}

const DIR = join(homedir(), '.noetica', 'training')
const LOG = join(DIR, 'qa-pairs.jsonl')

/** Harvest a turn as a gold Q/A pair iff its reward clears the bar. Returns whether
 *  it was kept. Dedupes by (intent + normalized question). */
export function recordQAPair(p: Omit<QAPair, 'id' | 'ts'>): boolean {
  if (p.worth < GOLD_WORTH || !p.question.trim() || !p.answer.trim()) return false
  const id = createHash('sha1').update(`${p.intent}|${p.question.toLowerCase().slice(0, 160)}`).digest('hex').slice(0, 12)
  const rec: QAPair = { ...p, answer: p.answer.slice(0, 2000), id, ts: new Date().toISOString() }
  try {
    mkdirSync(DIR, { recursive: true })
    appendFileSync(LOG, JSON.stringify(rec) + '\n')
  } catch { /* best-effort */ }
  return true
}

export function readQAPairs(limit = 5000): QAPair[] {
  if (!existsSync(LOG)) return []
  try {
    return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as QAPair)
  } catch { return [] }
}

/** Best (highest-reward) gold exemplars for an intent — the few-shot training memory
 *  injected for matching turns. Latest-wins dedupe by question. */
export function bestExemplars(intent: string, k = 2): QAPair[] {
  const byQ = new Map<string, QAPair>()
  for (const p of readQAPairs()) if (p.intent === intent) byQ.set(p.question.toLowerCase().slice(0, 160), p)
  return [...byQ.values()].sort((a, b) => b.reward - a.reward).slice(0, k)
}

export interface ParetoTier {
  intent: string
  count: number
  share: number          // fraction of all pairs
  cum_share: number      // cumulative fraction (sorted desc)
  mean_worth: number
  tier: 'head' | 'tail'  // head = within the cumulative-80% Pareto front
  exemplars: { question: string; reward: number }[]
}

export interface ParetoReport {
  total: number
  head_count: number
  head_share: number     // volume share covered by the head intents
  tiers: ParetoTier[]
}

/** Pareto + hierarchy over the gold pairs: which intents are the head (cumulative
 *  ≤80% of volume) vs the long tail, with each intent's top exemplars. */
export function paretoReport(): ParetoReport {
  const pairs = readQAPairs()
  const total = pairs.length
  const byIntent = new Map<string, QAPair[]>()
  for (const p of pairs) { if (!byIntent.has(p.intent)) byIntent.set(p.intent, []); byIntent.get(p.intent)!.push(p) }

  const sorted = [...byIntent.entries()].sort((a, b) => b[1].length - a[1].length)
  const tiers: ParetoTier[] = []
  let cum = 0
  let headCount = 0
  for (const [intent, group] of sorted) {
    const share = total ? group.length / total : 0
    const prevCum = cum
    cum += share
    // Head = intents accumulating up to the 80% Pareto front (include the one that
    // crosses 80% so the head genuinely covers ≥80%).
    const tier: 'head' | 'tail' = prevCum < 0.8 ? 'head' : 'tail'
    if (tier === 'head') headCount += group.length
    tiers.push({
      intent, count: group.length,
      share: Number(share.toFixed(3)), cum_share: Number(cum.toFixed(3)),
      mean_worth: Number((group.reduce((s, p) => s + p.worth, 0) / group.length).toFixed(3)),
      tier,
      exemplars: [...group].sort((a, b) => b.reward - a.reward).slice(0, 3).map((p) => ({ question: p.question.slice(0, 120), reward: p.reward })),
    })
  }
  return { total, head_count: headCount, head_share: Number((total ? headCount / total : 0).toFixed(3)), tiers }
}
