/**
 * crystallize — the Crystal-phase write of the MeshRush loop, for chat answers. A
 * high-worth answer is compiled into a durable atomspace `Artifact` atom carrying its
 * question, provenance, and — crucially — its **dispatch attestation**, linking durable
 * knowledge back to the replayable ledger entry that produced it. High STI (mirrors
 * meshrush-bridge crystallize) so the next diffuse/retrieve surfaces it: the loop
 * closes — diffuse → stop → crystallize → durable → reusable. This is what makes the
 * system COMPOUND (answers become knowledge) and fully traceable (artifact → attestation
 * → ledger → replays).
 */
import { getAtomSpace } from '@socioprophet/hellgraph'
import { createHash } from 'node:crypto'

// Only genuinely good answers crystallize — keeps the durable layer clean (same bar
// as the gold-Q/A flywheel). Gating is on worth (quality), not the latency-aware reward.
const CRYSTALLIZE_WORTH = 0.6
const ARTIFACT_TYPE = 'Artifact'

export interface CrystallizedArtifact { id: string; question: string; session: string; action: string; attestation: string; ts: string }

/** Crystallize an answer as a durable, attested artifact. Idempotent by question
 *  (re-answering reinforces via PLN revision + STI). Returns null if below the bar. */
export function crystallizeAnswer(a: {
  question: string; answer: string; session: string; action: string; attestation: string; worth: number
}): CrystallizedArtifact | null {
  if (a.worth < CRYSTALLIZE_WORTH || !a.answer.trim()) return null
  try {
    const space = getAtomSpace()
    const ts = new Date().toISOString()
    const id = createHash('sha1').update(a.question.toLowerCase().slice(0, 160)).digest('hex').slice(0, 16)
    const atom = space.addNode(ARTIFACT_TYPE, id, { tv: { strength: 1, confidence: Math.max(0, Math.min(1, a.worth)) } })
    const h = atom.handle
    space.setValue(h, 'artifact:question', { kind: 'string', value: [a.question.slice(0, 500)] })
    space.setValue(h, 'artifact:answer', { kind: 'string', value: [a.answer.slice(0, 4000)] })
    space.setValue(h, 'artifact:session', { kind: 'string', value: [a.session] })
    space.setValue(h, 'artifact:action', { kind: 'string', value: [a.action] })
    space.setValue(h, 'artifact:attestation', { kind: 'string', value: [a.attestation] }) // → the replayable ledger entry
    space.setValue(h, 'meshrush:crystallized_at', { kind: 'string', value: [ts] })
    // High STI: newly crystallized structure is salient, so the next diffuse reuses it.
    space.setAttentionValue(h, { sti: 50, lti: 10, vlti: 0 })
    return { id, question: a.question, session: a.session, action: a.action, attestation: a.attestation, ts }
  } catch { return null }
}

/** Diffuse over crystallized artifacts: the cheapest, MOST deterministic answer path —
 *  a verbatim, attested prior answer to a near-identical question. Cache-augmented reuse:
 *  before generating a write, check if the loop already crystallized this. */
export function recallArtifact(question: string): { answer: string; attestation: string } | null {
  try {
    const space = getAtomSpace()
    const id = createHash('sha1').update(question.toLowerCase().slice(0, 160)).digest('hex').slice(0, 16)
    const atom = space.getNode(ARTIFACT_TYPE, id)
    if (!atom) return null
    const answer = String(atom.values?.['artifact:answer']?.value?.[0] ?? '')
    const attestation = String(atom.values?.['artifact:attestation']?.value?.[0] ?? '')
    return answer ? { answer, attestation } : null
  } catch { return null }
}

export function artifactCount(): number {
  try { return getAtomSpace().getByType(ARTIFACT_TYPE).length } catch { return 0 }
}
