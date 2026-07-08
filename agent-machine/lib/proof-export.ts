/**
 * proof-export — seal an answer into a sovereign, OFFLINE-verifiable proof bundle.
 *
 * The asymmetric win: hand a regulator/auditor one JSON file that proves, WITH NO NETWORK, that a
 * specific answer was produced on this device, from these sources, with these verifier verdicts —
 * hash-chained (any post-hoc edit is detectable), signed by an unlinkable sovereign pseudonym, and
 * bound to a device attestation. Perplexity/Palantir are cloud-tethered and identity-linked; nobody
 * else can produce an air-gapped, cryptographically sealed answer.
 *
 * Composes the primitives already in the tree: audit-chain (hash chain), sovereign-id (scope-isolated
 * unlinkable pseudonym + sign), device-attestation (device key). Pure builder + verifier; the only I/O
 * is loading the sovereign root + device key (done inside the composed libs).
 */
import * as crypto from 'node:crypto'
import { buildChain, verifyChain, GENESIS, type AuditRecord, type ChainEntry } from './audit-chain.js'
import { loadOrCreateRoot, deriveScope, verifyFacet } from './sovereign-id.js'
import { createAttestation, type DeviceAttestation } from './device-attestation.js'

/** The scope the proof pseudonym is derived under — unlinkable from every other scope's identity. */
const PROOF_SCOPE = 'proof-export'

export interface ProofInput {
  runId: string
  question: string
  answer: string
  model: string
  timestamp: string
  /** The message VerificationInfo (badge / replayClass / method / attested). */
  verification?: unknown
  /** Numbered citations grounding the answer. */
  citations?: unknown[]
  groundingStatus?: string
}

export interface ProofBundle {
  version: 'noetica-proof/v1'
  sealedAt: string
  run: { runId: string; question: string; answer: string; model: string; timestamp: string; groundingStatus?: string }
  verification: unknown
  citations: unknown[]
  /** Hash-chained records (order matters): [run, verification, citations, attestation]. */
  chain: ChainEntry[]
  head: string
  /** The unlinkable sovereign pseudonym that signed the chain head. */
  signer: { pseudonym: string; scope: string; publicKeyRaw: string; signature: string }
  attestation: DeviceAttestation
}

/** The exact records folded into the chain — verifyChain recomputes these, so field order/shape is the contract. */
function recordsOf(
  run: ProofBundle['run'], verification: unknown, citations: unknown[], attestation: DeviceAttestation,
): AuditRecord[] {
  return [
    { kind: 'run', ...run },
    { kind: 'verification', verification: verification ?? null },
    { kind: 'citations', citations: citations ?? [] },
    { kind: 'attestation', attestation },
  ]
}

/** Seal an answer into a proof bundle. `sealedAt` is passed in (no ambient clock) for determinism/testability. */
export function buildProofBundle(input: ProofInput, sealedAt: string): ProofBundle {
  const run: ProofBundle['run'] = {
    runId: input.runId, question: input.question, answer: input.answer, model: input.model, timestamp: input.timestamp,
    ...(input.groundingStatus ? { groundingStatus: input.groundingStatus } : {}),
  }
  const verification = input.verification ?? null
  const citations = input.citations ?? []
  const attestation = createAttestation()

  const chain = buildChain(recordsOf(run, verification, citations, attestation))
  const head = chain.length ? chain[chain.length - 1]!.hash : GENESIS

  // Sign the head with a scope-isolated sovereign pseudonym — proves origin without linking to any
  // other identity facet the operator uses.
  const facet = deriveScope(loadOrCreateRoot(), PROOF_SCOPE)
  const signature = facet.sign(Buffer.from(head, 'hex')).toString('base64')

  return {
    version: 'noetica-proof/v1',
    sealedAt,
    run, verification, citations,
    chain, head,
    signer: { pseudonym: facet.pseudonym, scope: PROOF_SCOPE, publicKeyRaw: facet.publicKeyRaw.toString('base64'), signature },
    attestation,
  }
}

export interface ProofVerifyResult {
  valid: boolean
  chainValid: boolean
  signatureValid: boolean
  pseudonymValid: boolean
  attestationValid: boolean
  brokenAt: number | null
  reasons: string[]
}

/** Verify a device attestation's SIGNATURE + key binding WITHOUT the freshness gate — a durable proof is
 *  meant to be opened later, so timestamp integrity comes from the chain, not from a recency window. */
function attestationSignatureValid(a: DeviceAttestation): boolean {
  try {
    const der = crypto.createPublicKey(a.publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer
    const expectedId = crypto.createHash('sha256').update(der).digest('hex')
    if (expectedId !== a.deviceId) return false
    return crypto.verify(null, Buffer.from(`${a.deviceId}:${a.timestamp}`), a.publicKeyPem, Buffer.from(a.signature, 'base64url'))
  } catch { return false }
}

/**
 * Verify a proof bundle entirely OFFLINE: recompute the hash chain from the bundle's own contents, check
 * the pseudonym signature over the head, confirm the pseudonym commits to the signing key, and validate
 * the device attestation signature. No network, no server state — exactly what an auditor runs.
 */
export function verifyProofBundle(bundle: ProofBundle): ProofVerifyResult {
  const reasons: string[] = []

  const records = recordsOf(bundle.run, bundle.verification, bundle.citations, bundle.attestation)
  const chainRes = verifyChain(records, bundle.chain)
  const chainValid = chainRes.valid && chainRes.head === bundle.head
  if (!chainRes.valid) reasons.push(`hash chain broken at record ${chainRes.brokenAt}`)
  else if (chainRes.head !== bundle.head) reasons.push('head hash does not match recomputed chain')

  let signatureValid = false
  try {
    signatureValid = verifyFacet(
      Buffer.from(bundle.signer.publicKeyRaw, 'base64'),
      Buffer.from(bundle.head, 'hex'),
      Buffer.from(bundle.signer.signature, 'base64'),
    )
  } catch { signatureValid = false }
  if (!signatureValid) reasons.push('signer signature over the head is invalid')

  // The pseudonym must be the did:key commitment of the very key that signed — no key swap.
  const expectedPseudonym = 'did:key:z' + Buffer.from(bundle.signer.publicKeyRaw, 'base64').toString('base64url')
  const pseudonymValid = expectedPseudonym === bundle.signer.pseudonym
  if (!pseudonymValid) reasons.push('pseudonym does not commit to the signing key')

  const attestationValid = attestationSignatureValid(bundle.attestation)
  if (!attestationValid) reasons.push('device attestation signature is invalid')

  return {
    valid: chainValid && signatureValid && pseudonymValid && attestationValid,
    chainValid, signatureValid, pseudonymValid, attestationValid,
    brokenAt: chainRes.brokenAt,
    reasons,
  }
}
