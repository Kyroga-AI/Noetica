import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPlatformFingerprint,
  attest,
  verifyAttestation,
  fogTrustTier,
  tryTpm2PcrQuote,
} from './device-attest.js'

describe('getPlatformFingerprint', () => {
  it('returns os, arch, kernel, memoryGb', async () => {
    const fp = await getPlatformFingerprint()
    assert.ok(typeof fp.os === 'string' && fp.os.length > 0, 'os must be a non-empty string')
    assert.ok(typeof fp.arch === 'string' && fp.arch.length > 0, 'arch must be a non-empty string')
    assert.ok(typeof fp.kernel === 'string' && fp.kernel.length > 0, 'kernel must be a non-empty string')
    assert.ok(typeof fp.memoryGb === 'number' && fp.memoryGb > 0, 'memoryGb must be a positive number')
    assert.ok(typeof fp.cpuModel === 'string', 'cpuModel must be a string')
    assert.ok(typeof fp.machineId === 'string' && fp.machineId.length > 0, 'machineId must be a non-empty string')
  })
})

describe('attest + verifyAttestation', () => {
  it('round-trips successfully', async () => {
    const token = await attest('test-nonce')
    const result = verifyAttestation(token, { expectedNonce: 'test-nonce' })
    assert.equal(result.valid, true)
  })

  it('rejects tampered claims', async () => {
    const token = await attest('test-nonce')
    // Mutate the timestamp after signing — signature will no longer match
    token.claims.timestamp = 0
    const result = verifyAttestation(token, { expectedNonce: 'test-nonce' })
    assert.equal(result.valid, false)
    assert.ok(result.reason !== undefined, 'should include a reason')
  })

  it('rejects expired token', async () => {
    const token = await attest('test-nonce')
    // maxAgeMs: 0 means any token is already expired
    const result = verifyAttestation(token, { maxAgeMs: 0 })
    assert.equal(result.valid, false)
    assert.ok(result.reason !== undefined, 'should include a reason')
  })

  it('rejects wrong nonce', async () => {
    const token = await attest('nonce-A')
    const result = verifyAttestation(token, { expectedNonce: 'nonce-B' })
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'nonce mismatch')
  })
})

describe('fogTrustTier', () => {
  it('returns valid tier string', async () => {
    const token = await attest('tier-nonce')
    const tier = fogTrustTier(token)
    const validTiers = ['attested_fog', 'managed_cloud', 'unverified']
    assert.ok(
      validTiers.includes(tier),
      `tier "${tier}" must be one of ${validTiers.join(' | ')}`
    )
  })
})

describe('tryTpm2PcrQuote', () => {
  it('returns null gracefully when tpm2_quote is not installed', async () => {
    const result = await tryTpm2PcrQuote('test-nonce')
    // On machines without tpm2-tools installed the function must not throw and must return null
    assert.equal(result, null)
  })
})
