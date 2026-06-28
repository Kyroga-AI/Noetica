/**
 * sovereign-vault — the compulsion-resistance core: user data is sealed under keys DERIVED FROM THE USER-HELD ROOT,
 * which never leaves the edge. The service stores only ciphertext + public verification material. There is no
 * operator-held key that decrypts user data or unlocks an account — so SocioProphet (or a DAO running the service)
 * literally CANNOT comply with a demand to reveal confidential info or unlock an account: the access does not exist.
 * "Can't be evil," not "won't."
 *
 * Pairs with sovereign-id (identity facets) and sovereign-broker/oidc (auth): auth can at most grant entry to an
 * account that contains only ciphertext the holder can't read. Confidentiality is independent of, and survives, any
 * auth forgery or legal compulsion against the operator.
 */
import * as crypto from "node:crypto";

const SALT = Buffer.from("prophet-sovereign-id/v1");

/** Per-scope symmetric data key, derived from the root. No root ⇒ no key ⇒ no plaintext. Deterministic per (root,scope). */
export function deriveDataKey(root: Buffer, scopeId: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", root, SALT, Buffer.from(`data/${scopeId}`), 32));
}

/** AES-256-GCM seal. Output: base64url(iv ‖ tag ‖ ciphertext). Optional AAD binds context (e.g. scope/record id). */
export function seal(key: Buffer, plaintext: string | Buffer, aad?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** Open a sealed blob. Throws on wrong key or tamper (GCM auth). */
export function open(key: Buffer, blob: string, aad?: string): Buffer {
  const buf = Buffer.from(blob, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Convenience: seal/open a scope's data straight from the root (edge-side only — root required). */
export function sealForScope(root: Buffer, scopeId: string, plaintext: string | Buffer): string {
  return seal(deriveDataKey(root, scopeId), plaintext, scopeId);
}
export function openForScope(root: Buffer, scopeId: string, blob: string): Buffer {
  return open(deriveDataKey(root, scopeId), blob, scopeId);
}
