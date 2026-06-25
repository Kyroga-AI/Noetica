/**
 * grantCheck.ts — A2A zero-trust tool grant ledger.
 *
 * Every MCP tool invocation emits a ToolGrantCheck record to HellGraph via
 * agent-machine. This builds the governance audit trail required by the
 * mcp-a2a-zero-trust schema: each tool execution is traceable to a SPIFFE
 * actor, a grant binding, and a policy hash.
 *
 * The grant is implicitly valid for any tool dispatched through the enabled
 * MCP server list. Future iterations can extend this with revocation checks,
 * capability constraints, and server attestation.
 *
 * Schema: /Users/michaelheller/dev/mcp-a2a-zero-trust/schemas/interop/tool_grant_check.schema.json
 * Grant:  /Users/michaelheller/dev/mcp-a2a-zero-trust/schemas/canonical/grant.schema.json
 *
 * Behavioral trust (./trust.ts) layers on top: a grant's STRENGTH reflects the SPIFFE actor's track record, so
 * federated peers (Ruflo/gastown/AIWG nodes) and compromised sessions are gated by reputation, not just an
 * explicit revoke. Egress remains scope-d's job — composed as a SEPARATE gate, never merged in here.
 */
import { trustVerdict, recordOutcome, type TrustOutcome } from './trust.js'

export interface ToolGrantCheck {
  check_id: string
  operation: 'tool_grant.validate' | 'tool_grant.revoke'
  grant_id: string
  checked_at: string
  actor: { spiffe_id: string; aum_digest?: string }
  result: { valid: boolean; expired?: boolean; revoked?: boolean; reason?: string }
  policy_hash: string
}

function _deterministicHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ── Grant ledger: real revocation enforcement (was hardcoded valid:true) ─────────
const REVOKED_KEY = 'noetica:a2a:revoked-grants'
const memRevoked = new Set<string>()   // node/agent-machine fallback (env-agnostic, like the trust ledger)
function revokedSet(): Set<string> {
  if (typeof window === 'undefined') return memRevoked
  try { return new Set(JSON.parse(window.localStorage.getItem(REVOKED_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
/** Revoke a grant by id OR by `serverId:toolName`/SPIFFE id (blocks for all sessions). Persisted in-browser. */
export function revokeGrant(idOrServerTool: string): void {
  if (typeof window === 'undefined') { memRevoked.add(idOrServerTool); return }
  const s = revokedSet(); s.add(idOrServerTool)
  try { window.localStorage.setItem(REVOKED_KEY, JSON.stringify([...s])) } catch { /* */ }
}
export function unrevokeGrant(idOrServerTool: string): void {
  if (typeof window === 'undefined') { memRevoked.delete(idOrServerTool); return }
  const s = revokedSet(); s.delete(idOrServerTool)
  try { window.localStorage.setItem(REVOKED_KEY, JSON.stringify([...s])) } catch { /* */ }
}

export interface GrantVerdict { valid: boolean; revoked?: boolean; reason?: string; trust?: number }
/** Synchronously decide whether an MCP tool call is permitted — revocation ledger AND behavioral trust. The
 * caller (mcp callTool) MUST gate on this before dispatch. A fresh local session starts trusted; a session that
 * has tripped threat/integrity strikes (e.g. prompt injection) falls below the floor and is denied even without
 * an explicit revoke. Default-allow for a not-revoked, trusted grant. */
export function checkToolGrant(serverId: string, toolName: string, sessionId: string): GrantVerdict {
  const grantId = `urn:noetica:grant:mcp:${serverId}:${toolName}:session:${sessionId}`
  const revoked = revokedSet()
  if (revoked.has(grantId) || revoked.has(`${serverId}:${toolName}`) || revoked.has(serverId)) {
    return { valid: false, revoked: true, reason: 'grant revoked' }
  }
  const t = trustVerdict(`spiffe://noetica.local/session/${sessionId}`)
  if (!t.trusted) return { valid: false, reason: t.reason, trust: t.score }
  return { valid: true, trust: t.score }
}

/** Grant gate for a FEDERATED peer — a Ruflo swarm, gastown / AIWG node, or any cross-machine SPIFFE actor —
 * requesting a capability. Composes revocation + behavioral trust (sensitive capabilities can demand a higher
 * `floor`). EGRESS is a SEPARATE, later gate (scope-d), kept out of here on purpose. */
export function checkActorGrant(spiffeId: string, capability: string, floor?: number): GrantVerdict {
  const revoked = revokedSet()
  if (revoked.has(spiffeId) || revoked.has(`${spiffeId}:${capability}`)) {
    return { valid: false, revoked: true, reason: 'actor/grant revoked' }
  }
  const t = trustVerdict(spiffeId, floor)
  if (!t.trusted) return { valid: false, reason: t.reason, trust: t.score }
  return { valid: true, trust: t.score }
}

/** Feed a behavioral outcome back into an actor's trust (call after a delegated action completes / fails / is
 * flagged). Slow up, instant down. Re-exported so callers gate + record through one module. */
export function recordActorOutcome(spiffeId: string, outcome: TrustOutcome): void {
  recordOutcome(spiffeId, outcome)
}

/**
 * Emit a ToolGrantCheck record to HellGraph (fire-and-forget).
 * Never throws — governance recording must not block tool execution.
 */
export function emitToolGrantCheck(
  serverId: string,
  toolName: string,
  sessionId: string,
  amBaseUrl: string,
): void {
  const checkId = `urn:noetica:grant-check:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const grantId = `urn:noetica:grant:mcp:${serverId}:${toolName}:session:${sessionId}`
  const spiffeId = `spiffe://noetica.local/session/${sessionId}`
  const policyHash = `sha256:${_deterministicHash(`${serverId}:${toolName}:${sessionId}`)}`
  const verdict = checkToolGrant(serverId, toolName, sessionId)   // real validity, not hardcoded true

  const check: ToolGrantCheck = {
    check_id: checkId,
    operation: 'tool_grant.validate',
    grant_id: grantId,
    checked_at: new Date().toISOString(),
    actor: { spiffe_id: spiffeId },
    result: verdict,
    policy_hash: policyHash,
  }

  fetch(`${amBaseUrl}/api/graph/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'tool_grant_check', payload: check }),
  }).catch(() => {})
}
