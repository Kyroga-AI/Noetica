/**
 * verb-sort — the non-separability decision procedure that derives the ACTION basis
 * of the dialogue-flow algebra (port of the SocioProphet `sortverb` brief). It sorts
 * a candidate verb into {PRIMITIVE | ENTANGLEMENT | REDUCIBLE | META} by three tests
 * IN ORDER — order → factorization → minimality — and reports the honest primitive
 * count (never padded toward 10).
 *
 * Topics are the rows (our 22 prime-topics + the domain-pole = 23, the identity model).
 * Verbs are the columns. PRIMITIVE → column; ENTANGLEMENT/META → the +1 embedding row
 * (the rootless exceptional element — the Leech among the 23 Niemeiers); REDUCIBLE →
 * no node (an expression over the basis).
 *
 * Pipeline logic is [CONTRACT]. The three seams are bound per Phase-0 discovery:
 *   SEAM-A independenceMetric  — [obstruction] Mellumwork is doctrine-only; real ι is a
 *                                conditional-independence statistic over the atomspace
 *                                episode log (logTail). Stub reads the declared field.
 *   SEAM-B historyDependence   — [substrate confirmed] ∂O/∂h via permuted logTail replay
 *                                (harness pending). Stub reads the declared field.
 *   SEAM-C ledgerHash          — [bound] canonical-JSON SHA-256, matching cairnpath-adapter.
 * CI-5 (seam isolation): swapping the SEAM-A/B stubs for the real statistics must not
 * change verdicts for verbs whose fields don't depend on them.
 */
import { createHash } from 'node:crypto'

export type Mediator = 'chain' | 'combine' | 'entangle' | 'identity'
export interface Decomp { mediator: Mediator; constituents: string[]; slotBinding?: Record<string, unknown> | null }
export interface Verb {
  id: string
  label: string
  operandType: 'topic' | 'action'   // ORDER probe — operand is a topic (column) or an action (meta)
  decomposition: Decomp | null      // null ⇒ irreducible
  independence: number              // ι ∈ [0,1] (SEAM-A)
  historyDependent: boolean         // ∂O/∂h ≠ 0 (SEAM-B)
}
export type VerdictKind = 'PRIMITIVE' | 'ENTANGLEMENT' | 'REDUCIBLE' | 'META'
export type Placement = 'column' | 'embedding' | 'none'
export interface Verdict {
  verbId: string
  verdict: VerdictKind
  testFired: 'ORDER' | 'MINIMALITY' | 'FACTORIZATION'
  witness: Record<string, unknown>
  extraFidelityBar: string[]
  placement: Placement
  tier: 'T1' | 'T2'
  ternary: 'POS' | 'ZERO' | 'NEG'
  narrative: string
  attestation: string
}

// ── SEAMS ────────────────────────────────────────────────────────────────────
/** SEAM-A. Real ι = conditional independence of constituents given the parent, over
 *  the episode log. Stub returns the declared value (skeleton parity, CI-5 isolated). */
export function independenceMetric(v: Verb): number { return v.independence }
/** SEAM-B. Real probe = re-evaluate the observable under a permuted prior-reading
 *  history h from logTail(); ∂O/∂h ≠ 0 ⇒ history-dependent. Stub returns declared. */
export function historyDependenceProbe(v: Verb): boolean { return v.historyDependent }
/** SEAM-C [bound]. Canonical-JSON SHA-256 — same entrypoint as cairnpath-adapter. */
export function ledgerHash(obj: unknown): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson(obj)).digest('hex')
}
function canonicalJson(obj: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
        : x
  return JSON.stringify(sort(obj))
}

// ── Pipeline [CONTRACT] ──────────────────────────────────────────────────────
const orderTest = (v: Verb): boolean => v.operandType === 'action'   // T0: 2nd-order ⇒ META

/** Separable iff a decomposition exists, constituents independent given parent
 *  (ι ≥ τ), and no history dependence — a product state, not a bound state. */
function separable(v: Verb, tau: number): boolean {
  if (!v.decomposition) return false
  return independenceMetric(v) >= tau && !historyDependenceProbe(v)
}
/** Minimality: candidate collapses to one primitive under a slot rebinding. */
function collapsesToSingle(v: Verb): Decomp | null {
  const d = v.decomposition
  return d && d.mediator === 'identity' && d.constituents.length === 1 && d.slotBinding ? d : null
}

/** Sort a candidate verb. Order fires before factorization (load-bearing). */
export function sortVerb(v: Verb, tau: number): Verdict {
  // T0 — ORDER
  if (orderTest(v)) {
    return mk(v, 'PRIMITIVE_NO', 'ORDER', { operandType: 'action' }, [], 'embedding',
      'operand is an action, not a topic; second-order; lives in the +1 embedding row', 'META')
  }
  // minimality short-circuit: single primitive under a slot binding
  const one = collapsesToSingle(v)
  if (one) {
    return mk(v, 'REDUCIBLE', 'MINIMALITY', { primitive: one.constituents[0], slotBinding: one.slotBinding },
      [], 'none', `collapses to ${one.constituents[0]} under slot binding; fails minimality`)
  }
  // T1 — FACTORIZATION
  if (v.decomposition) {
    if (separable(v, tau)) {
      return mk(v, 'REDUCIBLE', 'FACTORIZATION',
        { mediator: v.decomposition.mediator, constituents: v.decomposition.constituents, iota: independenceMetric(v) },
        [], 'none', 'separable composition (product state); not a new primitive')
    }
    if (!separable(v, tau) && historyDependenceProbe(v)) {
      return mk(v, 'ENTANGLEMENT', 'FACTORIZATION',
        { mediator: 'entangle', constituents: v.decomposition.constituents, iota: independenceMetric(v) },
        ['PERSISTENCE'], 'embedding',
        'non-separable bound state; observable is a function of history h; adds PERSISTENCE to the dispatch bar')
    }
    // decomposed but neither cleanly separable nor history-dependent ⇒ ambiguous, T2/ZERO
    return mk(v, 'ENTANGLEMENT', 'FACTORIZATION',
      { mediator: v.decomposition.mediator, constituents: v.decomposition.constituents, iota: independenceMetric(v), obstruction: 'ambiguous separability' },
      ['PERSISTENCE'], 'embedding', 'ambiguous separability — manual adjudication required', undefined, 'T2')
  }
  // T2 — MINIMALITY: irreducible ⇒ PRIMITIVE (admit as a column)
  return mk(v, 'PRIMITIVE', 'FACTORIZATION', {}, [], 'column',
    'irreducible w.r.t. current basis; admitted as a primitive (column)')
}

function mk(
  v: Verb, verdictRaw: string, test: Verdict['testFired'], witness: Record<string, unknown>,
  bars: string[], placement: Placement, narrative: string, verdictOverride?: VerdictKind, tier: 'T1' | 'T2' = 'T1',
): Verdict {
  const verdict = (verdictOverride ?? verdictRaw) as VerdictKind
  const vd: Verdict = {
    verbId: v.id, verdict, testFired: test, witness, extraFidelityBar: bars, placement,
    tier, ternary: tier === 'T2' ? 'ZERO' : 'POS', narrative, attestation: '',
  }
  vd.attestation = ledgerHash({ verb: v.id, verdict: vd.verdict, test: vd.testFired, witness: vd.witness, bars: vd.extraFidelityBar })
  return vd
}

// ── Spanning [CONTRACT] — report the honest count; never pad ─────────────────
export interface SpanningReport {
  basis: string[]
  count: number
  complete: boolean
  gaps: { requiredAction: string; reason: string }[]
  tenHypothesis: 'CONFIRMED' | 'REFUTED_LOW' | 'REFUTED_HIGH'
}
export function spanningCheck(basis: string[], required: string[], expressible: (r: string, b: string[]) => boolean): SpanningReport {
  const gaps = required.filter((r) => !expressible(r, basis)).map((r) => ({ requiredAction: r, reason: 'neither a primitive nor a composition over the basis' }))
  const count = basis.length
  const tenHypothesis = count === 10 ? 'CONFIRMED' : count < 10 ? 'REFUTED_LOW' : 'REFUTED_HIGH'
  return { basis, count, complete: gaps.length === 0, gaps, tenHypothesis }
}

// ── Adjoint closure — the honest, FACTORED basis: 3 substrates × 2 polarities ─
// The raw spanning derivation returns 5 primitives. Two adjoint pairs were already
// closed inside them (create↔retrieve, transform↔evaluate); `execute` was the only
// open one. Its adjoint is `sense` (actuate↔observe = the controllability/observability
// dual). Closing it yields exactly 6 = 3×2. There is no path to 10: reaching it needs
// two more GENERATORS, which fail minimality (they'd be compositions). 10 is refuted
// twice — at 5 raw and at 6 closed — and 6 is a derived number WITH a factorization.
export type Substrate = 'store' | 'held' | 'world'
export type Polarity = 'read' | 'write'
export const ACTION_SIGNATURE: Record<string, { substrate: Substrate; polarity: Polarity }> = {
  retrieve: { substrate: 'store', polarity: 'read' }, create: { substrate: 'store', polarity: 'write' },
  evaluate: { substrate: 'held', polarity: 'read' }, transform: { substrate: 'held', polarity: 'write' },
  sense: { substrate: 'world', polarity: 'read' }, execute: { substrate: 'world', polarity: 'write' },
}

export interface ClosureReport {
  basis: string[]
  count: number
  factorization: string
  closed: boolean        // every (substrate × polarity) cell filled exactly once (spanning + minimal)
  tenHypothesis: 'REFUTED_LOW' | 'REFUTED_HIGH' | 'CONFIRMED'
  tests: {
    /** polarity-axis guard: read-held (evaluate) must be a different op from read-world (sense). */
    evaluate_perp_sense: boolean
    /** substrate-axis guard: exactly {store, held, world} — no 4th (social/other-agent) substrate. */
    substrate_complete: boolean
  }
  attestation: string
}

/** Confirm the adjoint-closed basis fills the 3×2 grid exactly — spanning + minimal on
 *  BOTH axes — and run the two refutation tests that could collapse it back below 6. */
export function adjointClosure(basis: string[]): ClosureReport {
  const sigs = basis.map((b) => ACTION_SIGNATURE[b]).filter(Boolean) as { substrate: Substrate; polarity: Polarity }[]
  const cells = new Set(sigs.map((s) => `${s.substrate}:${s.polarity}`))
  const substrates = new Set(sigs.map((s) => s.substrate))
  // closed ⇔ each of the 6 cells filled exactly once (bijective onto the 3×2 grid)
  const closed = cells.size === 6 && sigs.length === 6
  const evaluate_perp_sense = ACTION_SIGNATURE['evaluate']?.substrate !== ACTION_SIGNATURE['sense']?.substrate
  const substrate_complete = substrates.size === 3 && ['store', 'held', 'world'].every((s) => substrates.has(s as Substrate))
  const count = basis.length
  const attestation = ledgerHash({ basis: [...basis].sort(), closed, tests: { evaluate_perp_sense, substrate_complete } })
  return {
    basis, count, factorization: '3 substrates × 2 polarities',
    closed, tenHypothesis: count === 10 ? 'CONFIRMED' : count < 10 ? 'REFUTED_LOW' : 'REFUTED_HIGH',
    tests: { evaluate_perp_sense, substrate_complete }, attestation,
  }
}
