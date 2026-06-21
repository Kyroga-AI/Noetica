/**
 * episodic — cross-session episodic recall. The mesh records every turn as an Interaction atom
 * (promptSummary = the question, responseSummary = the answer, timestamp), but nothing ever
 * surfaced them — the episodic layer was write-only. This recalls prior exchanges relevant to
 * the current question and injects them, so the agent remembers what you discussed *in earlier
 * sessions* ("last time you asked about X, the answer was Y"), not just the current thread.
 *
 * Pure over a minimal store; ranks by Jaccard over the prior question.
 */

import { tokensOf, jaccard } from './graph-search.js'

export interface ExchangeNode { id: string; labels: string[]; properties: Record<string, unknown> }
export interface ExchangeStore { nodesByLabel(label: string): ExchangeNode[] }
export interface PriorExchange { question: string; answer: string; ts: string; score: number }

const META_ANSWER = /^(patterns:|sources:|\s*$)/   // routing summaries, not a real answer

/** Recall prior Interaction atoms whose question is relevant to `query`, most-relevant first. */
export function recallExchanges(
  store: ExchangeStore,
  query: string,
  opts: { limit?: number; excludeRunId?: string; minScore?: number } = {},
): PriorExchange[] {
  const qt = tokensOf(query)
  if (qt.size < 2) return []                        // too thin to match meaningfully
  const minScore = opts.minScore ?? 0.18
  const out: PriorExchange[] = []
  for (const n of store.nodesByLabel('Interaction')) {
    if (n.properties['hygiene_pruned'] === true) continue
    const question = String(n.properties['promptSummary'] ?? '').trim()
    const answer = String(n.properties['responseSummary'] ?? '').trim()
    if (!question || !answer || META_ANSWER.test(answer)) continue
    if (opts.excludeRunId && String(n.properties['runId'] ?? '') === opts.excludeRunId) continue
    const score = jaccard(qt, tokensOf(question))
    if (score >= minScore) out.push({ question, answer, ts: String(n.properties['timestamp'] ?? ''), score })
  }
  return out.sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts)).slice(0, opts.limit ?? 3)
}

/** Render recalled exchanges as a context block (empty string when there are none). */
export function formatExchanges(exchanges: PriorExchange[]): string {
  if (exchanges.length === 0) return ''
  return '\n\n---\n**Prior related exchanges (recalled from earlier sessions — reuse if still valid)**\n' +
    exchanges.map((e) => `- Earlier asked: "${e.question.slice(0, 140)}" → answered: "${e.answer.slice(0, 200)}"`).join('\n')
}
