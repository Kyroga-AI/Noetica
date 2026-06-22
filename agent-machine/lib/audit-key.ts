/**
 * audit-key — the device's audit identity. An Ed25519 keypair generated once and persisted under
 * ~/.noetica (private key 0600, never leaves the device). It signs the governance hash-chain head,
 * so an auditor can verify the attestation against this device's public key. Load-or-create:
 * stable across restarts, so the signature chain is continuous.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, createHash, type KeyObject } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const KEY_DIR = path.join(os.homedir(), '.noetica')
const PRIV_PATH = path.join(KEY_DIR, 'audit-key.pem')

export interface DeviceKey {
  publicKey: KeyObject
  privateKey: KeyObject
  fingerprint: string // short sha256 of the SPKI public key — the device's audit identity
  publicKeyPem: string
}

/** Short, human-displayable identity for the device public key. */
export function fingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

function pack(publicKey: KeyObject, privateKey: KeyObject): DeviceKey {
  return {
    publicKey,
    privateKey,
    fingerprint: fingerprint(publicKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Load the device audit key, generating + persisting (0600) on first use. */
export function loadOrCreateDeviceKey(): DeviceKey {
  try {
    const pem = fs.readFileSync(PRIV_PATH, 'utf8')
    const privateKey = createPrivateKey(pem)
    return pack(createPublicKey(privateKey), privateKey)
  } catch {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    try {
      fs.mkdirSync(KEY_DIR, { recursive: true })
      fs.writeFileSync(PRIV_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    } catch { /* best-effort persist — in-memory key still works for this session */ }
    return pack(publicKey, privateKey)
  }
}
