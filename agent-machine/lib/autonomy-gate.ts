/**
 * autonomy-gate — runtime enforcement of the AI-driven-development autonomy ladder in the agent
 * loop. This is the live counterpart to lib/governance/autonomyLadder.ts (the canonical engine,
 * itself a mirror of prophet-mesh specs/ai-driven-development.yaml): a session is bound to a role
 * and an authorized autonomy level + evidence, and every tool-call the loop dispatches is gated
 * against the level that action requires.
 *
 * Composes with agent-containment (purpose-binding + kill-switch): containment gates WHAT
 * capability an action uses; this gates WHETHER the role is admitted to act at the autonomy level
 * the action implies. Both are fail-closed. Unbound = not enforced (backward compatible), exactly
 * like containment defaults to the 'full' purpose.
 *
 * The ladder is imported from the repo-root single source — no second copy to drift.
 */

import { createHash } from 'node:crypto'
import {
  evaluateAutonomy,
  AUTONOMY_LADDER,
  toAdmissionReceipt,
  type AutonomyDecision,
} from '../../lib/governance/autonomyLadder.js'
import { canonical } from './audit-chain.js'

/** Re-export the canonical ladder so the host has a single autonomy import surface. */
export { AUTONOMY_LADDER }

export interface AutonomySession {
  /** choir role requesting autonomy (e.g. 'conductor', 'coding', 'research') */
  role: string
  /** the highest autonomy level the operator authorized this session to operate at */
  authorizedLevel: string
  /** evidence tokens currently available (e.g. 'conductor_response_envelope', 'evidence_dossier') */
  evidence: string[]
}

let _session: AutonomySession | null = null
let _sink: ((decision: AutonomyDecision & { tool: string }) => void) | null = null

/** Bind the active session's autonomy (null = clear → not enforced). */
export function bindAutonomy(session: AutonomySession | null): void {
  _session = session
}
export function autonomySession(): AutonomySession | null {
  return _session
}
/** Hydrate from persistence at boot (parity with containment). */
export function hydrateAutonomy(session: AutonomySession | null): void {
  _session = session
}
/** Register a sink that receives every gated decision (route to the evidence spine / trajectory). */
export function onAutonomyDecision(sink: ((d: AutonomyDecision & { tool: string }) => void) | null): void {
  _sink = sink
}

function rank(level: string): number {
  const n = Number.parseInt(String(level).replace(/^[Ll]/, ''), 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

/**
 * Decide whether the bound session may take an action that REQUIRES `requiredLevel`.
 * Returns null when no session is bound (autonomy not enforced — backward compatible).
 */
export function decideAutonomy(requiredLevel: string): AutonomyDecision | null {
  if (!_session) return null
  return evaluateAutonomy(_session.role, requiredLevel, _session.evidence)
}

/**
 * An action requiring `requiredLevel` is permitted iff the bound session is admitted AT that level
 * (the decision did not demote below it). Unbound = permitted.
 */
export function permitsAutonomy(requiredLevel: string): boolean {
  const d = decideAutonomy(requiredLevel)
  if (!d) return true
  return rank(d.grantedLevel) >= rank(requiredLevel)
}

/** Throwing guard, parallel to containment.assertCapability. No-op when unbound. */
export function assertAutonomy(requiredLevel: string): void {
  const d = decideAutonomy(requiredLevel)
  if (d && rank(d.grantedLevel) < rank(requiredLevel)) {
    throw new Error(`AUTONOMY BLOCKED: requires ${requiredLevel}, granted ${d.grantedLevel} — ${d.reason}`)
  }
}

/** Map a tool name to the autonomy level it requires (host-supplied policy). */
export type ToolAutonomyPolicy = (toolName: string) => string | undefined

/**
 * Build a `LoopCtx.autonomyGate` from a tool→level policy. For each tool-call the loop is about to
 * dispatch, this computes the autonomy decision, routes it to the decision sink (evidence), and
 * returns a fail-closed verdict. Tools with no required level (or an unbound session) pass through.
 */
export function makeAutonomyGate(
  policy: ToolAutonomyPolicy,
): (call: { name: string; id?: string; input?: Record<string, unknown> }) => { allowed: boolean; reason: string } {
  return (call) => {
    const required = policy(call.name)
    if (!required) return { allowed: true, reason: 'no autonomy level required' }
    const d = decideAutonomy(required)
    if (!d) return { allowed: true, reason: 'autonomy not bound' }
    _sink?.({ ...d, tool: call.name })
    const allowed = rank(d.grantedLevel) >= rank(required)
    return {
      allowed,
      reason: allowed
        ? `admitted at ${required} (${d.reason})`
        : `requires ${required}, granted ${d.grantedLevel} — ${d.reason}`,
    }
  }
}

export type AdmissionReceipt = ReturnType<typeof toAdmissionReceipt>

/**
 * Build a content-hashed AutonomyAdmissionReceipt (prophet-platform contract
 * AutonomyAdmissionReceipt.v0.1) from a runtime decision, ready to ride the
 * evidence spine. The hash is sha256 over the canonical (key-sorted) receipt
 * minus the hash field, so it is deterministic and tamper-evident.
 */
export function buildAdmissionReceipt(
  d: AutonomyDecision,
  ids: { receipt_id: string; created_at: string; subject_ref: string; evidence_refs?: string[] },
): AdmissionReceipt {
  const draft = toAdmissionReceipt(d, { ...ids, hash: '' })
  const { hash: _unused, ...body } = draft
  return { ...body, hash: 'sha256:' + createHash('sha256').update(canonical(body)).digest('hex') }
}
