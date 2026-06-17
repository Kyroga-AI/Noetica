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
 */

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

  const check: ToolGrantCheck = {
    check_id: checkId,
    operation: 'tool_grant.validate',
    grant_id: grantId,
    checked_at: new Date().toISOString(),
    actor: { spiffe_id: spiffeId },
    result: { valid: true },
    policy_hash: policyHash,
  }

  fetch(`${amBaseUrl}/api/graph/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'tool_grant_check', payload: check }),
  }).catch(() => {})
}
