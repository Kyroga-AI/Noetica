import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { canonical } from './audit-chain.js'
import { loadOrCreateDeviceKey } from './audit-key.js'

const execFileAsync = promisify(execFile)

export interface PlatformFingerprint {
  os: string
  arch: string
  kernel: string
  cpuModel: string
  memoryGb: number
  machineId: string
}

export interface AttestationClaims {
  deviceKeyFingerprint: string
  platform: PlatformFingerprint
  binaryHash: string
  tpm2PcrQuote?: string
  timestamp: number
  nonce: string
}

export interface AttestationToken {
  claims: AttestationClaims
  signature: string
  publicKeyPem: string
}

export async function getPlatformFingerprint(): Promise<PlatformFingerprint> {
  const machineId = await resolveMachineId()

  return {
    os: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpuModel: os.cpus()[0]?.model?.trim() ?? 'unknown',
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    machineId,
  }
}

async function resolveMachineId(): Promise<string> {
  // 1. Linux: /etc/machine-id
  if (process.platform === 'linux') {
    try {
      return fs.readFileSync('/etc/machine-id', 'utf8').trim()
    } catch {
      // fall through
    }
  }

  // 2. macOS: ioreg IOPlatformUUID
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        timeout: 5000,
      })
      const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (match && match[1]) {
        return match[1].trim()
      }
    } catch {
      // fall through
    }
  }

  // 3. Fallback: sha256(hostname + first MAC address)
  const hostname = os.hostname()
  const networkInterfaces = os.networkInterfaces()
  let firstMac = ''
  outer: for (const ifaces of Object.values(networkInterfaces)) {
    if (!ifaces) continue
    for (const iface of ifaces) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        firstMac = iface.mac
        break outer
      }
    }
  }
  return crypto
    .createHash('sha256')
    .update(hostname + firstMac)
    .digest('hex')
    .slice(0, 32)
}

export async function tryTpm2PcrQuote(nonce: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'tpm2_quote',
      [
        '--key-context', `${os.tmpdir()}/noetica-ak-${process.getuid?.() ?? 'default'}.ctx`,
        '--pcr-list', 'sha256:0,1,2,7',
        '--qualification', nonce,
      ],
      { timeout: 5000 }
    )
    return Buffer.from(stdout).toString('base64url')
  } catch {
    return null
  }
}

export async function attest(nonce: string): Promise<AttestationToken> {
  const deviceKey = loadOrCreateDeviceKey()
  const platform = await getPlatformFingerprint()
  const tpm2PcrQuote = await tryTpm2PcrQuote(nonce) ?? undefined

  let binaryHash: string
  try {
    const binary = fs.readFileSync(process.execPath)
    binaryHash = crypto.createHash('sha256').update(binary).digest('hex')
  } catch {
    binaryHash = 'dev'
  }

  const claims: AttestationClaims = {
    deviceKeyFingerprint: deviceKey.fingerprint,
    platform,
    binaryHash,
    ...(tpm2PcrQuote !== undefined ? { tpm2PcrQuote } : {}),
    timestamp: Date.now(),
    nonce,
  }

  const payload = Buffer.from(canonical(claims), 'utf8')
  const sig = crypto.sign(null, payload, deviceKey.privateKey)

  return {
    claims,
    signature: sig.toString('base64url'),
    publicKeyPem: deviceKey.publicKeyPem,
  }
}

export function verifyAttestation(
  token: AttestationToken,
  opts: { maxAgeMs?: number; expectedNonce?: string } = {}
): { valid: boolean; reason?: string } {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000

  let publicKey: crypto.KeyObject
  try {
    publicKey = crypto.createPublicKey(token.publicKeyPem)
  } catch {
    return { valid: false, reason: 'invalid public key PEM' }
  }

  const payload = Buffer.from(canonical(token.claims), 'utf8')
  let sigBuf: Buffer
  try {
    sigBuf = Buffer.from(token.signature, 'base64url')
  } catch {
    return { valid: false, reason: 'invalid signature encoding' }
  }

  let sigOk: boolean
  try {
    sigOk = crypto.verify(null, payload, publicKey, sigBuf)
  } catch {
    sigOk = false
  }

  if (!sigOk) {
    return { valid: false, reason: 'signature verification failed' }
  }

  const age = Date.now() - token.claims.timestamp
  if (age < 0 || age >= maxAgeMs) {
    return { valid: false, reason: `token age ${age}ms exceeds maxAgeMs ${maxAgeMs}` }
  }

  if (opts.expectedNonce !== undefined && token.claims.nonce !== opts.expectedNonce) {
    return { valid: false, reason: 'nonce mismatch' }
  }

  return { valid: true }
}

export function fogTrustTier(
  token: AttestationToken
): 'attested_fog' | 'managed_cloud' | 'unverified' {
  // Use a 24-hour window for tier classification — long enough to survive a session but
  // not infinite. A stolen token replayed after 24h is rejected here.
  const check = verifyAttestation(token, { maxAgeMs: 24 * 60 * 60 * 1000 })
  if (!check.valid) {
    return 'unverified'
  }

  const { machineId } = token.claims.platform
  const hasTpm2 = token.claims.tpm2PcrQuote !== undefined && token.claims.tpm2PcrQuote.length > 0

  // machineId is hostname-derived fallback if it looks like a 32-char hex string
  // (that's what we produce in the fallback path) and is NOT a /etc/machine-id or ioreg UUID.
  // /etc/machine-id values are 32 hex chars BUT we only fall back to sha256 on non-Linux or
  // when /etc/machine-id is unreadable, so distinguish by checking platform + tpm2 presence.
  const isFallbackMachineId = isHostnameDerivedMachineId(machineId, token.claims.platform.os)

  if (hasTpm2 || !isFallbackMachineId) {
    return 'attested_fog'
  }

  return 'managed_cloud'
}

function isHostnameDerivedMachineId(machineId: string, platform: string): boolean {
  // /etc/machine-id on Linux: 32 lowercase hex chars — same format as our fallback.
  // We can only tell them apart if the source was Linux (likely /etc/machine-id) or macOS ioreg
  // (a UUID with dashes, e.g. "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX").
  if (platform === 'darwin') {
    // ioreg UUIDs contain dashes; our fallback is pure hex (no dashes)
    return !/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/.test(
      machineId
    )
  }
  if (platform === 'linux') {
    // If we're on Linux and got a 32-char hex string, assume it IS /etc/machine-id (best effort)
    return false
  }
  // Other platforms: always treat as fallback
  return true
}
