/**
 * memory-provenance.ts — memory-poisoning defense for the self-writing 'remember' tool (OWASP ASI06).
 * Persistent poisoning (AgentPoison: 63% ASR at <0.1% poison) survives across sessions, and salience-driven
 * compaction poisoning (85% ASR) abuses repetition as importance. Defenses: trust-tier every write, refuse to
 * let untrusted external content drive a write, and cap how much mere repetition can inflate importance.
 */
import { detectInjection } from './rag-trust.js'

export type WriteTrust = 'self' | 'user' | 'retrieved' | 'external'

export function classifyWriteTrust(src: { author?: string; fromRetrieval?: boolean; origin?: string }): WriteTrust {
  if (src.author === 'user') return 'user'
  if (src.fromRetrieval || src.origin === 'web' || src.origin === 'external') return src.origin === 'external' || src.origin === 'web' ? 'external' : 'retrieved'
  return 'self'
}

export interface WriteDecision { admit: boolean; quarantine: boolean; reason: string }

/** Gate a proposed memory write. Untrusted content carrying injected instructions is quarantined, not stored. */
export function admitWrite(mem: { content: string; trust: WriteTrust }): WriteDecision {
  const injected = detectInjection(mem.content).suspicious
  if (injected && (mem.trust === 'external' || mem.trust === 'retrieved')) {
    return { admit: false, quarantine: true, reason: 'injected-instruction-in-untrusted-source' }
  }
  if (mem.trust === 'external') return { admit: true, quarantine: true, reason: 'external-source-quarantined-pending-review' }
  return { admit: true, quarantine: false, reason: 'ok' }
}

/**
 * Importance that resists compaction poisoning: repetition contributes only logarithmically and is capped,
 * so an attacker repeating a payload cannot inflate it to canonical importance.
 */
export function compactionImportance(base: number, repetitionCount: number, opts: { repWeight?: number; repCap?: number } = {}): number {
  const repWeight = opts.repWeight ?? 0.1
  const repCap = opts.repCap ?? 0.3
  const repBoost = Math.min(repCap, repWeight * Math.log2(1 + Math.max(0, repetitionCount)))
  return Math.min(1, Math.max(0, base) + repBoost)
}
