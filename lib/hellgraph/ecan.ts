/**
 * ECAN — Economic Attention Allocation for HellGraph.
 *
 * Implements a lightweight ECAN-inspired attention layer over FeatureAtom nodes:
 *   - STI (short-term importance): spikes on mention, spreads to neighbors, decays per session
 *   - LTI (long-term importance): accumulates slowly across sessions, never decays fast
 *   - VLTI (very-long-term): permanently important atoms (set manually or via LTI threshold)
 *
 * STI is the working-memory signal: what the graph is "thinking about" right now.
 * LTI is the semantic memory signal: what has consistently mattered over time.
 * Retrieval scoring multiplies base token score by (1 + sti_norm) so active concepts surface.
 */

import { getHellGraph } from './store'

const STI_PROP  = 'ecan:sti'
const LTI_PROP  = 'ecan:lti'
const VLTI_PROP = 'ecan:vlti'

const STI_MAX          = 1000
const LTI_MAX          = 1000
const LTI_PROMOTE_THRESHOLD = 700   // LTI above this → VLTI = 1
const SPREAD_EDGE_TYPES = ['COOCCURS_WITH', 'RELATED_TO', 'MENTIONED_IN']

// ─── Read helpers ─────────────────────────────────────────────────────────────

export function getSTI(atomId: string): number {
  return Number(getHellGraph().getNode(atomId)?.properties[STI_PROP] ?? 0)
}

export function getLTI(atomId: string): number {
  return Number(getHellGraph().getNode(atomId)?.properties[LTI_PROP] ?? 0)
}

export function getVLTI(atomId: string): boolean {
  return Boolean(getHellGraph().getNode(atomId)?.properties[VLTI_PROP])
}

/** Normalized STI in [0,1] for use as a retrieval score multiplier. */
export function stiNorm(atomId: string): number {
  return getSTI(atomId) / STI_MAX
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Stimulate an atom: bump STI by `amount`, accumulate LTI at 10% rate.
 * Call this every time an entity is mentioned in a message.
 */
export function stimulate(atomId: string, amount = 100): void {
  const g = getHellGraph()
  if (!g.getNode(atomId)) return

  const sti = Math.min(getSTI(atomId) + amount, STI_MAX)
  const lti = Math.min(getLTI(atomId) + amount * 0.1, LTI_MAX)

  g.setNodeProperty(atomId, STI_PROP, sti)
  g.setNodeProperty(atomId, LTI_PROP, lti)

  if (lti >= LTI_PROMOTE_THRESHOLD) {
    g.setNodeProperty(atomId, VLTI_PROP, true)
  }
}

/**
 * Spread attention from a stimulated atom to its neighbors.
 * Called after stimulate() for high-STI atoms.
 */
export function spreadAttention(atomId: string, decayFactor = 0.65): void {
  const g = getHellGraph()
  const sti = getSTI(atomId)
  if (sti < 20) return  // not worth spreading below threshold

  const spreadAmount = sti * decayFactor * 0.4

  for (const edgeType of SPREAD_EDGE_TYPES) {
    const neighbors = g.out(atomId, edgeType)
    for (const neighbor of neighbors.slice(0, 12)) {
      const current = Number(neighbor.properties[STI_PROP] ?? 0)
      g.setNodeProperty(neighbor.id, STI_PROP, Math.min(current + spreadAmount, STI_MAX))
    }
  }
}

/**
 * Decay all FeatureAtom STI values by `factor`.
 * Call at session boundary to simulate forgetting.
 * VLTI atoms are exempt — they never decay below 10% of STI_MAX.
 */
export function decayAll(factor = 0.85): number {
  const g = getHellGraph()
  const atoms = g.allNodes().filter(n => n.labels.includes('FeatureAtom'))
  let decayed = 0
  for (const atom of atoms) {
    const sti = Number(atom.properties[STI_PROP] ?? 0)
    if (sti <= 0) continue
    const vlti = Boolean(atom.properties[VLTI_PROP])
    const floor = vlti ? STI_MAX * 0.1 : 0
    g.setNodeProperty(atom.id, STI_PROP, Math.max(sti * factor, floor))
    decayed++
  }
  return decayed
}
