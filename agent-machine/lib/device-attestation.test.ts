import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadOrCreateDeviceIdentity,
  createAttestation,
  verifyAttestation,
} from './device-attestation.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'noetica-device-attest-'))
}

test('generates a keypair on first call', () => {
  const dir = tmpDir()
  try {
    const identity = loadOrCreateDeviceIdentity(dir)
    assert.equal(typeof identity.deviceId, 'string')
    assert.ok(identity.deviceId.length === 64, 'deviceId should be 64-char hex sha256')
    assert.ok(identity.publicKeyPem.includes('PUBLIC KEY'))
    assert.ok(identity.privateKeyPem.includes('PRIVATE KEY'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loads the same identity on second call', () => {
  const dir = tmpDir()
  try {
    const a = loadOrCreateDeviceIdentity(dir)
    const b = loadOrCreateDeviceIdentity(dir)
    assert.equal(a.deviceId, b.deviceId)
    assert.equal(a.publicKeyPem, b.publicKeyPem)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('creates a valid attestation', () => {
  const dir = tmpDir()
  try {
    const att = createAttestation(dir)
    assert.equal(typeof att.deviceId, 'string')
    assert.equal(typeof att.timestamp, 'string')
    assert.equal(typeof att.signature, 'string')
    assert.ok(att.signature.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('verifies a fresh attestation', () => {
  const dir = tmpDir()
  try {
    const att = createAttestation(dir)
    const result = verifyAttestation(att)
    assert.equal(result.valid, true, result.reason)
    assert.equal(result.deviceId, att.deviceId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects a tampered signature', () => {
  const dir = tmpDir()
  try {
    const att = createAttestation(dir)
    const tampered = { ...att, signature: att.signature.slice(0, -4) + 'XXXX' }
    const result = verifyAttestation(tampered)
    assert.equal(result.valid, false)
    assert.ok(result.reason)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects a stale attestation (10 min ago)', () => {
  const dir = tmpDir()
  try {
    const att = createAttestation(dir)
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const stale = { ...att, timestamp: staleTimestamp }
    const result = verifyAttestation(stale)
    assert.equal(result.valid, false)
    assert.ok(result.reason?.includes('window'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects when deviceId does not match public key', () => {
  const dir = tmpDir()
  try {
    const att = createAttestation(dir)
    const bad = { ...att, deviceId: 'a'.repeat(64) }
    const result = verifyAttestation(bad)
    assert.equal(result.valid, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
