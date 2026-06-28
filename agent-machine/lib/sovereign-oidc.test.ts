/** Proofs for OIDC issuance: standard EdDSA JWS, tamper/issuer/audience/expiry checks, JWKS round-trip, and the full
 *  sovereign login end-to-end (edge signs → IdP verifies → IdP issues a standard token any RP can consume). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKey, issueIdToken, verifyIdToken, jwks, publicKeyFromJwk } from "./sovereign-oidc.js";
import { register, assert as makeAssertion, verify, newChallenge } from "./sovereign-broker.js";

const key = generateSigningKey();
const ISS = "https://id.socioprophet.ai";

test("issue → verify round-trips with the right claims", () => {
  const t = issueIdToken(key, { iss: ISS, sub: "did:key:zABC", aud: "mail", email: "x@socioprophet.ai" });
  const c = verifyIdToken(key.publicKey, t, { iss: ISS, aud: "mail" });
  assert.ok(c);
  assert.equal(c.sub, "did:key:zABC");
  assert.equal(c.email, "x@socioprophet.ai");
});

test("tampered payload fails", () => {
  const t = issueIdToken(key, { iss: ISS, sub: "did:key:zABC", aud: "mail" });
  const [h, , s] = t.split(".");
  const forged = `${h}.${Buffer.from(JSON.stringify({ iss: ISS, sub: "did:key:zEVIL", aud: "mail", iat: 1, exp: 9e9 })).toString("base64url")}.${s}`;
  assert.equal(verifyIdToken(key.publicKey, forged, { iss: ISS, aud: "mail" }), null);
});

test("wrong issuer / audience rejected", () => {
  const t = issueIdToken(key, { iss: ISS, sub: "s", aud: "mail" });
  assert.equal(verifyIdToken(key.publicKey, t, { iss: "https://evil", aud: "mail" }), null);
  assert.equal(verifyIdToken(key.publicKey, t, { iss: ISS, aud: "drive" }), null, "a mail token must not work at drive");
});

test("expiry enforced", () => {
  const t = issueIdToken(key, { iss: ISS, sub: "s", aud: "mail", iat: 1000, ttlSec: 60 });
  assert.ok(verifyIdToken(key.publicKey, t, { iss: ISS, aud: "mail", at: 1030 }));
  assert.equal(verifyIdToken(key.publicKey, t, { iss: ISS, aud: "mail", at: 2000 }), null);
});

test("JWKS round-trip: an RP verifies using only the published public JWK", () => {
  const x = jwks(key).keys[0].x;
  const t = issueIdToken(key, { iss: ISS, sub: "s", aud: "web" });
  assert.ok(verifyIdToken(publicKeyFromJwk(x), t, { iss: ISS, aud: "web" }));
});

test("END-TO-END sovereign login: edge proves possession → IdP issues a standard token, pairwise + aliased", () => {
  const root = Buffer.alloc(32, 3);
  const DOMAIN = "socioprophet.ai";
  // enroll the mail facet (cloud stores a root-free credential)
  const cred = register(root, "mail", DOMAIN);
  // login: IdP challenges, edge signs, IdP verifies
  const ch = newChallenge();
  const v = verify(cred, makeAssertion(root, "mail", ch), ch);
  assert.ok(v.ok && v.subject);
  // IdP mints a standard OIDC token any RP consumes
  const token = issueIdToken(key, { iss: ISS, sub: v.subject!, aud: "mail", email: cred.alias_email });
  const claims = verifyIdToken(key.publicKey, token, { iss: ISS, aud: "mail" });
  assert.ok(claims);
  assert.equal(claims.sub, cred.pseudonym, "sub is the pairwise pseudonym");
  assert.equal(claims.email, cred.alias_email, "email is the per-scope unlinkable alias");
  // a different app gets a different sub for the same user
  assert.notEqual(register(root, "drive", DOMAIN).pseudonym, cred.pseudonym);
});
