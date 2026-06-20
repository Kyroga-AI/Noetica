/**
 * fabric — the Context Fabric (§4.3 of the voice-concierge spec), implemented as
 * the atomspace itself, not a parallel store. A FabricEntry is an atom:
 *
 *   type  = 'FabricEntry'
 *   tv    = {strength, confidence}   ← belief; PLN revises on re-write (reinforcement)
 *   sti   = ECAN attention            ← salience; decays unless re-stimulated
 *   values: kind / text / provenance / session / ts
 *
 * The "living brief" is NOT a dump — it's the HIGH-STI sub-graph. ECAN decay (already
 * running) is the decay rule the spec flagged as a blocker; the scope rule is just an
 * STI threshold on read. Voice observations, chat sessions, and specialists all read
 * and write the same atoms → one state, every surface (the cross-surface continuity).
 */
import { getAtomSpace } from '@socioprophet/hellgraph'
import { createHash } from 'node:crypto'

// STI lives on atom.av (JS-side). The getSTI/stimulate/ecanStimulate exports route to
// the OpenCog Python sidecar, which isn't installed here — so we read/write attention
// directly on the atom. The JS-side ECAN decay (runs at consolidation) still applies.
const readSti = (atom: { av?: { sti?: number } }): number => atom.av?.sti ?? 0

export type FabricKind = 'goal' | 'thread' | 'assumption' | 'decision' | 'question'
const FABRIC_TYPE = 'FabricEntry'

export interface FabricEntry {
  id: string
  kind: FabricKind
  text: string
  provenance: string   // who wrote it: concierge | researcher | planner | chat | voice
  session: string
  ts: string
  confidence: number
  sti: number
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const val = (atom: { values: Record<string, { value: unknown[] }> }, key: string): string =>
  String((atom.values?.[key]?.value?.[0]) ?? '')

/**
 * Write an entry into the fabric. Content-addressed (kind+text) → idempotent; a
 * re-write reinforces via PLN TruthValue revision and an STI bump (raising salience
 * back into the brief). Returns the stored entry.
 */
export function writeFabricEntry(e: { kind: FabricKind; text: string; provenance: string; session: string; confidence?: number; sti?: number }): FabricEntry {
  const space = getAtomSpace()
  const ts = new Date().toISOString()
  const text = e.text.replace(/\s+/g, ' ').trim().slice(0, 1000)
  const id = createHash('sha1').update(`${e.kind}|${text.toLowerCase().slice(0, 200)}`).digest('hex').slice(0, 16)
  const confidence = clamp01(e.confidence ?? 0.7)
  const atom = space.addNode(FABRIC_TYPE, id, { tv: { strength: 1, confidence } })
  const h = atom.handle
  space.setValue(h, 'fabric:kind', { kind: 'string', value: [e.kind] })
  space.setValue(h, 'fabric:text', { kind: 'string', value: [text] })
  space.setValue(h, 'fabric:provenance', { kind: 'string', value: [e.provenance] })
  space.setValue(h, 'fabric:session', { kind: 'string', value: [e.session] })
  space.setValue(h, 'fabric:ts', { kind: 'string', value: [ts] })
  // Salience → enters the live brief. Re-writing the same entry ACCUMULATES STI
  // (reinforcement), capped; ECAN decay lowers it again when it stops being referenced.
  const sti = Math.min(100, readSti(atom) + (e.sti ?? 12))
  space.setAttentionValue(h, { sti, lti: atom.av?.lti ?? 0, vlti: atom.av?.vlti ?? 0 })
  return { id, kind: e.kind, text, provenance: e.provenance, session: e.session, ts, confidence, sti }
}

/**
 * The living brief: the high-STI sub-graph, attention-gated. Scoped to a session when
 * given (own thread) but always includes globally-salient entries (cross-surface
 * continuity). Ranked by STI, thresholded, capped — a brief, not an accumulation.
 */
export function readBrief(opts: { session?: string; limit?: number; minSti?: number } = {}): FabricEntry[] {
  const space = getAtomSpace()
  const limit = opts.limit ?? 12
  const minSti = opts.minSti ?? 0
  const atoms = space.getByType(FABRIC_TYPE)
  const entries: FabricEntry[] = atoms.map((a) => ({
    id: a.name ?? '',
    kind: (val(a, 'fabric:kind') || 'thread') as FabricKind,
    text: val(a, 'fabric:text'),
    provenance: val(a, 'fabric:provenance'),
    session: val(a, 'fabric:session'),
    ts: val(a, 'fabric:ts'),
    confidence: a.tv?.confidence ?? 0,
    sti: readSti(a),
  }))
  return entries
    .filter((e) => e.text && e.sti >= minSti && (!opts.session || e.session === opts.session || e.sti > (opts.minSti ?? 0) + 5))
    .sort((a, b) => b.sti - a.sti || b.ts.localeCompare(a.ts))
    .slice(0, limit)
}

/** Render the brief as a compact prompt block — shapes engagement, doesn't flood. */
export function briefContext(entries: FabricEntry[]): string {
  if (entries.length === 0) return ''
  const byKind: Record<string, string[]> = {}
  for (const e of entries) (byKind[e.kind] ??= []).push(e.text)
  const order: FabricKind[] = ['goal', 'decision', 'thread', 'question', 'assumption']
  const lines = order
    .filter((k) => byKind[k]?.length)
    .map((k) => `${k}s: ${byKind[k]!.slice(0, 4).join('; ')}`)
  return `\n\n---\n**Live brief** (shared across voice/chat/agents — what we're working on)\n${lines.join('\n')}`
}

export function fabricCount(): number {
  try { return getAtomSpace().getByType(FABRIC_TYPE).length } catch { return 0 }
}
