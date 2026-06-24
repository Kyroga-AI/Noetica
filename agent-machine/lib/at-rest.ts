/**
 * at-rest.ts — encryption at rest for sovereign data files under ~/.noetica.
 *
 * Secrets (API keys, OAuth tokens) already live in the OS keychain, but the agent's DATA — what you asked, what
 * it learned, governance records — sat as plaintext JSONL. On a stolen/unlocked machine, local file read leaked
 * all of it. This wraps those append-only stores in AES-256-GCM, keyed from a 0600 device key (same posture as
 * audit-key.pem). Per-LINE encryption preserves append-only semantics; a `enc:v1:` magic prefix lets a reader
 * mix plaintext + ciphertext, so EXISTING plaintext files keep working and migrate lazily (new lines encrypted).
 *
 * Disable (debug / portability) with NOETICA_ENCRYPT_AT_REST=0 — reads still auto-detect either form.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const KEY_PATH = path.join(os.homedir(), '.noetica', 'at-rest.key')
const MAGIC = 'enc:v1:'
let _key: Buffer | null = null

/** Load-or-create the 32-byte at-rest key (0600, never leaves the device). Stable across restarts. */
function key(): Buffer {
  if (_key) return _key
  try { const b = fs.readFileSync(KEY_PATH); if (b.length === 32) { _key = b; return b } } catch { /* create below */ }
  const k = randomBytes(32)
  try { fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true }); fs.writeFileSync(KEY_PATH, k, { mode: 0o600 }) } catch { /* in-memory only if write fails */ }
  _key = k
  return k
}

// Binary magic prefix for encrypted blobs (raw bytes, not JSON lines). 8 bytes, distinct from real document
// headers (%PDF, PK\x03\x04, …) so legacy plaintext blobs are detected + passed through on read.
const BIN_MAGIC = Buffer.from('NoetEnc\x01', 'latin1')

/** Encrypt raw bytes at rest (for the content-addressed blob store). Layout: BIN_MAGIC | iv[12] | tag[16] | ct.
 * No-op (returns the input) when NOETICA_ENCRYPT_AT_REST=0 so blobs stay portable/plaintext. */
export function encryptBytes(buf: Buffer): Buffer {
  if (process.env['NOETICA_ENCRYPT_AT_REST'] === '0') return buf
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(buf), c.final()])
  return Buffer.concat([BIN_MAGIC, iv, c.getAuthTag(), ct])
}

/** Decrypt bytes from encryptBytes. A non-magic buffer is returned AS-IS (legacy plaintext blob → lazy
 * migration). Returns null only for a magic'd-but-tampered/wrong-key buffer (GCM auth fails). */
export function decryptBytes(buf: Buffer): Buffer | null {
  if (buf.length < BIN_MAGIC.length || !buf.subarray(0, BIN_MAGIC.length).equals(BIN_MAGIC)) return buf
  try {
    const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(8, 20))
    d.setAuthTag(buf.subarray(20, 36))
    return Buffer.concat([d.update(buf.subarray(36)), d.final()])
  } catch { return null }
}

/** Encrypt one record to a single self-describing line: `enc:v1:` + base64(iv[12] | tag[16] | ciphertext). */
export function encryptLine(obj: unknown): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()])
  return MAGIC + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

/** Decrypt a line from encryptLine. A non-MAGIC line is treated as plaintext JSON (lazy migration). Returns null
 * for blank lines, unparseable plaintext, or a tampered/wrong-key ciphertext (GCM auth fails). */
export function decryptLine(line: string): unknown | null {
  const t = line.trim()
  if (!t) return null
  if (!t.startsWith(MAGIC)) { try { return JSON.parse(t) } catch { return null } }
  try {
    const buf = Buffer.from(t.slice(MAGIC.length), 'base64')
    const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
    d.setAuthTag(buf.subarray(12, 28))
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'))
  } catch { return null }
}

const enabled = (): boolean => process.env['NOETICA_ENCRYPT_AT_REST'] !== '0'

/** Append a record to a JSONL store — encrypted at rest by default (NOETICA_ENCRYPT_AT_REST=0 to disable). */
export function appendJsonl(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${enabled() ? encryptLine(obj) : JSON.stringify(obj)}\n`)
}

/** Read a JSONL store, decrypting encrypted lines + passing plaintext through (mixed files OK during migration). */
export function readJsonl<T = unknown>(filePath: string): T[] {
  try { return fs.readFileSync(filePath, 'utf8').split('\n').map(decryptLine).filter((x): x is T => x !== null) }
  catch { return [] }
}

/** Whole-file JSON store, encrypted at rest by default. Read auto-detects plaintext (lazy migration). */
export function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, enabled() ? encryptLine(obj) : JSON.stringify(obj))
}
export function readJson<T = unknown>(filePath: string): T | null {
  try { return decryptLine(fs.readFileSync(filePath, 'utf8')) as T } catch { return null }
}
