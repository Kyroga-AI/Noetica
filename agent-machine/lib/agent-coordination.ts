/**
 * agent-coordination — the multi-agent "rules of engagement" as enforceable graph atoms.
 *
 * Two (or more) agents sharing one repo/working-tree collide: edit the same file, commit
 * each other's half-done work. I just ran that protocol by hand (sync, claim-by-convention,
 * work in new files, release). This makes it a graph-native, automatic protocol over the
 * SAME atomspace the session/repo-awareness graph uses:
 *
 *   Agent ─CLAIMS→ Claim ─ON→ File
 *
 * Rules of engagement:
 *   1. Before editing a file, claim it. Denied if another LIVE agent holds it.
 *   2. Claims have a TTL + heartbeat — a crashed agent's claims expire (no permanent locks).
 *   3. Release on done. activeClaims() is the shared "who's touching what" view, from atoms.
 *
 * Pure over a minimal store (the real HellGraph store satisfies it; a fake in tests).
 */

export interface CoordNode { id: string; labels: string[]; properties: Record<string, unknown> }
export interface CoordStore {
  getNode(id: string): CoordNode | null
  addNode(id: string, labels: string[], properties: Record<string, unknown>): CoordNode
  addEdge(label: string, fromId: string, toId: string, properties?: Record<string, unknown>): unknown
  out(id: string, edgeLabel?: string): CoordNode[]
  nodesByLabel(label: string): CoordNode[]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140)
const AGENT = (id: string) => `urn:noetica:agent:${slug(id)}`
const FILE = (absPath: string) => `urn:noetica:file:${slug(absPath)}`        // shared with session-graph
const CLAIM = (agentId: string, absPath: string) => `urn:noetica:claim:${slug(agentId)}:${slug(absPath)}`

const DEFAULT_TTL_MS = 10 * 60_000   // 10 min — long enough for an edit, short enough to self-heal

export interface ClaimRecord { agentId: string; path: string; op: string; claimedAt: string; ttlMs: number }
export interface Conflict { path: string; heldBy: string; op: string; claimedAt: string }
export interface ClaimResult { granted: string[]; conflicts: Conflict[] }

function isLive(claim: CoordNode, nowMs: number): boolean {
  if (claim.properties['released'] === true) return false
  const at = Date.parse(String(claim.properties['claimed_at'] ?? ''))
  const ttl = Number(claim.properties['ttl_ms'] ?? DEFAULT_TTL_MS) || DEFAULT_TTL_MS
  return isFinite(at) && at + ttl > nowMs
}

/** Live claims held on a path by agents OTHER than self. */
export function conflictsFor(store: CoordStore, absPath: string, selfAgentId: string, nowMs: number): Conflict[] {
  const fileId = FILE(absPath)
  if (!store.getNode(fileId)) return []
  return store.out(fileId, 'CLAIMED_BY')
    .filter((c) => c.labels.includes('Claim') && String(c.properties['agent_id']) !== selfAgentId && isLive(c, nowMs))
    .map((c) => ({ path: absPath, heldBy: String(c.properties['agent_id']), op: String(c.properties['op'] ?? 'edit'), claimedAt: String(c.properties['claimed_at'] ?? '') }))
}

export function ensureAgent(store: CoordStore, agentId: string, sessionId: string, now = new Date().toISOString()): string {
  const id = AGENT(agentId)
  const n = store.getNode(id)
  if (!n) store.addNode(id, ['Agent'], { agent_id: agentId, session_id: sessionId, started_at: now, heartbeat: now })
  else n.properties['heartbeat'] = now
  return id
}

/**
 * Try to claim files for editing. A path is granted unless another LIVE agent holds it;
 * conflicts are returned so the caller can route around them (work elsewhere / wait).
 * Idempotent: re-claiming your own path just refreshes the TTL (a heartbeat).
 */
export function claimFiles(
  store: CoordStore,
  opts: { agentId: string; sessionId: string; paths: string[]; op?: string; ttlMs?: number },
  now = new Date().toISOString(),
): ClaimResult {
  const nowMs = Date.parse(now)
  const op = opts.op ?? 'edit'
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const agentNode = ensureAgent(store, opts.agentId, opts.sessionId, now)
  const granted: string[] = []
  const conflicts: Conflict[] = []

  for (const p of opts.paths) {
    const conf = conflictsFor(store, p, opts.agentId, nowMs)
    if (conf.length > 0) { conflicts.push(...conf); continue }
    const fileId = FILE(p)
    if (!store.getNode(fileId)) store.addNode(fileId, ['File'], { path: p, touched_at: now })
    const claimId = CLAIM(opts.agentId, p)
    const existing = store.getNode(claimId)
    if (existing) {
      existing.properties['claimed_at'] = now
      existing.properties['ttl_ms'] = ttlMs
      existing.properties['op'] = op
      existing.properties['released'] = false
    } else {
      store.addNode(claimId, ['Claim'], { agent_id: opts.agentId, path: p, op, claimed_at: now, ttl_ms: ttlMs, released: false })
      store.addEdge('CLAIMS', agentNode, claimId, { at: now })
      store.addEdge('CLAIMED_BY', fileId, claimId, { at: now })
    }
    granted.push(p)
  }
  return { granted, conflicts }
}

/** Release some or all of an agent's claims (idempotent). Returns count released. */
export function releaseClaims(store: CoordStore, agentId: string, paths?: string[], now = new Date().toISOString()): number {
  const agentNode = store.getNode(AGENT(agentId))
  if (!agentNode) return 0
  let n = 0
  for (const claim of store.out(agentNode.id, 'CLAIMS')) {
    if (!claim.labels.includes('Claim')) continue
    if (paths && !paths.includes(String(claim.properties['path']))) continue
    if (claim.properties['released'] !== true) { claim.properties['released'] = true; claim.properties['released_at'] = now; n++ }
  }
  return n
}

/** The shared "who's touching what" view — every live claim across all agents. */
export function activeClaims(store: CoordStore, now = new Date().toISOString()): ClaimRecord[] {
  const nowMs = Date.parse(now)
  return store.nodesByLabel('Claim')
    .filter((c) => isLive(c, nowMs))
    .map((c) => ({ agentId: String(c.properties['agent_id']), path: String(c.properties['path']), op: String(c.properties['op'] ?? 'edit'), claimedAt: String(c.properties['claimed_at'] ?? ''), ttlMs: Number(c.properties['ttl_ms'] ?? DEFAULT_TTL_MS) || DEFAULT_TTL_MS }))
}

/** Render the rules-of-engagement state for an agent's prompt: what's locked by others. */
export function coordinationBrief(store: CoordStore, selfAgentId: string, now = new Date().toISOString()): string {
  const others = activeClaims(store, now).filter((c) => c.agentId !== selfAgentId)
  if (others.length === 0) return ''
  const lines = others.map((c) => `  • ${c.path} — claimed by ${c.agentId} (${c.op})`)
  return `\n\n---\n**Other agents are working on these files — do NOT edit them; work in new files or wait:**\n${lines.join('\n')}`
}
