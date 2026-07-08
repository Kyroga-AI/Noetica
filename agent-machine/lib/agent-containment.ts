/**
 * agent-containment — the two controls 60–63% of orgs lack (Kiteworks 2026): a hard KILL-SWITCH
 * and PURPOSE-BINDING (Phase 3b, the sovereign wedge).
 *
 *   • Purpose-binding: a session declares a purpose ('read-only' | 'research' | 'build' | 'full');
 *     every capability-bearing action (network, fs-write, exec, tool, memory-write…) is gated
 *     against what that purpose permits. A 'read-only' agent physically cannot write or shell out.
 *   • Kill-switch: one flag that fail-closes EVERYTHING — armed, no guarded action runs, regardless
 *     of purpose. The operator can stop a misbehaving agent instantly.
 *
 * checkAction/resolvePurpose are pure + tested; the module-level guard (arm/bind/assertCapability)
 * is the runtime enforcement the dispatch path calls. Composes with the egress-guard (network in
 * offline mode) and scope-d (cloud egress policy) — this layer gates ALL capabilities by intent.
 */

export type Capability = 'net' | 'fs-read' | 'fs-write' | 'exec' | 'tool' | 'model' | 'memory-write'

export interface Purpose {
  name: string
  allow: Capability[]
  note: string
}

/** The common containment profiles — least-privilege first. */
export const PURPOSES: Record<string, Purpose> = {
  'read-only': { name: 'read-only', allow: ['fs-read', 'model'], note: 'inspect only — no writes, no network, no exec' },
  'research':  { name: 'research', allow: ['fs-read', 'net', 'model', 'tool', 'memory-write'], note: 'read + search + remember; no fs-write or exec' },
  'build':     { name: 'build', allow: ['fs-read', 'fs-write', 'exec', 'model', 'tool', 'memory-write'], note: 'full local dev; no raw network egress' },
  'full':      { name: 'full', allow: ['net', 'fs-read', 'fs-write', 'exec', 'tool', 'model', 'memory-write'], note: 'unrestricted (default)' },
}

export const DEFAULT_PURPOSE = PURPOSES['full']!

/**
 * Opt-in hardened posture (NOETICA_HARDENED_EXEC=1, default off): when set, an unbound session defaults
 * to 'research' — read + search + remember, but NO exec and NO fs-write. This is the injection→RCE/exfil
 * backstop: a prompt-injected `run_command`/`code_execute`/`write_file` is denied by the existing
 * purpose-binding gate unless the session EXPLICITLY elevates to 'build'/'full'. web_search (net) still
 * works, so the agent stays useful; raw shell (the exfil channel) is off. Fully autonomous by default.
 */
function hardenedExecEnabled(): boolean {
  const v = process.env['NOETICA_HARDENED_EXEC']
  return v === '1' || v === 'true'
}
export function baseDefaultPurpose(): Purpose {
  return hardenedExecEnabled() ? PURPOSES['research']! : DEFAULT_PURPOSE
}

export interface ContainmentState {
  killed: boolean
  reason: string | null
  since: string | null
  purpose: Purpose
}

export interface ActionVerdict {
  allowed: boolean
  reason: string
}

/** Resolve a purpose by name; unknown/absent names fall back to the base default (least-privilege
 *  'research' under NOETICA_HARDENED_EXEC, else 'full'). Fail-OPEN on unknown name, fail-CLOSED per capability. */
export function resolvePurpose(name: string | undefined): Purpose {
  return (name && PURPOSES[name]) || baseDefaultPurpose()
}

/**
 * Pure containment decision: kill-switch overrides everything; otherwise the capability must be in
 * the bound purpose's allow-list.
 */
export function checkAction(state: ContainmentState, capability: Capability): ActionVerdict {
  if (state.killed) {
    return { allowed: false, reason: `kill-switch ARMED${state.reason ? ` (${state.reason})` : ''} — all agent action halted` }
  }
  if (state.purpose.allow.includes(capability)) {
    return { allowed: true, reason: `permitted by purpose "${state.purpose.name}"` }
  }
  return { allowed: false, reason: `capability "${capability}" denied — purpose "${state.purpose.name}" permits only: ${state.purpose.allow.join(', ')}` }
}

// ── Runtime enforcement (module-level state the dispatch path calls) ─────────

let _state: ContainmentState = { killed: false, reason: null, since: null, purpose: baseDefaultPurpose() }

/** Arm the kill-switch — every subsequent guarded action fails closed. */
export function armKillSwitch(reason?: string): void {
  _state = { ..._state, killed: true, reason: reason ?? null, since: new Date().toISOString() }
}
export function disarmKillSwitch(): void {
  _state = { ..._state, killed: false, reason: null, since: null }
}
/** Bind the active session to a purpose (least-privilege). */
export function bindPurpose(name: string): Purpose {
  _state = { ..._state, purpose: resolvePurpose(name) }
  return _state.purpose
}
export function containmentState(): ContainmentState {
  return _state
}
/** Hydrate state from persistence at boot (kill-switch survives restart — fail-closed). */
export function hydrateContainment(s: Partial<ContainmentState>): void {
  _state = {
    killed: s.killed ?? _state.killed,
    reason: s.reason ?? _state.reason,
    since: s.since ?? _state.since,
    purpose: s.purpose ?? _state.purpose,
  }
}

/** Guard: throw if the capability isn't permitted (kill-switch or purpose). Call before the action. */
export function assertCapability(capability: Capability): void {
  const v = checkAction(_state, capability)
  if (!v.allowed) throw new Error(`CONTAINMENT BLOCKED: ${v.reason}`)
}

/** Non-throwing check for callers that branch instead of throw. */
export function permits(capability: Capability): boolean {
  return checkAction(_state, capability).allowed
}
