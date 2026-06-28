/**
 * sovereign-id — the sovereign, anonymous-first identity broker core (see prophet-platform
 * apps/identity-prime/docs/SOVEREIGN_ANONYMOUS_IDENTITY.md).
 *
 * A user-held root seed (Ed25519-class, in ~/.noetica, keychain-upgradeable) derives a SEPARATE, cryptographically
 * UNLINKABLE facet per scope (relying party / external relationship) via HKDF. Each facet has its own deterministic
 * Ed25519 keypair (a did:key the party verifies) + a unique email alias — so:
 *   • external Ids (Google/corp/MDM) are auth factors bound to the root, never the exposed identity;
 *   • Senzing-style entity resolution gets ZERO shared attributes across scopes (distinct pseudonym + distinct
 *     alias, no shared name/phone/address) → it sees N unrelated entities, never one;
 *   • a facet never reveals the root, and two facets can't be linked without the root.
 *
 * This module is pure crypto + a root-seed loader; the IdP/relay/aliasing-to-mail wiring lives in the broker.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT_PATH = path.join(os.homedir(), ".noetica", "sovereign-root.key");
const SALT = Buffer.from("prophet-sovereign-id/v1");
// PKCS8 wrapper for a raw 32-byte Ed25519 seed → lets us build a DETERMINISTIC keypair from derived bytes.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const b64u = (b: Buffer): string => b.toString("base64url");
const hkdf = (root: Buffer, info: string, len = 32): Buffer =>
  Buffer.from(crypto.hkdfSync("sha256", root, SALT, Buffer.from(info), len));

export interface ScopeFacet {
  scopeId: string;
  /** Public, stable-per-scope, unlinkable-across-scopes commitment (the did:key public part). */
  pseudonym: string;
  publicKeyRaw: Buffer;
  /** Sign as this facet only — the root and other facets cannot. */
  sign: (msg: Buffer | string) => Buffer;
}

/** Load the user-held root seed, generating a fresh 32-byte one (0600) on first use. Sovereign: never leaves. */
export function loadOrCreateRoot(): Buffer {
  try {
    return fs.readFileSync(ROOT_PATH);
  } catch {
    const seed = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(ROOT_PATH), { recursive: true });
    fs.writeFileSync(ROOT_PATH, seed, { mode: 0o600 });
    return seed;
  }
}

/** Derive the unlinkable facet for a scope. Deterministic per (root, scopeId); independent across scopes. */
export function deriveScope(root: Buffer, scopeId: string): ScopeFacet {
  const seed = hkdf(root, `scope/${scopeId}`);
  const priv = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const pubDer = crypto.createPublicKey(priv).export({ type: "spki", format: "der" });
  const publicKeyRaw = pubDer.subarray(pubDer.length - 32); // raw 32-byte Ed25519 public key
  return {
    scopeId,
    pseudonym: "did:key:z" + b64u(publicKeyRaw),
    publicKeyRaw,
    sign: (msg) => crypto.sign(null, Buffer.isBuffer(msg) ? msg : Buffer.from(msg), priv),
  };
}

/** Verify a signature against a facet's public key (independent per scope). */
export function verifyFacet(publicKeyRaw: Buffer, msg: Buffer | string, sig: Buffer): boolean {
  try {
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyRaw]);
    const pub = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.isBuffer(msg) ? msg : Buffer.from(msg), pub, sig);
  } catch {
    return false;
  }
}

/** Per-scope email alias — unique per scope, so no shared email crosses scopes (the Senzing defeat). */
export function scopeAlias(root: Buffer, scopeId: string, domain: string): string {
  const tag = hkdf(root, `alias/${scopeId}`, 8).toString("hex"); // 16 hex chars
  return `${tag}@${domain}`;
}

/** IdentitySubjectContext (matches the platform contract): the scoped facet a relying party receives — never the
 *  root, never a cross-scope-shared attribute. `assurance` rises with the bound external proof. */
export interface IdentitySubjectContext {
  scope_ref: string;
  pseudonymous_subject_commitment: string;
  alias_email: string;
  assurance: "anonymous" | "proofed";
  external_factor?: string; // which external id raised assurance (label only — not correlatable)
}
export function buildSubjectContext(root: Buffer, scopeId: string, domain: string, externalFactor?: string): IdentitySubjectContext {
  const facet = deriveScope(root, scopeId);
  return {
    scope_ref: scopeId,
    pseudonymous_subject_commitment: facet.pseudonym,
    alias_email: scopeAlias(root, scopeId, domain),
    assurance: externalFactor ? "proofed" : "anonymous",
    ...(externalFactor ? { external_factor: externalFactor } : {}),
  };
}
