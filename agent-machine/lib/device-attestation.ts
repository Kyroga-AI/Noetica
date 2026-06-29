/**
 * Device attestation for the SOVEREIGN reasoning lane.
 *
 * Ported from the openclaw device-auth pattern in SocioProphet/promptfoo:
 * - Ed25519 keypair persisted at mode 0o600
 * - deviceId = sha256 hex of raw public key bytes
 * - Attestation = signed `${deviceId}:${timestamp}` pipe token
 * - Verification checks signature + timestamp freshness (±5 min)
 *
 * No external deps — node:crypto only.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_KEY_DIR = path.join(os.homedir(), '.noetica', 'device')
const FRESHNESS_MS = 5 * 60 * 1000 // ±5 minutes

export interface DeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
}

export interface DeviceAttestation {
  deviceId: string
  publicKeyPem: string
  timestamp: string   // ISO-8601
  signature: string   // base64url — signs `${deviceId}:${timestamp}`
}

export interface AttestationResult {
  valid: boolean
  deviceId: string
  reason?: string
}

function deriveDeviceId(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer
  return crypto.createHash('sha256').update(der).digest('hex')
}

function writeSecure(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, data, { encoding: 'utf8', mode: 0o600 })
  fs.chmodSync(filePath, 0o600)
}

export function loadOrCreateDeviceIdentity(keyDir: string = DEFAULT_KEY_DIR): DeviceIdentity {
  const identityPath = path.join(keyDir, 'device-identity.json')
  try {
    if (fs.existsSync(identityPath)) {
      const parsed = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
      if (
        typeof parsed.deviceId === 'string' &&
        typeof parsed.publicKeyPem === 'string' &&
        typeof parsed.privateKeyPem === 'string' &&
        parsed.deviceId === deriveDeviceId(parsed.publicKeyPem)
      ) {
        return parsed as DeviceIdentity
      }
    }
  } catch {
    // fall through to generate a new identity
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const identity: DeviceIdentity = {
    deviceId: deriveDeviceId(publicKey),
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  }
  try {
    writeSecure(identityPath, JSON.stringify(identity, null, 2) + '\n')
  } catch {
    // non-fatal — identity still returned for this session
  }
  return identity
}

export function createAttestation(keyDir: string = DEFAULT_KEY_DIR): DeviceAttestation {
  const identity = loadOrCreateDeviceIdentity(keyDir)
  const timestamp = new Date().toISOString()
  const payload = Buffer.from(`${identity.deviceId}:${timestamp}`)
  const signature = crypto.sign(null, payload, identity.privateKeyPem).toString('base64url')
  return { deviceId: identity.deviceId, publicKeyPem: identity.publicKeyPem, timestamp, signature }
}

export function verifyAttestation(attestation: DeviceAttestation): AttestationResult {
  const { deviceId, publicKeyPem, timestamp, signature } = attestation

  // Check timestamp freshness
  const age = Math.abs(Date.now() - Date.parse(timestamp))
  if (isNaN(age) || age > FRESHNESS_MS) {
    return { valid: false, deviceId, reason: `attestation timestamp out of window (age=${age}ms)` }
  }

  // Check deviceId matches public key
  let expectedId: string
  try {
    expectedId = deriveDeviceId(publicKeyPem)
  } catch {
    return { valid: false, deviceId, reason: 'invalid public key PEM' }
  }
  if (expectedId !== deviceId) {
    return { valid: false, deviceId, reason: 'deviceId does not match public key' }
  }

  // Verify signature
  try {
    const payload = Buffer.from(`${deviceId}:${timestamp}`)
    const sigBuf = Buffer.from(signature, 'base64url')
    const ok = crypto.verify(null, payload, publicKeyPem, sigBuf)
    if (!ok) return { valid: false, deviceId, reason: 'signature verification failed' }
  } catch {
    return { valid: false, deviceId, reason: 'signature verification threw' }
  }

  return { valid: true, deviceId }
}
