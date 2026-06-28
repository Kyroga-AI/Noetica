/**
 * sovereign-broker — the auth handshake that makes the anonymous-first identity real end-to-end.
 *
 * Design (the part nobody else does): the SOVEREIGN ROOT NEVER LEAVES THE EDGE. The edge (noetica, holding the root
 * seed) is the *authenticator* — passkey/WebAuthn-style; the cloud IdP (Zitadel/Authentik) is only a *verifier*. For
 * each scope (relying party / app) the edge enrolls a per-scope facet public key + a unique alias; to log in it
 * signs the IdP's challenge with that facet's key. The IdP learns a pairwise pseudonym + a signature — never the
 * root, never a cross-scope-shared attribute. So:
 *   • the cloud cannot impersonate the user (it has no private key);
 *   • a credential for app A can't be used at app B (signature binds scope);
 *   • two apps' subjects can't be linked without the root (independent facet keys);
 *   • the OIDC `sub` we hand each app is already pairwise — compartmentalized by default.
 *
 * This is WebAuthn's per-RP-credential model, but every credential is DERIVED from one user-held root (so it's
 * portable + recoverable from a single seed) and carries the unlinkable alias + governance hooks.
 */
import * as crypto from "node:crypto";
import { deriveScope, verifyFacet, scopeAlias } from "./sovereign-id.js";

/** What the IdP stores at enrollment for a (user, scope). No root, no shared attribute — safe to persist in the cloud. */
export interface CredentialRecord {
  scope_ref: string;
  pseudonym: string;       // the did:key — also the OIDC `sub` (pairwise per app)
  public_key: string;      // base64url raw Ed25519 public key (the verifier needs this)
  alias_email: string;     // unique per scope
}

/** What the edge sends to log in: proof it holds the facet key, bound to the IdP's challenge AND the scope. */
export interface Assertion {
  scope_ref: string;
  pseudonym: string;
  challenge: string;
  signature: string;       // base64url, over `${scope_ref}\n${challenge}`
}

const b64u = (b: Buffer): string => b.toString("base64url");
const payload = (scope: string, challenge: string): string => `${scope}\n${challenge}`;

/** IdP-side: a fresh single-use challenge nonce to send the edge. */
export function newChallenge(): string {
  return b64u(crypto.randomBytes(32));
}

/** Edge-side, at enrollment: produce the credential the IdP will store for this scope. Root stays local. */
export function register(root: Buffer, scopeId: string, domain: string): CredentialRecord {
  const facet = deriveScope(root, scopeId);
  return {
    scope_ref: scopeId,
    pseudonym: facet.pseudonym,
    public_key: b64u(facet.publicKeyRaw),
    alias_email: scopeAlias(root, scopeId, domain),
  };
}

/** Edge-side, at login: sign the IdP's challenge as this scope's facet (binds scope to prevent cross-RP replay). */
export function assert(root: Buffer, scopeId: string, challenge: string): Assertion {
  const facet = deriveScope(root, scopeId);
  return {
    scope_ref: scopeId,
    pseudonym: facet.pseudonym,
    challenge,
    signature: b64u(facet.sign(payload(scopeId, challenge))),
  };
}

/** IdP-side: verify an assertion against the stored credential + the challenge WE issued. Returns the OIDC subject. */
export function verify(record: CredentialRecord, assertion: Assertion, expectedChallenge: string): { ok: boolean; subject?: string } {
  // scope + pseudonym must match the enrolled credential, and the challenge must be the one we issued (anti-replay)
  if (assertion.scope_ref !== record.scope_ref) return { ok: false };
  if (assertion.pseudonym !== record.pseudonym) return { ok: false };
  if (assertion.challenge !== expectedChallenge) return { ok: false };
  const pub = Buffer.from(record.public_key, "base64url");
  const sig = Buffer.from(assertion.signature, "base64url");
  if (!verifyFacet(pub, payload(record.scope_ref, expectedChallenge), sig)) return { ok: false };
  return { ok: true, subject: record.pseudonym }; // pairwise per app — compartmentalized by default
}
