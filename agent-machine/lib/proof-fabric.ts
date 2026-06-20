/**
 * proof-fabric — Moat 3, Pillar B: PFK-conformant proof artifacts.
 *
 * Adopts the Heller-Gödel Proof Fabric Kernel: every verified answer emits a
 * `ProofArtifact` (PFK schema) — a certificate carrying the claim, its evidence
 * morphology (inputs), the computation/outputs, and crucially a
 * `non_claim_boundary` declaring what the artifact does NOT assert. That last
 * field bakes in the np-program discipline (verification ≠ generation; calibrated
 * confidence, not certainty) at the data-structure level.
 *
 * Artifacts are written to ~/.noetica/proofs and mirrored as ProofArtifact atoms
 * in the HellGraph, linked to the Episode that produced them.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { getHellGraph } from '@socioprophet/hellgraph'

export interface ProofArtifact {
  artifact_id: string
  artifact_type: string
  claim_class: string
  inputs: Record<string, unknown>[]
  outputs: Record<string, unknown>[]
  non_claim_boundary: string[]
  [k: string]: unknown
}

export interface VerifiedAnswerInput {
  question: string
  answer: string
  /** how the answer was obtained: 'code-executed' (program-aided) | 'reasoned' | 'fallback' */
  method: 'code-executed' | 'reasoned' | 'fallback'
  computation?: string // the executed code, if any
  computedResult?: string
  confidence: number // calibrated [0,1]
  primeSignature?: string
  episodeId?: string
  groundingRefs?: string[]
}

const REQUIRED = ['artifact_id', 'artifact_type', 'claim_class', 'inputs', 'outputs', 'non_claim_boundary'] as const
const PROOFS_DIR = path.join(os.homedir(), '.noetica', 'proofs')

/** Build a PFK-conformant ProofArtifact for a verified answer. */
export function buildVerifiedAnswerArtifact(v: VerifiedAnswerInput): ProofArtifact {
  const id = 'pfk:' + createHash('sha1').update(v.question + '|' + v.answer + '|' + v.method).digest('hex').slice(0, 16)
  // claim_class encodes the epistemic posture (Pillar C discipline)
  const claim_class = v.method === 'code-executed' ? 'empirical/computational-verified' : v.method === 'reasoned' ? 'empirical/reasoned' : 'empirical/unverified'
  const non_claim_boundary = [
    'This artifact does not constitute a formal mathematical proof.',
    'The answer is a calibrated computational result, not a certified theorem.',
    v.method === 'code-executed'
      ? 'Verification means the stated program executed and produced this output; it does not certify the program models the problem correctly.'
      : 'No code execution was performed; the answer rests on model reasoning only.',
    'Confidence is calibrated, not certainty.',
  ]
  return {
    artifact_id: id,
    artifact_type: 'verified_reasoning_answer',
    claim_class,
    inputs: [{
      question: v.question.slice(0, 800),
      prime_signature: v.primeSignature ?? null,
      episode_id: v.episodeId ?? null,
      grounding_refs: v.groundingRefs ?? [],
    }],
    outputs: [{
      answer: v.answer,
      method: v.method,
      computation: v.computation ?? null,
      computed_result: v.computedResult ?? null,
      confidence: Math.max(0, Math.min(1, v.confidence)),
    }],
    non_claim_boundary,
    created_at: new Date().toISOString(),
  }
}

/** Runtime structural validation against the PFK required fields/types. */
export function validateArtifact(a: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!a || typeof a !== 'object') return { ok: false, errors: ['not an object'] }
  const o = a as Record<string, unknown>
  for (const k of REQUIRED) if (!(k in o)) errors.push(`missing ${k}`)
  if (o['inputs'] && !Array.isArray(o['inputs'])) errors.push('inputs must be array')
  if (o['outputs'] && !Array.isArray(o['outputs'])) errors.push('outputs must be array')
  if (o['non_claim_boundary'] && !Array.isArray(o['non_claim_boundary'])) errors.push('non_claim_boundary must be array')
  return { ok: errors.length === 0, errors }
}

/** Write the artifact to disk + mirror as a ProofArtifact atom linked to its Episode. */
export function writeProofArtifact(a: ProofArtifact): string {
  fs.mkdirSync(PROOFS_DIR, { recursive: true })
  const p = path.join(PROOFS_DIR, `${a.artifact_id.replace(/[^a-z0-9]/gi, '_')}.json`)
  fs.writeFileSync(p, JSON.stringify(a, null, 2))
  const g = getHellGraph()
  if (!g.getNode(a.artifact_id)) {
    g.addNode(a.artifact_id, ['ProofArtifact'], {
      artifact_type: a.artifact_type, claim_class: a.claim_class,
      answer: String((a.outputs[0] as any)?.answer ?? ''),
      method: String((a.outputs[0] as any)?.method ?? ''),
      non_claims: a.non_claim_boundary.length, created_at: String(a['created_at'] ?? ''),
    })
    const ep = (a.inputs[0] as any)?.episode_id
    if (ep && g.getNode(ep)) g.addEdge('CERTIFIED_BY', ep, a.artifact_id, { at: new Date().toISOString() })
  }
  return p
}

/** Authoritative validation via the vendored PFK validator (jsonschema Draft2020). */
export function validateWithPFK(artifactPath: string): Promise<boolean> {
  const root = process.env['NOETICA_AM_ROOT'] || path.resolve(__dirname, '..')
  const schema = path.join(root, 'schemas', 'proof_artifact.schema.json')
  const validator = path.join(root, 'scripts', 'validate_proof_artifact.py')
  return new Promise((resolve) => {
    execFile('python3', [validator, '--schema', schema, '--artifact', artifactPath], (err) => resolve(!err))
  })
}

export function proofArtifactCount(): number { return getHellGraph().nodesByLabel('ProofArtifact').length }
