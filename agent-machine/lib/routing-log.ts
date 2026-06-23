/**
 * routing-log — an OPT-IN local record of how each turn was routed, for reviewing misroutes.
 *
 * The new routing layers (everyday lane, life-domain tag, effort gate) make per-turn decisions; the
 * fastest way to find the remaining cue gaps is to look at real turns. This appends {intent, domain,
 * effort, short query} to ~/.noetica/routing-decisions.jsonl — but ONLY when NOETICA_ROUTING_LOG=1, so
 * queries are never recorded by default (privacy). The file is per-user, local, and never shipped.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readJsonl } from './jsonl.js'

const LOG_PATH = path.join(os.homedir(), '.noetica', 'routing-decisions.jsonl')

export interface RoutingDecision { ts: string; query: string; intent: string; domain: string; effort: string }

/** Append one routing decision — no-op unless NOETICA_ROUTING_LOG=1. The query is truncated to a preview. */
export function logRouting(d: Omit<RoutingDecision, 'ts'>): void {
  if (process.env['NOETICA_ROUTING_LOG'] !== '1') return // opt-in: don't record queries by default
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    const rec: RoutingDecision = { ts: new Date().toISOString(), intent: d.intent, domain: d.domain, effort: d.effort, query: d.query.replace(/\s+/g, ' ').trim().slice(0, 120) }
    fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n')
  } catch { /* best-effort telemetry */ }
}

/** The most recent routing decisions (newest-last), for review. */
export function readRoutingLog(limit = 200): RoutingDecision[] {
  return readJsonl<RoutingDecision>(LOG_PATH, { limit })
}
