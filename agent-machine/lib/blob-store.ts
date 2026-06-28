/**
 * blob-store — a content-addressed local store for RAW source bytes.
 *
 * HellGraph stores a document's TEXT + vectors + entities, but the original bytes
 * (the .pdf/.docx the user uploaded) are discarded after extraction — so you can never
 * re-OCR, re-extract, audit, or re-process the source. This is the missing "raw" surface:
 * a sha256-addressed blob dir under ~/.noetica/blobs, sharded, idempotent, local-first
 * (no pgsql, no cloud — the bytes never leave the machine). HellGraph stays the index;
 * a Document atom just carries the raw_hash pointing here.
 */

import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { encryptBytes, decryptBytes } from './at-rest.js'

// Resolved lazily so NOETICA_BLOB_DIR can be set at runtime (and tests can redirect it).
const blobDir = (): string => process.env['NOETICA_BLOB_DIR'] || join(homedir(), '.noetica', 'blobs')

export function blobPath(hash: string): string {
  return join(blobDir(), hash.slice(0, 2), hash)   // sharded by first byte to keep dirs small
}

export interface BlobRef { hash: string; size: number; stored: boolean }

/** Cap a single blob so untrusted content can't fill the disk (the one real risk of storing it). */
const MAX_BLOB_BYTES = 64 * 1024 * 1024 // 64 MB — far above any extracted-document text

/** Store raw bytes; returns the content hash. Idempotent — identical content is a no-op. */
export function putBlob(data: Buffer | string): BlobRef {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  if (buf.length > MAX_BLOB_BYTES) throw new Error(`blob exceeds ${MAX_BLOB_BYTES} bytes (${buf.length})`)
  const hash = createHash('sha256').update(buf).digest('hex')
  // Sanitize the path component: a sha256 hex digest is always exactly 64 chars of [0-9a-f], so
  // assert it — the blob path can then only ever be safe hex, never traversal.
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('invalid blob hash')
  const p = blobPath(hash)
  mkdirSync(dirname(p), { recursive: true })
  // Atomic create ('wx' fails if it exists) — no check-then-write race. Since the path IS the
  // content hash (of the PLAINTEXT), an existing file is the same content, so EEXIST means "already stored".
  // The bytes on disk are ENCRYPTED at rest (a stored PDF/docx is no longer plaintext); dedup + the raw_hash
  // pointer still work because the hash is over the plaintext. Read decrypts.
  try {
    writeFileSync(p, encryptBytes(buf), { flag: 'wx' })
    return { hash, size: buf.length, stored: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { hash, size: buf.length, stored: false }
    throw e
  }
}

/** Retrieve raw bytes by hash, or null if absent. Decrypts at-rest blobs; passes legacy plaintext through. */
export function getBlob(hash: string): Buffer | null {
  try { return decryptBytes(readFileSync(blobPath(hash))) } catch { return null }
}

export function hasBlob(hash: string): boolean { return existsSync(blobPath(hash)) }
