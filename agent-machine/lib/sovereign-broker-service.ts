/**
 * sovereign-broker-service — cloud-side verifier + OIDC issuer. Holds ONLY public material:
 * enrolled credentials (per-scope pubkey), pending challenges, and the IdP signing key.
 * A compromised broker can forge login tokens (useless — accounts are vault-sealed) and nothing else.
 *
 * Auth-code flow added so any standard OIDC relying party (Gitea, Matrix, etc.) can use sovereign SSO.
 */
import { createHash, createPublicKey, verify as cryptoVerify, randomBytes } from "node:crypto";
import { type CredentialRecord, type Assertion, verify, verifyCredential, newChallenge } from "./sovereign-broker.js";
import { type SigningKey, issueIdToken, jwks } from "./sovereign-oidc.js";

export interface ClientConfig { redirectUris: string[]; secret?: string }

export interface BrokerStores {
  creds: Map<string, CredentialRecord>;        // `${scope}|${pseudonym}` → credential
  challenges: Map<string, string>;             // `${scope}|${pseudonym}` → one-time challenge
  codes: Map<string, AuthCodeRecord>;          // code → auth code record
  pendingAuths: Map<string, PendingAuthState>; // authNonce → authorize session
}

interface AuthCodeRecord {
  sub: string;
  aud: string;
  scope: string;
  nonce?: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  alias_email?: string;
  expires: number; // epoch ms
}

interface PendingAuthState {
  challenge: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  expires: number;
}

export interface BrokerConfig {
  iss: string;
  signingKey: SigningKey;
  ttlSec?: number;
  clients?: Record<string, ClientConfig>;  // registered OIDC clients
  allowAllRedirectUris?: boolean;          // dev-only: skip redirect_uri validation
}

export interface Reply { status: number; body: unknown }

const credKey = (scope: string, pseudonym: string): string => `${scope}|${pseudonym}`;
const ok = (body: unknown): Reply => ({ status: 200, body });
const err = (status: number, msg: string): Reply => ({ status, body: { error: msg } });

// Base64url → Buffer
const b64dec = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Verify Ed25519 signature from browser (raw 32-byte pubkey + 64-byte sig, both base64url-encoded).
// Wraps the raw public key in SPKI (SubjectPublicKeyInfo, RFC 8410) so Node.js crypto.verify() can consume it.
function verifyEd25519(pubKeyB64url: string, payload: string, signatureB64url: string): boolean {
  try {
    const pubRaw = b64dec(pubKeyB64url);
    const sig = b64dec(signatureB64url);
    // SPKI header for Ed25519 (OID 1.3.101.112): 30 2a 30 05 06 03 2b 65 70 03 21 00
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pubRaw]);
    const pubKey = createPublicKey({ key: spki, format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(payload, "utf8"), pubKey, sig);
  } catch { return false; }
}

function verifySHA256PKCE(verifier: string, challenge: string): boolean {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("malformed token");
  return JSON.parse(b64dec(part).toString("utf8")) as Record<string, unknown>;
}

export function createBroker(config: BrokerConfig, stores?: Partial<BrokerStores>) {
  const s: BrokerStores = {
    creds: stores?.creds ?? new Map(),
    challenges: stores?.challenges ?? new Map(),
    codes: stores?.codes ?? new Map(),
    pendingAuths: stores?.pendingAuths ?? new Map(),
  };
  const ttlSec = config.ttlSec ?? 3600;

  const isRedirectUriAllowed = (clientId: string, redirectUri: string): boolean => {
    if (config.allowAllRedirectUris) return true;
    const client = config.clients?.[clientId];
    return client?.redirectUris.includes(redirectUri) ?? false;
  };

  return {
    stores: s,

    /** Edge enrolls a credential it computed locally (no root crosses the wire). */
    enroll(cred: CredentialRecord): Reply {
      if (!cred?.scope_ref || !cred.pseudonym || !cred.public_key) return err(400, "invalid credential");
      if (!verifyCredential(cred)) return err(401, "credential self-signature invalid");
      const k = credKey(cred.scope_ref, cred.pseudonym);
      const existing = s.creds.get(k);
      if (existing && existing.public_key !== cred.public_key) return err(409, "credential exists; rotation must be signed by the current key");
      s.creds.set(k, cred);
      return ok({ enrolled: true, sub: cred.pseudonym });
    },

    /** Issue a fresh one-time challenge for a known credential. */
    challenge(scope: string, pseudonym: string): Reply {
      if (!s.creds.has(credKey(scope, pseudonym))) return err(404, "unknown credential");
      const ch = newChallenge();
      s.challenges.set(credKey(scope, pseudonym), ch);
      return ok({ challenge: ch });
    },

    /** Verify the edge's assertion and mint a standard OIDC ID token. Challenge is one-time. */
    verifyAssertion(a: Assertion): Reply {
      const k = credKey(a?.scope_ref, a?.pseudonym);
      const cred = s.creds.get(k);
      if (!cred) return err(401, "unknown credential");
      const expected = s.challenges.get(k);
      if (!expected) return err(400, "no pending challenge");
      s.challenges.delete(k);
      const res = verify(cred, a, expected);
      if (!res.ok) return err(401, "verification failed");
      const token = issueIdToken(config.signingKey, {
        iss: config.iss, sub: res.subject!, aud: a.scope_ref, email: cred.alias_email, ttlSec,
      });
      return ok({ id_token: token, token_type: "Bearer", sub: res.subject });
    },

    /**
     * OIDC authorization-code flow, step 1: validate client + redirect_uri, generate a challenge
     * the browser must sign. Returns { challenge, auth_nonce } embedded in the login page.
     */
    authorizeStart(params: {
      client_id: string; redirect_uri: string; scope: string;
      state?: string; nonce?: string; code_challenge?: string; code_challenge_method?: string;
    }): Reply {
      if (!params.client_id) return err(400, "client_id required");
      if (!params.redirect_uri) return err(400, "redirect_uri required");
      if (!isRedirectUriAllowed(params.client_id, params.redirect_uri))
        return err(400, "redirect_uri not registered for this client");
      const challenge = newChallenge();
      const authNonce = randomBytes(24).toString("base64url");
      s.pendingAuths.set(authNonce, {
        challenge,
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: params.scope ?? "openid",
        state: params.state,
        nonce: params.nonce,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        expires: Date.now() + 10 * 60 * 1000, // 10-minute login window
      });
      return ok({ challenge, auth_nonce: authNonce });
    },

    /**
     * OIDC authorization-code flow, step 2: verify browser assertion, TOFU-enroll if new,
     * issue auth code, return redirect URL for the browser to follow.
     */
    authorizeComplete(params: {
      auth_nonce: string; pseudonym: string; public_key: string;
      signature: string; alias_email?: string;
    }): Reply {
      const pending = s.pendingAuths.get(params.auth_nonce);
      if (!pending) return err(400, "unknown or expired authorization session");
      if (pending.expires < Date.now()) {
        s.pendingAuths.delete(params.auth_nonce);
        return err(400, "authorization session expired");
      }
      if (!params.pseudonym || !params.public_key || !params.signature)
        return err(400, "pseudonym, public_key, and signature required");

      // Payload signed by the browser: challenge:authNonce
      if (!verifyEd25519(params.public_key, `${pending.challenge}:${params.auth_nonce}`, params.signature))
        return err(401, "signature verification failed");

      // Trust-on-first-use enrollment: register key on first login
      const k = credKey(pending.client_id, params.pseudonym);
      const existing = s.creds.get(k);
      if (existing && existing.public_key !== params.public_key)
        return err(401, "pseudonym already registered to a different key");
      if (!existing) {
        s.creds.set(k, {
          scope_ref: pending.client_id,
          pseudonym: params.pseudonym,
          public_key: params.public_key,
          alias_email: params.alias_email,
        } as CredentialRecord);
      }

      const code = randomBytes(32).toString("base64url");
      s.codes.set(code, {
        sub: params.pseudonym,
        aud: pending.client_id,
        scope: pending.scope,
        nonce: pending.nonce,
        redirect_uri: pending.redirect_uri,
        code_challenge: pending.code_challenge,
        code_challenge_method: pending.code_challenge_method,
        alias_email: params.alias_email ?? existing?.alias_email,
        expires: Date.now() + 2 * 60 * 1000, // OIDC spec: 2-minute code lifetime
      });
      s.pendingAuths.delete(params.auth_nonce);

      const redirectUrl = new URL(pending.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (pending.state) redirectUrl.searchParams.set("state", pending.state);
      return ok({ redirect: redirectUrl.toString() });
    },

    /** OIDC token endpoint: exchange auth code for access_token + id_token. */
    exchangeCode(params: {
      code: string; client_id: string; redirect_uri: string;
      code_verifier?: string; client_secret?: string;
    }): Reply {
      const rec = s.codes.get(params.code);
      if (!rec || rec.expires < Date.now()) {
        s.codes.delete(params.code);
        return err(400, "invalid_grant");
      }
      if (rec.aud !== params.client_id) return err(400, "invalid_grant");
      if (rec.redirect_uri !== params.redirect_uri) return err(400, "redirect_uri mismatch");

      // PKCE S256
      if (rec.code_challenge && rec.code_challenge_method === "S256") {
        if (!params.code_verifier || !verifySHA256PKCE(params.code_verifier, rec.code_challenge))
          return err(400, "invalid_grant: code_verifier mismatch");
      }

      // Client secret check (if client has one configured)
      const client = config.clients?.[params.client_id];
      if (client?.secret && params.client_secret !== client.secret)
        return err(401, "client authentication failed");

      s.codes.delete(params.code); // one-time
      const token = issueIdToken(config.signingKey, {
        iss: config.iss, sub: rec.sub, aud: rec.aud, email: rec.alias_email, ttlSec,
      });
      return ok({
        access_token: token,
        id_token: token,
        token_type: "Bearer",
        expires_in: ttlSec,
        scope: rec.scope,
      });
    },

    /** OIDC userinfo endpoint: decode Bearer token and return standard claims. */
    userInfo(bearerToken: string): Reply {
      try {
        const claims = decodeJwtPayload(bearerToken);
        if (!claims["sub"]) return err(401, "invalid token");
        return ok({
          sub: claims["sub"],
          ...(claims["email"] ? { email: claims["email"] } : {}),
        });
      } catch { return err(401, "invalid token"); }
    },

    jwksDoc(): Reply { return ok(jwks(config.signingKey)); },

    discovery(): Reply {
      return ok({
        issuer: config.iss,
        authorization_endpoint: `${config.iss}/authorize`,
        token_endpoint: `${config.iss}/token`,
        userinfo_endpoint: `${config.iss}/userinfo`,
        jwks_uri: `${config.iss}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["EdDSA"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "email", "profile"],
        claims_supported: ["sub", "iss", "aud", "exp", "iat", "nonce", "email"],
      });
    },
  };
}
