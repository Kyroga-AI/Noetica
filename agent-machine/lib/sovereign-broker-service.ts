/**
 * sovereign-broker-service — the cloud-side verifier + OIDC issuer. It is the relying-party-facing half of the
 * sovereign login and, critically, it holds ONLY PUBLIC MATERIAL: enrolled credentials (per-scope pubkey + alias),
 * pending challenges, and the IdP signing key. No user roots, no data keys, no plaintext. So even a fully compromised
 * or compelled broker can: forge a login token (caught downstream — the account is vault-sealed and unreadable), and
 * nothing else. It cannot decrypt data, link a user across scopes, or recover a root.
 *
 * Handlers are pure functions over injectable stores → testable in-process; a thin http layer mounts them.
 */
import { type CredentialRecord, type Assertion, verify, verifyCredential, newChallenge } from "./sovereign-broker.js";
import { type SigningKey, issueIdToken, jwks } from "./sovereign-oidc.js";

export interface BrokerStores {
  creds: Map<string, CredentialRecord>; // `${scope}|${pseudonym}` → enrolled credential
  challenges: Map<string, string>;      // `${scope}|${pseudonym}` → the one-time challenge we issued
}
export interface BrokerConfig { iss: string; signingKey: SigningKey; ttlSec?: number }
export interface Reply { status: number; body: unknown }

const key = (scope: string, pseudonym: string): string => `${scope}|${pseudonym}`;
const ok = (body: unknown): Reply => ({ status: 200, body });
const err = (status: number, msg: string): Reply => ({ status, body: { error: msg } });

export function createBroker(config: BrokerConfig, stores?: Partial<BrokerStores>) {
  const s: BrokerStores = { creds: stores?.creds ?? new Map(), challenges: stores?.challenges ?? new Map() };

  return {
    stores: s,

    /** Edge enrolls a credential it computed locally (no root crosses the wire). Must be self-signed; no takeover. */
    enroll(cred: CredentialRecord): Reply {
      if (!cred?.scope_ref || !cred.pseudonym || !cred.public_key) return err(400, "invalid credential");
      if (!verifyCredential(cred)) return err(401, "credential self-signature invalid"); // can't enroll a key you don't hold
      const k = key(cred.scope_ref, cred.pseudonym);
      const existing = s.creds.get(k);
      if (existing && existing.public_key !== cred.public_key) return err(409, "credential exists; rotation must be signed by the current key");
      s.creds.set(k, cred);
      return ok({ enrolled: true, sub: cred.pseudonym });
    },

    /** Issue a fresh one-time challenge for a known credential. */
    challenge(scope: string, pseudonym: string): Reply {
      if (!s.creds.has(key(scope, pseudonym))) return err(404, "unknown credential");
      const ch = newChallenge();
      s.challenges.set(key(scope, pseudonym), ch);
      return ok({ challenge: ch });
    },

    /** Verify the edge's assertion and, on success, mint a standard OIDC ID token. Challenge is one-time. */
    verifyAssertion(a: Assertion): Reply {
      const k = key(a?.scope_ref, a?.pseudonym);
      const cred = s.creds.get(k);
      if (!cred) return err(401, "unknown credential");
      const expected = s.challenges.get(k);
      if (!expected) return err(400, "no pending challenge");
      s.challenges.delete(k); // one-time: prevents replay
      const res = verify(cred, a, expected);
      if (!res.ok) return err(401, "verification failed");
      const token = issueIdToken(config.signingKey, {
        iss: config.iss, sub: res.subject!, aud: a.scope_ref, email: cred.alias_email, ttlSec: config.ttlSec,
      });
      return ok({ id_token: token, token_type: "Bearer", sub: res.subject });
    },

    /** Standard discovery so any OIDC relying party can verify our tokens. */
    jwksDoc(): Reply { return ok(jwks(config.signingKey)); },
    discovery(): Reply {
      return ok({
        issuer: config.iss,
        jwks_uri: `${config.iss}/.well-known/jwks.json`,
        id_token_signing_alg_values_supported: ["EdDSA"],
        subject_types_supported: ["pairwise"],
        response_types_supported: ["id_token"],
      });
    },
  };
}
