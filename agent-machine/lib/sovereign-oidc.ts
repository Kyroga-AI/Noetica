/**
 * sovereign-oidc — the issuance half of the broker. After the edge proves possession of a scope facet
 * (sovereign-broker.verify), the IdP mints a standard OIDC ID token so ANY off-the-shelf relying party
 * (Matrix/Synapse, ONLYOFFICE, mail/DAV via OIDC, the web shell) can consume our sovereign login with zero custom
 * code. The token's `sub` is the PAIRWISE pseudonym and `email` is the per-scope alias — so even a fully standard
 * OIDC client gets the unlinkable, correlation-defeating identity for free.
 *
 * EdDSA (Ed25519) JWS — modern, compact, supported by current OIDC stacks. The IdP signing key is separate from
 * every user root (the IdP can attest a login; it can never impersonate a user — only the edge holds the facet key).
 */
import * as crypto from "node:crypto";

export interface IdToken {
  iss: string;
  sub: string;          // pairwise pseudonym (from broker.verify) — different per app
  aud: string;          // client_id == scope
  email?: string;       // the per-scope alias — unlinkable across apps
  nonce?: string;
  iat: number;
  exp: number;
}

export interface SigningKey { kid: string; privateKey: crypto.KeyObject; publicKey: crypto.KeyObject }

const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (s: string): unknown => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
const nowSec = (): number => Math.floor(Date.now() / 1000);

/** The IdP's signing keypair. `kid` is a stable id derived from the public key for JWKS lookup. */
export function generateSigningKey(): SigningKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const kid = crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 16);
  return { kid, privateKey, publicKey };
}

/** Load the IdP signing key from a PEM private key (mounted secret in prod). DAO target: threshold/k-of-n. */
export function signingKeyFromPem(pem: string): SigningKey {
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey);
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const kid = crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 16);
  return { kid, privateKey, publicKey };
}

/** JWKS entry so relying parties can verify our tokens via standard discovery. */
export function jwks(key: SigningKey): { keys: Array<Record<string, string>> } {
  const x = (key.publicKey.export({ type: "spki", format: "der" }).subarray(-32) as Buffer).toString("base64url");
  return { keys: [{ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig", kid: key.kid, x }] };
}

/** Mint a signed OIDC ID token for a verified login. */
export function issueIdToken(
  key: SigningKey,
  claims: { iss: string; sub: string; aud: string; email?: string; nonce?: string; ttlSec?: number; iat?: number },
): string {
  const iat = claims.iat ?? nowSec();
  const payload: IdToken = {
    iss: claims.iss, sub: claims.sub, aud: claims.aud,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.nonce ? { nonce: claims.nonce } : {}),
    iat, exp: iat + (claims.ttlSec ?? 3600),
  };
  const header = { alg: "EdDSA", typ: "JWT", kid: key.kid };
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign(null, Buffer.from(signingInput), key.privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

/** Relying-party-side verification: signature + iss/aud + expiry. Returns the claims or null. */
export function verifyIdToken(
  publicKey: crypto.KeyObject,
  token: string,
  expect: { iss: string; aud: string; at?: number; nonce?: string; skewSec?: number },
): IdToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = dec(h) as { alg?: string; typ?: string };
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null; // pin the alg — never trust the token's choice
    if (!crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))) return null;
    const claims = dec(p) as IdToken;
    if (claims.iss !== expect.iss || claims.aud !== expect.aud) return null;
    const now = expect.at ?? nowSec();
    const skew = expect.skewSec ?? 120;
    if (now >= claims.exp) return null;
    if (claims.iat > now + skew) return null;                       // reject far-future iat
    if (expect.nonce != null && claims.nonce !== expect.nonce) return null; // enforce nonce when the RP supplied one
    return claims;
  } catch {
    return null;
  }
}

/** Reconstruct a verify key from a JWKS `x` value (relying parties verifying via discovery). */
export function publicKeyFromJwk(x: string): crypto.KeyObject {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(x, "base64url")]);
  return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
}
