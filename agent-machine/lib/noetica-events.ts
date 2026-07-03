/**
 * noetica-events — the governed OPERATIONAL event lane for ~/.noetica.
 *
 * Emits envelope-redacted, provenance-classed events conforming to
 * ~/.noetica/schemas/noetica.event.schema.json (which conforms to sourceos-spec
 * EventEnvelope: eventId/eventType/specVersion/occurredAt/actor/objectId/payload/integrity).
 * This lane is for feature health, permission changes, and governance verdicts — it
 * COMPLEMENTS the ReasoningRun/Event/Receipt spine (reasoning-evidence.ts), it does not
 * replace it. Design mined from Claude Code's tengu telemetry (see ~/.noetica/NOETICA.md):
 *
 *  - Tri-state health: ok / sad (degraded-but-survived) / bad (hard fail). Never omit sad.
 *  - Operation ⊥ verdict: facts and judgement are separate events (kind field).
 *  - Redaction at the ENVELOPE, never the leaf: governance/redaction.json is applied to
 *    the whole envelope right before serialization, plus the hash-echo invariant — no
 *    cleartext value may remain whose hashed form appears elsewhere in the same event.
 *  - Fail-degraded, never fail-silent: if governance files are unreadable we run on
 *    built-in defaults AND emit a one-time feature.sad about it.
 *
 * ENFORCEMENT (2026-07-03 convergence with ~/.noetica/bin/noetica_emit.py — the "court"):
 * this lane now runs the same invariant gauntlet as the stdlib emitter and shares its
 * hash scheme (v1), so a TS-emitted event verifies under `noetica_emit.py validate`:
 *  - I2 octet-reversal: an IP and its byte-reverse in one event without a derivation link
 *       is refused (the "154.66.149.34 was 34.149.66.154 backwards" PTR-misread class).
 *  - I3 disclosure: a payload capability not declared allow in governance/disclosure.json
 *       (or declared deny, or status=ask without a live grant receipt) is refused, fail-closed.
 *  - I4/I5/I6 authority: an authority=unverified actor's observed/derived claims are demoted
 *       to `asserted` WITH a co-emitted claim_demoted receipt; an unverified decision_basis is
 *       refused (the 4.5 TB counter guard); derived needs inputs, inherited needs origin_run.
 * A governance violation is never thrown at the host — it is REFUSED and the refusal is
 * itself an event (noetica.governance.violation / .undisclosed_capability, severity bad).
 *
 * Hash scheme v1 (shared with noetica_emit.py): sha256 over canonical JSON (sorted keys,
 * compact separators, UTF-8, non-ASCII preserved) of the whole event with only
 * integrity.envelope_hash removed — so redaction_applied is itself covered by the hash.
 *
 * Exception-safe throughout: an evidence failure must NEVER break the host operation.
 * Dependency-light: node crypto + fs only.
 */
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SPEC_VERSION = '0.1.0'
const DEFAULT_ACTOR = { id: 'agent:noetica-agent-machine', authority: 'delegated' as const }

export type Severity = 'ok' | 'sad' | 'bad'
export type EventKind = 'operation' | 'verdict'
export type Tier = 'telemetry' | 'substrate' | 'peripheral'
export type Provenance = 'observed' | 'derived' | 'asserted' | 'inherited'
export type Authority = 'owner' | 'delegated' | 'unverified'

export interface Claim {
  field: string
  value: unknown
  provenance: Provenance
  verified?: boolean
  inputs?: string[]
  origin_run?: string
  decision_basis?: boolean
}

export interface NoeticaEventArgs {
  eventType: string           // noetica.<domain>.<name> per the schema pattern
  objectId: string            // what the event is about (feature name, tool, field, run)
  severity?: Severity
  kind?: EventKind
  tier?: Tier
  claims?: Claim[]
  capabilities?: string[]     // capabilities this event's operation activates (I3 disclosure)
  actor?: { id: string; authority: Authority }
  correlation?: Record<string, unknown>
  extra?: Record<string, unknown>
}

// ─── Governance violation (fail-closed; refused-as-event, never thrown at the host) ──

class GovernanceViolation extends Error {
  constructor(public code: string, public detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'GovernanceViolation'
  }
}

// ─── Governance: redaction rules (fail-degraded, never fail-silent) ────────────

type RedactionAction = 'hash' | 'drop' | 'redact' | 'hash-and-count'
interface RedactionRules {
  classes: Record<string, { action: RedactionAction; placeholder?: string }>
  fields: Record<string, string>
}

/** Built-in floor: applied even when governance/redaction.json is unreadable. */
const BUILTIN_RULES: RedactionRules = {
  classes: {
    'pii': { action: 'hash' },
    'secret': { action: 'drop' },
    'canon-restricted': { action: 'redact', placeholder: '[canon-restricted]' },
    'content': { action: 'hash-and-count' },
  },
  fields: {
    device_id: 'pii', account_uuid: 'pii', organization_uuid: 'pii', email: 'pii',
    api_key: 'secret', oauth_token: 'secret', password: 'secret',
    prompt_text: 'content', completion_text: 'content',
  },
}

/** Built-in actor→authority floor (mirrors governance/authority.json's actor table), used
 *  when authority.json is unreadable so known actors still resolve fail-degraded rather than
 *  every observed claim being demoted. Unknown actors default to `unverified` (observe-only). */
const BUILTIN_AUTHORITY: Record<string, Authority> = {
  'human:mdheller': 'owner',
  'sdk:claude-code': 'delegated',
  'agent:noetica-agent-machine': 'delegated',
  'agent:local-7b': 'unverified',
  'ci:sourceos-ci': 'delegated',
  'tool:permission-ledger': 'delegated',
  'tool:noetica_emit': 'delegated',
}

interface DisclosureEntry { status: 'allow' | 'ask' | 'deny'; disclosure?: string }
interface DisclosureRules { default?: string; capabilities: Record<string, DisclosureEntry>; max_grant_age_hours?: number }

function noeticaHome(): string { return process.env.NOETICA_HOME || join(homedir(), '.noetica') }
function sink(): string { return process.env.NOETICA_EVENTS_SINK || join(noeticaHome(), 'sessions') }
function dayFile(): string {
  const d = new Date().toISOString().slice(0, 10)
  return join(sink(), `events-${d}.ndjson`)
}
function sha16(s: string): string { return createHash('sha256').update(s).digest('hex').slice(0, 16) }

let _rules: RedactionRules | null = null
let _rulesDegraded = false
let _degradedReported = false
let _authority: Record<string, Authority> | null = null
let _disclosure: DisclosureRules | null = null
let _disclosureTried = false

function loadRules(): RedactionRules {
  if (_rules) return _rules
  try {
    const raw = JSON.parse(readFileSync(join(noeticaHome(), 'governance', 'redaction.json'), 'utf8'))
    const classes: RedactionRules['classes'] = {}
    for (const [k, v] of Object.entries(raw.classes ?? {})) {
      const c = v as { action?: string; placeholder?: string }
      if (c && typeof c.action === 'string') classes[k] = { action: c.action as RedactionAction, placeholder: c.placeholder }
    }
    const fields: RedactionRules['fields'] = {}
    for (const [k, v] of Object.entries(raw.fields ?? {})) if (typeof v === 'string') fields[k] = v
    _rules = { classes: { ...BUILTIN_RULES.classes, ...classes }, fields: { ...BUILTIN_RULES.fields, ...fields } }
    _rulesDegraded = false
  } catch {
    // Fail-degraded: run on the built-in floor and say so (once) — never fail-silent.
    _rules = BUILTIN_RULES
    _rulesDegraded = true
  }
  return _rules
}

/** authority.json → actor:authority map, merged over the built-in floor (fail-degraded). */
function loadAuthority(): Record<string, Authority> {
  if (_authority) return _authority
  const map: Record<string, Authority> = { ...BUILTIN_AUTHORITY }
  try {
    const raw = JSON.parse(readFileSync(join(noeticaHome(), 'governance', 'authority.json'), 'utf8'))
    for (const a of raw.actors ?? []) if (a?.actor && a?.authority) map[a.actor] = a.authority
  } catch { /* built-in floor */ }
  _authority = map
  return _authority
}

/** disclosure.json → capability registry, or null when absent (checked only when an event
 *  actually declares capabilities, so a missing file never blocks capability-free events). */
function loadDisclosure(): DisclosureRules | null {
  if (_disclosureTried) return _disclosure
  _disclosureTried = true
  try { _disclosure = JSON.parse(readFileSync(join(noeticaHome(), 'governance', 'disclosure.json'), 'utf8')) as DisclosureRules }
  catch { _disclosure = null }
  return _disclosure
}

/** Test hook: drop all governance caches (and the one-time degraded report latch). */
export function _resetGovernanceCacheForTest(): void {
  _rules = null; _rulesDegraded = false; _degradedReported = false
  _authority = null; _disclosure = null; _disclosureTried = false
}

// ─── Envelope-level redaction ───────────────────────────────────────────────────

interface Applied { field: string; class: string; action: RedactionAction }

function redactValue(v: unknown, action: RedactionAction, placeholder?: string): unknown {
  switch (action) {
    case 'hash': return `sha256-16:${sha16(String(v))}`
    case 'redact': return placeholder ?? '[redacted]'
    case 'hash-and-count': { const s = String(v); return `hash-and-count:${s.length}:${sha16(s)}` }
    case 'drop': return undefined // handled by caller (key removal)
  }
}

/** Deep-walk the WHOLE envelope applying field rules. Enforcement point = envelope,
 *  never the leaf: this runs once, on the fully-assembled event, so a sensitive field
 *  is caught wherever it appears (payload, extra, correlation — or the envelope itself). */
function applyFieldRules(node: unknown, rules: RedactionRules, applied: Applied[]): unknown {
  if (Array.isArray(node)) return node.map((x) => applyFieldRules(x, rules, applied))
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const cls = rules.fields[k]
    if (cls && v !== undefined && v !== null) {
      const action = rules.classes[cls]?.action ?? 'redact'
      if (action === 'drop') { applied.push({ field: k, class: cls, action }); continue }
      out[k] = redactValue(v, action, rules.classes[cls]?.placeholder)
      applied.push({ field: k, class: cls, action })
      continue
    }
    out[k] = typeof v === 'object' && v !== null ? applyFieldRules(v, rules, applied) : v
  }
  return out
}

/** Hash-echo invariant (redaction.json invariant #1): after field rules, no cleartext
 *  string may remain whose sha256-16 appears elsewhere in the same event. Catches the
 *  tengu leak class (payload redacted, envelope clear) AND value-in-two-representations. */
function enforceHashEcho(node: unknown, applied: Applied[]): unknown {
  const hashes = new Set<string>()
  const collect = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(collect); return }
    if (n !== null && typeof n === 'object') { Object.values(n).forEach(collect); return }
    if (typeof n === 'string') {
      const m = n.match(/^(?:sha256-16|hash-and-count:\d+):([0-9a-f]{16})$/)
      if (m) hashes.add(m[1])
    }
  }
  collect(node)
  if (hashes.size === 0) return node
  const fix = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(fix)
    if (n !== null && typeof n === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) out[k] = fix(v)
      return out
    }
    if (typeof n === 'string' && !n.startsWith('sha256-16:') && !n.startsWith('hash-and-count:') && hashes.has(sha16(n))) {
      applied.push({ field: '(hash-echo)', class: 'invariant', action: 'hash' })
      return `sha256-16:${sha16(n)}`
    }
    return n
  }
  return fix(node)
}

/** Canonical-JSON hash (sorted keys) — the envelope_hash. Scheme v1 (shared with
 *  noetica_emit.py): computed over the whole event with only integrity.envelope_hash
 *  removed, so redaction_applied is covered. JSON.stringify preserves non-ASCII (matches
 *  python ensure_ascii=False) and uses compact separators (matches separators=(",",":")). */
function canonicalHash(obj: unknown): string {
  const canon = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(canon)
    if (n !== null && typeof n === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(n as Record<string, unknown>).sort()) out[k] = canon((n as Record<string, unknown>)[k])
      return out
    }
    return n
  }
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(obj))).digest('hex')
}

// ─── Enforcement gauntlet (mirrors noetica_emit.py; violations are refused, never thrown) ──

const EVENT_TYPE_RE = /^noetica\.(run|turn|feature|skill|plugin|gate|governance|redaction|permission|substrate)\.[a-z_]+$/
const IPV4_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g

function collectStrings(node: unknown, out: string[]): void {
  if (Array.isArray(node)) { for (const v of node) collectStrings(v, out); return }
  if (node !== null && typeof node === 'object') { for (const v of Object.values(node)) collectStrings(v, out); return }
  if (typeof node === 'string') out.push(node)
}

/** Schema-shape checks (mirrors schemas/noetica.event.schema.json). */
function validateShape(ev: Record<string, unknown>): void {
  for (const req of ['eventId', 'eventType', 'specVersion', 'occurredAt', 'actor', 'objectId', 'payload']) {
    if (!(req in ev)) throw new GovernanceViolation('shape', `missing required field '${req}'`)
  }
  if (!EVENT_TYPE_RE.test(String(ev.eventType))) throw new GovernanceViolation('shape', `eventType '${String(ev.eventType)}' not in taxonomy`)
  const payload = (ev.payload ?? {}) as Record<string, unknown>
  const sev = payload.severity
  if (sev != null && !['ok', 'sad', 'bad'].includes(String(sev))) {
    throw new GovernanceViolation('shape', `severity '${String(sev)}' — tri-state only (never collapse sad)`)
  }
  const auth = (ev.actor as Record<string, unknown> | undefined)?.authority
  if (!['owner', 'delegated', 'unverified'].includes(String(auth))) {
    throw new GovernanceViolation('shape', `actor.authority '${String(auth)}' invalid`)
  }
}

/** I2: octet-reversal guard. Two IPv4s in one event where one is the byte-reversal of the
 *  other, with no derivation link, is refused (the PTR-misread class). */
function checkTwoRepresentations(ev: Record<string, unknown>): void {
  const strings: string[] = []
  collectStrings(ev, strings)
  const ips = new Set<string>()
  for (const s of strings) {
    const re = new RegExp(IPV4_RE)
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      if (m[0].split('.').every((o) => Number(o) >= 0 && Number(o) <= 255)) ips.add(m[0])
    }
  }
  const links = new Set<string>()
  const claims = ((ev.payload as Record<string, unknown>)?.claims as Claim[] | undefined) ?? []
  for (const c of claims) {
    if (c?.provenance === 'derived') { for (const i of c.inputs ?? []) links.add(String(i)); links.add(String(c.value ?? '')) }
  }
  for (const ip of ips) {
    const rev = ip.split('.').reverse().join('.')
    if (rev !== ip && ips.has(rev) && !links.has(ip) && !links.has(rev)) {
      throw new GovernanceViolation('two_representations', `${ip} and its octet-reversal ${rev} both present without a derivation link (the PTR-misread class)`)
    }
  }
}

/** I3: fail-closed capability disclosure gate — only engaged when the event declares caps. */
function checkDisclosure(ev: Record<string, unknown>): void {
  const caps = ((ev.payload as Record<string, unknown>)?.capabilities as string[] | undefined) ?? []
  if (!caps.length) return
  const disc = loadDisclosure()
  if (!disc) throw new GovernanceViolation('undisclosed_capability', 'event declares capabilities but governance/disclosure.json is unreadable (fail-closed)')
  for (const cap of caps) {
    const entry = disc.capabilities?.[cap]
    if (!entry) throw new GovernanceViolation('undisclosed_capability', `capability '${cap}' not declared in governance/disclosure.json (default=${disc.default ?? 'deny'})`)
    if (entry.status === 'deny') throw new GovernanceViolation('capability_denied', `capability '${cap}' is declared deny`)
    if (entry.status === 'ask' && !hasLiveGrant(cap, disc)) throw new GovernanceViolation('capability_ungranted', `capability '${cap}' is status=ask with no live grant receipt in sessions/`)
  }
}

/** A status=ask capability needs a noetica.permission.granted receipt for it, newer than
 *  max_grant_age_hours, in the sessions/ stream. */
function hasLiveGrant(cap: string, disc: DisclosureRules): boolean {
  const maxAgeMs = (disc.max_grant_age_hours ?? 24) * 3600 * 1000
  const now = Date.now()
  try {
    const dir = sink()
    const files = readdirSync(dir).filter((f) => f.startsWith('events-') && f.endsWith('.ndjson')).sort().reverse()
    for (const f of files) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        let ev: Record<string, unknown>
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.eventType !== 'noetica.permission.granted' || ev.objectId !== cap) continue
        const ts = Date.parse(String(ev.occurredAt))
        if (!Number.isNaN(ts) && now - ts <= maxAgeMs) return true
      }
    }
  } catch { /* no readable sessions yet */ }
  return false
}

interface Demotion { field: string; winner_class: 'asserted'; loser_class: string; winner_source: string; loser_source: string; resolvedAt: string }

/** I4/I5/I6: actor authority caps claim provenance; unverified metrics can't drive
 *  decisions; derived/inherited claims carry their obligations. Mutates demoted claims in
 *  place and returns the demotions to co-emit as loud receipts. */
function checkActorAndClaims(ev: Record<string, unknown>): Demotion[] {
  const actor = (ev.actor ?? {}) as { id?: string; authority?: string }
  const authority = loadAuthority()
  const actorId = actor.id ?? ''
  const registered = Object.prototype.hasOwnProperty.call(authority, actorId)
  const actorAuth: Authority = authority[actorId] ?? 'unverified'
  if (registered && actor.authority !== actorAuth) {
    throw new GovernanceViolation('authority_mismatch', `actor ${actorId} self-declares ${String(actor.authority)} but governance/authority.json binds ${actorAuth}`)
  }
  const demotions: Demotion[] = []
  const claims = ((ev.payload as Record<string, unknown>)?.claims as Claim[] | undefined) ?? []
  for (const claim of claims) {
    const prov = claim.provenance
    if (prov === 'derived' && !(claim.inputs && claim.inputs.length)) {
      throw new GovernanceViolation('derived_without_inputs', `claim '${claim.field}' is derived but names no inputs`)
    }
    if (prov === 'inherited' && !claim.origin_run) {
      throw new GovernanceViolation('inherited_without_origin', `claim '${claim.field}' is inherited but carries no origin_run`)
    }
    if (claim.decision_basis && !claim.verified) {
      throw new GovernanceViolation('unverified_decision_basis', `claim '${claim.field}' is marked decision_basis but verified=false — display, never act`)
    }
    if (actorAuth === 'unverified' && (prov === 'observed' || prov === 'derived')) {
      demotions.push({ field: claim.field, winner_class: 'asserted', loser_class: prov, winner_source: 'governance/authority.json rule 2', loser_source: actorId, resolvedAt: new Date().toISOString() })
      claim.provenance = 'asserted'
      claim.verified = false
    }
  }
  return demotions
}

// ─── The emitter ────────────────────────────────────────────────────────────────

/** Re-entrancy latch: governance meta-events (refusals, demotions) are trusted and must
 *  not recurse through enforcement. */
let _inGovernanceEmit = false

/** Emit one governed operational event. Assembles the EventEnvelope-conformant shape, runs
 *  the enforcement gauntlet (I2/I3/I4/I5/I6 + shape), applies envelope-level redaction + the
 *  hash-echo invariant, stamps integrity (redaction_applied + v1 envelope_hash), appends
 *  NDJSON to ~/.noetica/sessions/. A governance violation refuses the event (emitting the
 *  refusal as its own event) and returns ''. Returns the eventId on success. NEVER throws. */
export function emitNoeticaEvent(args: NoeticaEventArgs): string {
  try {
    const rules = loadRules()
    const eventId = randomUUID()
    let envelope: Record<string, unknown> = {
      eventId,
      eventType: args.eventType,
      specVersion: SPEC_VERSION,
      occurredAt: new Date().toISOString(),
      actor: args.actor ?? DEFAULT_ACTOR,
      objectId: String(args.objectId ?? '').slice(0, 300),
      ...(args.correlation ? { correlation: args.correlation } : {}),
      payload: {
        ...(args.severity ? { severity: args.severity } : {}),
        ...(args.kind ? { kind: args.kind } : {}),
        ...(args.tier ? { tier: args.tier } : {}),
        ...(args.claims?.length ? { claims: args.claims } : {}),
        ...(args.capabilities?.length ? { capabilities: args.capabilities } : {}),
        ...(args.extra ?? {}),
      },
    }

    // ── enforcement gauntlet (skipped for trusted governance meta-events) ──
    let demotions: Demotion[] = []
    if (!_inGovernanceEmit) {
      try {
        validateShape(envelope)
        checkDisclosure(envelope)
        demotions = checkActorAndClaims(envelope) // mutates demoted claims in place
        checkTwoRepresentations(envelope)
      } catch (v) {
        if (v instanceof GovernanceViolation) { emitRefusal(v, args); return '' }
        throw v
      }
    }
    // Demotions are loud: co-emit the receipt(s) before the (mutated) host event.
    for (const d of demotions) {
      emitGovernanceEvent('noetica.governance.claim_demoted', d.field, 'sad', { resolution: d })
    }

    const applied: Applied[] = []
    envelope = applyFieldRules(envelope, rules, applied) as Record<string, unknown>
    envelope = enforceHashEcho(envelope, applied) as Record<string, unknown>
    // v1: integrity (redaction_applied + redactions) is part of the hashed body; only
    // envelope_hash is excluded from its own hash.
    const integrity: Record<string, unknown> = { redaction_applied: true, ...(applied.length ? { redactions: applied } : {}) }
    envelope.integrity = integrity
    integrity.envelope_hash = canonicalHash(envelope)
    mkdirSync(sink(), { recursive: true })
    appendFileSync(dayFile(), JSON.stringify(envelope) + '\n')
    // Governance-source degradation is itself evidence — one-time, after the sink works.
    if (_rulesDegraded && !_degradedReported) {
      _degradedReported = true
      featureSad('governance_redaction_load', 'builtin_defaults_used')
    }
    return eventId
  } catch (err) {
    console.warn('[noetica-events] emit failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

/** Emit a trusted governance meta-event (refusal / demotion receipt) without re-enforcing. */
function emitGovernanceEvent(eventType: string, objectId: string, severity: Severity, extra: Record<string, unknown>): void {
  const prev = _inGovernanceEmit
  _inGovernanceEmit = true
  try {
    emitNoeticaEvent({ eventType, objectId, severity, kind: 'verdict', tier: 'telemetry', extra })
  } finally {
    _inGovernanceEmit = prev
  }
}

/** I3/I-any second half: a governance violation is refused, and the refusal is itself an event. */
function emitRefusal(v: GovernanceViolation, orig: NoeticaEventArgs): void {
  const isCap = v.code === 'undisclosed_capability' || v.code === 'capability_denied' || v.code === 'capability_ungranted'
  emitGovernanceEvent(
    isCap ? 'noetica.governance.undisclosed_capability' : 'noetica.governance.violation',
    v.code,
    'bad',
    { violation: v.code, detail: v.detail, refused_event_type: orig.eventType },
  )
}

// ─── Tri-state feature health (tengu_feature_ok/sad/bad analog) ────────────────

export function featureOk(name: string, extra?: Record<string, unknown>): string {
  return emitNoeticaEvent({ eventType: 'noetica.feature.ok', objectId: name, severity: 'ok', kind: 'verdict', tier: 'telemetry', extra })
}
/** Degraded-but-survived: ran on a fallback (stale cache, last-known-good, builtin defaults). */
export function featureSad(name: string, errorCode: string, extra?: Record<string, unknown>): string {
  return emitNoeticaEvent({ eventType: 'noetica.feature.sad', objectId: name, severity: 'sad', kind: 'verdict', tier: 'telemetry', extra: { error_code: errorCode, ...extra } })
}
export function featureBad(name: string, errorCode: string, extra?: Record<string, unknown>): string {
  return emitNoeticaEvent({ eventType: 'noetica.feature.bad', objectId: name, severity: 'bad', kind: 'verdict', tier: 'telemetry', extra: { error_code: errorCode, ...extra } })
}

// ─── Gate + permission lanes ────────────────────────────────────────────────────

/** Autonomy/permission gate verdict (control-plane analog of tengu can_use_tool). */
export function gateVerdict(d: { tool: string; decision: string; requestedLevel: string; grantedLevel: string; role: string; reason?: string }): string {
  return emitNoeticaEvent({
    eventType: d.decision === 'deny' || d.decision === 'demote' ? 'noetica.gate.rejected' : 'noetica.gate.roundtrip',
    objectId: d.tool,
    severity: d.decision === 'deny' ? 'bad' : d.grantedLevel !== d.requestedLevel ? 'sad' : 'ok',
    kind: 'verdict',
    tier: 'telemetry',
    claims: [{ field: 'granted_level', value: d.grantedLevel, provenance: 'observed', verified: true }],
    extra: { decision: d.decision, requested: d.requestedLevel, granted: d.grantedLevel, role: d.role, ...(d.reason ? { reason: d.reason } : {}) },
  })
}

/** Peripheral-tier permission-state change (Accessibility/mic/TCC class — invariant 5:
 *  grants and revocations are datable events, not ambient state). */
export function permissionChanged(subject: string, granted: boolean, detail?: Record<string, unknown>): string {
  return emitNoeticaEvent({
    eventType: granted ? 'noetica.permission.granted' : 'noetica.permission.revoked',
    objectId: subject,
    severity: 'ok',
    kind: 'operation',
    tier: 'peripheral',
    claims: [{ field: 'granted', value: granted, provenance: 'observed', verified: true }],
    extra: detail,
  })
}

// ─── Boot evidence ──────────────────────────────────────────────────────────────

/** Called once at boot: records governance-file health and the autonomy-bind state.
 *  The gate being UNBOUND is a chosen (backward-compatible) state → ok with an observed
 *  claim, not sad. Exception-safe. */
export function noeticaBootEvidence(): void {
  try {
    _resetGovernanceCacheForTest() // re-read governance freshly each boot
    loadRules()
    if (_rulesDegraded) featureSad('governance_redaction_load', 'builtin_defaults_used')
    else featureOk('governance_redaction_load')
    let bound = false
    try { readFileSync(join(noeticaHome(), 'autonomy.json'), 'utf8'); bound = true } catch { /* unbound */ }
    featureOk('autonomy_gate', undefined)
    emitNoeticaEvent({
      eventType: 'noetica.governance.conflict_resolved',
      objectId: 'autonomy_bind_state',
      kind: 'operation',
      tier: 'telemetry',
      claims: [{ field: 'autonomy_bound', value: bound, provenance: 'observed', verified: true }],
      extra: { note: bound ? 'gate active (fail-closed)' : 'gate not enforced (no autonomy.json — deliberate)' },
    })
  } catch (err) {
    console.warn('[noetica-events] boot evidence failed:', err instanceof Error ? err.message : String(err))
  }
}
