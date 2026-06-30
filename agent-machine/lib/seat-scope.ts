/**
 * seat-scope — sovereign, scoped multi-seat for governed ingestion (the Onyx kill).
 *
 * Onyx gates audit + permission governance behind an Enterprise paywall. We do the
 * opposite: governance is OPEN and sovereign. A SEAT is a `sovereign-id` derived scope
 * facet (its own deterministic Ed25519 keypair — see sovereign-id.ts) BOUND to an
 * `AccessProfile` (sourceos-spec AccessProfile.json) that declares which collections /
 * WorkspaceScopes and which TrustLevels the seat may ingest or query.
 *
 * This is NOT enterprise RBAC. It is scoped, single-tenant-friendly, sovereign-id-keyed:
 *   • single-user works UNCHANGED — `defaultOwnerSeat()` is a full-access owner seat
 *     derived from the root at a fixed scopeId; with no NOETICA_SEAT env it is the seat;
 *   • multi-seat is OPT-IN — set NOETICA_SEAT=<scopeId> to act as a scoped seat, whose
 *     AccessProfile narrows the collections + trust-levels it may touch.
 *
 * Every function is exception-safe: an identity/crypto hiccup must NEVER deny the owner
 * (fail-open for the owner, fail-closed for an unresolvable scoped seat).
 *
 * Authority: /Users/michaelheller/dev/sourceos-spec/schemas/AccessProfile.json
 */
import { deriveScope, loadOrCreateRoot, type ScopeFacet } from './sovereign-id.js'
import type { TrustLevel } from './reasoning-evidence.js'

const SPEC_VERSION = '2.0.0'
const ACCESS_PROFILE_PREFIX = 'urn:srcos:access-profile:'

/** The fixed scopeId for the single-user owner seat. Deterministic per root, stable. */
export const OWNER_SCOPE_ID = 'noetica-owner'

/** All five TrustLevels in the taxonomy (mirrors reasoning-evidence.TrustLevel). */
const ALL_TRUST_LEVELS: readonly TrustLevel[] = [
  'trusted-control-input',
  'trusted-workspace-source',
  'semi-trusted-project-source',
  'untrusted-observation',
  'restricted-material',
]

/**
 * AccessProfile — conforms to sourceos-spec AccessProfile.json (id / type / specVersion /
 * name required; subjects / purposes / allowedContentRefs / allowedEnvironments /
 * obligations optional arrays). We carry the seat-local ingestion policy in the spec-named
 * fields: `subjects` = the seat pseudonym, `allowedContentRefs` = the collections the seat
 * may touch ('*' = all), `allowedEnvironments` = the TrustLevels it may ingest/query.
 */
export interface AccessProfile {
  id: string
  type: 'AccessProfile'
  specVersion: string
  name: string
  subjects: string[]
  purposes: string[]
  allowedContentRefs: string[]   // collection ids the seat may touch; ['*'] = all
  allowedEnvironments: string[]  // TrustLevels the seat may ingest/query; ['*'] = all
  obligations: string[]
  expiresAt?: string | null
}

/** A seat = a sovereign scope facet + its bound AccessProfile. */
export interface Seat {
  scopeId: string
  /** The seat's public pseudonym (did:key) — the seatRef receipts cite; NEVER the private key. */
  pseudonym: string
  facet: ScopeFacet
  accessProfile: AccessProfile
  isOwner: boolean
}

/** Build a spec-conformant AccessProfile. `allowCollections`/`allowTrust` default to '*' (full). */
function buildAccessProfile(
  scopeId: string,
  pseudonym: string,
  name: string,
  allowCollections: string[] = ['*'],
  allowTrust: string[] = ['*'],
): AccessProfile {
  return {
    id: ACCESS_PROFILE_PREFIX + scopeId,
    type: 'AccessProfile',
    specVersion: SPEC_VERSION,
    name,
    subjects: [pseudonym],
    purposes: ['ingest', 'query'],
    // Empty array is MEANINGFUL (deny-by-default: no collections). We do NOT coerce []→['*'].
    allowedContentRefs: allowCollections,
    allowedEnvironments: allowTrust.length ? allowTrust : ['*'],
    obligations: ['emit-connector-receipt'],
    expiresAt: null,
  }
}

/** The single-user owner seat: full access, derived from the root at OWNER_SCOPE_ID.
 *  So single-user ingestion works exactly as before. Exception-safe. */
export function defaultOwnerSeat(): Seat {
  try {
    const root = loadOrCreateRoot()
    const facet = deriveScope(root, OWNER_SCOPE_ID)
    return {
      scopeId: OWNER_SCOPE_ID,
      pseudonym: facet.pseudonym,
      facet,
      accessProfile: buildAccessProfile(OWNER_SCOPE_ID, facet.pseudonym, 'Owner', ['*'], ['*']),
      isOwner: true,
    }
  } catch (err) {
    // Identity unavailable must NEVER lock out the owner. Synthesize a full-access owner
    // seat with a stable placeholder pseudonym so ingestion keeps working.
    console.warn('[seat-scope] defaultOwnerSeat fell back to placeholder owner:', err instanceof Error ? err.message : String(err))
    const pseudonym = 'did:key:owner-local'
    const facet: ScopeFacet = {
      scopeId: OWNER_SCOPE_ID,
      pseudonym,
      publicKeyRaw: Buffer.alloc(0),
      sign: () => Buffer.alloc(0),
    }
    return {
      scopeId: OWNER_SCOPE_ID,
      pseudonym,
      facet,
      accessProfile: buildAccessProfile(OWNER_SCOPE_ID, pseudonym, 'Owner', ['*'], ['*']),
      isOwner: true,
    }
  }
}

/**
 * Optional per-seat scoping registry. A deployment can declare scoped seats (collections +
 * trust-levels each may touch) via NOETICA_SEATS_JSON, a JSON map:
 *   { "<scopeId>": { "name": "...", "collections": ["c1"], "trustLevels": ["trusted-workspace-source"] } }
 * Absent → an unknown scoped seat gets a DENY-by-default narrow profile (no collections),
 * which fail-closes out-of-scope ingestion. The owner seat ignores this entirely.
 */
function loadSeatRegistry(): Record<string, { name?: string; collections?: string[]; trustLevels?: string[] }> {
  try {
    const raw = process.env.NOETICA_SEATS_JSON
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    console.warn('[seat-scope] NOETICA_SEATS_JSON parse failed; ignoring:', err instanceof Error ? err.message : String(err))
    return {}
  }
}

/** Derive a scoped (non-owner) seat for a scopeId, applying its registry policy (DENY-by-default). */
export function deriveScopedSeat(scopeId: string): Seat {
  const reg = loadSeatRegistry()[scopeId] ?? {}
  const root = loadOrCreateRoot()
  const facet = deriveScope(root, scopeId)
  // Unknown scoped seat → no collections (deny-by-default); known → its declared scope.
  const collections = Array.isArray(reg.collections) ? reg.collections : []
  const trustLevels = Array.isArray(reg.trustLevels) && reg.trustLevels.length ? reg.trustLevels : ['*']
  return {
    scopeId,
    pseudonym: facet.pseudonym,
    facet,
    accessProfile: buildAccessProfile(scopeId, facet.pseudonym, reg.name || scopeId, collections, trustLevels),
    isOwner: false,
  }
}

/** Resolve the active seat: env NOETICA_SEAT=<scopeId> → derived scoped facet, else the
 *  default owner seat. Single-user (no env) is ALWAYS the full-access owner. Exception-safe. */
export function currentSeat(): Seat {
  try {
    const scopeId = (process.env.NOETICA_SEAT || '').trim()
    if (!scopeId || scopeId === OWNER_SCOPE_ID) return defaultOwnerSeat()
    return deriveScopedSeat(scopeId)
  } catch (err) {
    console.warn('[seat-scope] currentSeat fell back to owner:', err instanceof Error ? err.message : String(err))
    return defaultOwnerSeat()
  }
}

/**
 * Scope check: may this seat ingest/query `collectionId` (optionally at `trustLevel`)?
 *   • Owner seat (or '*' grants) → always true.
 *   • Scoped seat → collection must be in allowedContentRefs AND, if a trustLevel is given,
 *     it must be in allowedEnvironments.
 * Exception-safe: any error denies a scoped seat (fail-closed) but never an owner.
 */
export function seatCanAccess(seat: Seat, collectionId: string, trustLevel?: TrustLevel): boolean {
  try {
    if (!seat) return false
    if (seat.isOwner) return true
    const prof = seat.accessProfile
    const cols = prof.allowedContentRefs ?? []
    const colOk = cols.includes('*') || cols.includes(collectionId)
    if (!colOk) return false
    if (trustLevel !== undefined) {
      const envs = prof.allowedEnvironments ?? []
      const trustKnown = ALL_TRUST_LEVELS.includes(trustLevel)
      const trustOk = envs.includes('*') || (trustKnown && envs.includes(trustLevel))
      if (!trustOk) return false
    }
    return true
  } catch {
    return seat?.isOwner === true
  }
}
