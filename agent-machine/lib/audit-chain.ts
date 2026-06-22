/**
 * audit-chain — tamper-evident governance audit (Phase 3a, the sovereign wedge).
 *
 * The field gap every sovereign-AI vendor shares: their audit trails are "internally consistent
 * but externally unverifiable" — a self-report the operator could edit after the fact. This makes
 * the governance ring EVIDENCE:
 *   • each record is hash-chained (hash = sha256(prevHash ‖ canonical(record))) so inserting,
 *     editing, reordering, or deleting any record breaks the chain at a detectable point;
 *   • the chain head is Ed25519-signed by a device key the agent loop cannot forge — so a CISO
 *     can verify, offline, that what left the device is exactly what's attested and nothing was
 *     altered.
 * Pure + deterministic (crypto via node:crypto); persistence/signing-key I/O lives in the caller.
 */

import { createHash, sign as edSign, verify as edVerify, generateKeyPairSync, type KeyObject } from 'node:crypto'

export type AuditRecord = Record<string, unknown>

export interface ChainEntry {
  index: number
  hash: string
  prevHash: string
}

export interface VerifyResult {
  valid: boolean
  brokenAt: number | null // first index where the recomputed chain diverges, or null when intact
  head: string // recomputed head hash (the value to sign / attest)
  length: number
}

export const GENESIS = '0'.repeat(64)

/** Stable JSON: keys sorted recursively, so the hash of equal data is identical regardless of key order. */
export function canonical(value: unknown): string {
  const enc = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(enc)
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) out[k] = enc(o[k])
    return out
  }
  return JSON.stringify(enc(value))
}

/** hash = sha256(prevHash ‖ canonical(record)) — links each record to its predecessor. */
export function hashRecord(prevHash: string, record: AuditRecord): string {
  return createHash('sha256').update(prevHash).update(canonical(record)).digest('hex')
}

/** Fold records into a hash chain (genesis-anchored). */
export function buildChain(records: AuditRecord[]): ChainEntry[] {
  const chain: ChainEntry[] = []
  let prev = GENESIS
  records.forEach((r, i) => {
    const hash = hashRecord(prev, r)
    chain.push({ index: i, hash, prevHash: prev })
    prev = hash
  })
  return chain
}

export const chainHead = (chain: ChainEntry[]): string => (chain.length ? chain[chain.length - 1]!.hash : GENESIS)

/**
 * Verify a claimed chain against the records it should attest. Detects edits (hash mismatch),
 * insertion/deletion/reorder (prevHash or length mismatch). brokenAt is the first bad index.
 */
export function verifyChain(records: AuditRecord[], claimed: ChainEntry[]): VerifyResult {
  const recomputed = buildChain(records)
  const head = chainHead(recomputed)
  const n = Math.max(recomputed.length, claimed.length)
  for (let i = 0; i < n; i++) {
    const a = recomputed[i]
    const b = claimed[i]
    if (!a || !b || a.hash !== b.hash || a.prevHash !== b.prevHash) {
      return { valid: false, brokenAt: i, head, length: recomputed.length }
    }
  }
  return { valid: true, brokenAt: null, head, length: recomputed.length }
}

// ── Ed25519 attestation over the chain head ─────────────────────────────────

/** Generate a device audit keypair (Ed25519). The private key never leaves the device. */
export function generateAuditKeypair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519')
}

/** Sign the chain head with the device key → base64 signature (the attestation). */
export function signHead(headHash: string, privateKey: KeyObject): string {
  return edSign(null, Buffer.from(headHash, 'hex'), privateKey).toString('base64')
}

/** Verify the head signature against the device public key. Throw-safe → false on any bad input. */
export function verifyHead(headHash: string, signatureB64: string, publicKey: KeyObject): boolean {
  try { return edVerify(null, Buffer.from(headHash, 'hex'), publicKey, Buffer.from(signatureB64, 'base64')) } catch { return false }
}
