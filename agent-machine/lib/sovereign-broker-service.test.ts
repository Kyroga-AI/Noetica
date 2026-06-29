/** Proofs for the broker service: full enroll→challenge→verify→token flow, one-time challenges, unknown-credential
 *  rejection, and that the service holds only public material (no roots/secrets) — compulsion-safe by storage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createBroker } from "./sovereign-broker-service.js";
import { register, assert as makeAssertion } from "./sovereign-broker.js";
import { generateSigningKey, verifyIdToken } from "./sovereign-oidc.js";

const ISS = "https://id.socioprophet.ai";
const root = Buffer.alloc(32, 21);
const DOMAIN = "socioprophet.ai";
const cfg = () => ({ iss: ISS, signingKey: generateSigningKey() });

test("full login flow: enroll → challenge → assert → token → RP verifies", () => {
  const key = generateSigningKey();
  const b = createBroker({ iss: ISS, signingKey: key });
  const cred = register(root, "mail", DOMAIN);            // edge-side
  assert.equal(b.enroll(cred).status, 200);

  const chReply = b.challenge("mail", cred.pseudonym);
  const challenge = (chReply.body as { challenge: string }).challenge;
  const a = makeAssertion(root, "mail", challenge);        // edge signs

  const vr = b.verifyAssertion(a);
  assert.equal(vr.status, 200);
  const token = (vr.body as { id_token: string }).id_token;
  const claims = verifyIdToken(key.publicKey, token, { iss: ISS, aud: "mail" });
  assert.ok(claims && claims.sub === cred.pseudonym && claims.email === cred.alias_email);
});

test("one-time challenge: a replayed assertion fails the second time", () => {
  const b = createBroker(cfg());
  const cred = register(root, "drive", DOMAIN); b.enroll(cred);
  const challenge = (b.challenge("drive", cred.pseudonym).body as { challenge: string }).challenge;
  const a = makeAssertion(root, "drive", challenge);
  assert.equal(b.verifyAssertion(a).status, 200);
  assert.equal(b.verifyAssertion(a).status, 400, "challenge consumed → no replay");
});

test("unknown credential and missing-challenge are rejected", () => {
  const b = createBroker(cfg());
  const cred = register(root, "web", DOMAIN);
  assert.equal(b.challenge("web", cred.pseudonym).status, 404, "no enroll → no challenge");
  b.enroll(cred);
  assert.equal(b.verifyAssertion(makeAssertion(root, "web", "x")).status, 400, "no pending challenge");
});

test("compulsion-safe storage: the broker holds only public credentials — no roots/secrets", () => {
  const b = createBroker(cfg());
  b.enroll(register(root, "mail", DOMAIN));
  const dump = JSON.stringify([...b.stores.creds.values()]);
  assert.ok(!dump.includes(root.toString("hex")) && !dump.includes(root.toString("base64url")));
  for (const c of b.stores.creds.values()) assert.deepEqual(Object.keys(c).sort(), ["alias_email", "pseudonym", "public_key", "scope_ref", "selfSig"].sort());
});

test("IMPERSONATION blocked: a forged credential (pseudonym not matching its key, or bad selfSig) is rejected", () => {
  const b = createBroker(cfg());
  const victim = register(root, "mail", DOMAIN);
  const attacker = register(Buffer.alloc(32, 99), "mail", DOMAIN);
  // attacker tries to enroll their key under the victim's pseudonym
  const forged = { ...attacker, pseudonym: victim.pseudonym };
  assert.equal(b.enroll(forged).status, 401, "pseudonym must match the key");
  // tampered selfSig
  assert.equal(b.enroll({ ...victim, selfSig: attacker.selfSig }).status, 401, "selfSig must verify");
  // legit enroll, then overwrite attempt with a different key
  assert.equal(b.enroll(victim).status, 200);
  assert.equal(b.enroll({ ...attacker, scope_ref: victim.scope_ref, pseudonym: victim.pseudonym }).status, 401, "still must self-verify");
});

test("discovery + jwks are well-formed for standard RPs", () => {
  const b = createBroker(cfg());
  assert.equal((b.discovery().body as { issuer: string }).issuer, ISS);
  assert.ok((b.jwksDoc().body as { keys: unknown[] }).keys.length === 1);
});

// ── Security: fixed attack-path coverage ──────────────────────────────────────

const AUTH_CLIENT = "myapp";
const AUTH_REDIRECT = "https://example.com/callback";
const openBroker = () => createBroker({ iss: ISS, signingKey: generateSigningKey(), allowAllRedirectUris: true });

/** Generate an Ed25519 key pair and return { privateKey, pubB64u, pseudonym }. */
function genEd25519() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  // SPKI export for Ed25519: first 12 bytes are the OID header; bytes 12-43 are the raw 32-byte key.
  const pubRaw = (publicKey.export({ type: "spki", format: "der" }) as Buffer).slice(12);
  const pubB64u = pubRaw.toString("base64url");
  return { privateKey, pubB64u, pseudonym: "did:key:z" + pubB64u };
}

test("PKCE downgrade blocked: code_challenge_method=plain returns 400 at authorizeStart", () => {
  const b = openBroker();
  const res = b.authorizeStart({
    client_id: AUTH_CLIENT, redirect_uri: AUTH_REDIRECT, scope: "openid",
    code_challenge: "some-verifier-hash",
    code_challenge_method: "plain",  // RFC 7636 downgrade attempt
  });
  assert.equal(res.status, 400);
  assert.match((res.body as { error: string }).error, /S256/);
});

test("PKCE downgrade blocked: code_challenge present but no method also returns 400", () => {
  const b = openBroker();
  const res = b.authorizeStart({
    client_id: AUTH_CLIENT, redirect_uri: AUTH_REDIRECT, scope: "openid",
    code_challenge: "some-verifier-hash",
    // code_challenge_method intentionally omitted — undefined !== "S256"
  });
  assert.equal(res.status, 400);
});

test("forged JWT at userInfo rejected (signature mismatch → 401)", () => {
  // The /userinfo handler peeks the aud claim, then calls verifyIdToken which checks the Ed25519
  // signature. A token with a garbage sig must be rejected even if header/payload look valid.
  const b = openBroker();
  const fakeHeader  = Buffer.from('{"alg":"EdDSA","typ":"JWT"}').toString("base64url");
  // exp far in the future so expiry isn't what rejects it — it must be the signature
  const fakeClaims  = Buffer.from(JSON.stringify({ sub: "admin", iss: ISS, aud: AUTH_CLIENT, exp: 9_999_999_999, iat: 0 })).toString("base64url");
  // Ed25519 signatures are 64 bytes → 86 base64url chars; all-zeros is cryptographically invalid
  const garbageSig  = "A".repeat(86);
  const forged = `${fakeHeader}.${fakeClaims}.${garbageSig}`;
  assert.equal(b.userInfo(forged).status, 401);
});

test("pseudonym binding: fabricated pseudonym (not did:key:z+pubkey) returns 400 at authorizeComplete", () => {
  // Before the fix, startsWith("did:key:z") let an attacker enroll their real key
  // under an arbitrary pseudonym — breaking did:key resolution and audit trails.
  const b = openBroker();
  const startRes = b.authorizeStart({ client_id: AUTH_CLIENT, redirect_uri: AUTH_REDIRECT, scope: "openid" });
  assert.equal(startRes.status, 200);
  const { challenge, auth_nonce } = startRes.body as { challenge: string; auth_nonce: string };

  const { privateKey, pubB64u } = genEd25519();
  const sig = sign(null, Buffer.from(`${challenge}:${auth_nonce}`), privateKey).toString("base64url");

  // Pseudonym is "did:key:z" + arbitrary bytes — valid prefix, but does NOT equal "did:key:z" + pubB64u
  const fabricatedPseudonym = "did:key:z" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_"; // same length, wrong bytes
  const res = b.authorizeComplete({
    auth_nonce,
    pseudonym: fabricatedPseudonym,
    public_key: pubB64u,
    signature: sig,
  });
  assert.equal(res.status, 400);
  assert.match((res.body as { error: string }).error, /pseudonym/);
});

test("TOFU enrollment: first login with correct pseudonym=did:key:z+pubkey succeeds", () => {
  // Happy-path for the same check — correct pseudonym binding must not be over-blocked.
  const b = openBroker();
  const startRes = b.authorizeStart({ client_id: AUTH_CLIENT, redirect_uri: AUTH_REDIRECT, scope: "openid" });
  assert.equal(startRes.status, 200);
  const { challenge, auth_nonce } = startRes.body as { challenge: string; auth_nonce: string };

  const { privateKey, pubB64u, pseudonym } = genEd25519();
  const sig = sign(null, Buffer.from(`${challenge}:${auth_nonce}`), privateKey).toString("base64url");

  const res = b.authorizeComplete({ auth_nonce, pseudonym, public_key: pubB64u, signature: sig });
  assert.equal(res.status, 200);
  assert.ok((res.body as { redirect: string }).redirect.startsWith(AUTH_REDIRECT));
});
