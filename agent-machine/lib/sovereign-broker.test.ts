/** Proofs for the sovereign auth handshake: passkey-style challenge-response where the root never leaves the edge,
 *  credentials are pairwise per app, and a credential can't be replayed across challenges, scopes, or roots. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register, assert as makeAssertion, verify, newChallenge } from "./sovereign-broker.js";

const rootA = Buffer.alloc(32, 7);
const rootB = Buffer.alloc(32, 9);
const DOMAIN = "socioprophet.ai";

test("happy path: enroll → challenge → sign → verify yields the pairwise subject", () => {
  const cred = register(rootA, "matrix", DOMAIN);
  const ch = newChallenge();
  const a = makeAssertion(rootA, "matrix", ch);
  const r = verify(cred, a, ch);
  assert.ok(r.ok);
  assert.equal(r.subject, cred.pseudonym);
});

test("credential record is cloud-safe — carries pubkey + alias, never the root", () => {
  const cred = register(rootA, "mail", DOMAIN);
  assert.ok(cred.public_key.length > 0 && cred.alias_email.endsWith("@" + DOMAIN));
  assert.ok(!JSON.stringify(cred).includes(rootA.toString("hex")));
  assert.ok(!JSON.stringify(cred).includes(rootA.toString("base64url")));
});

test("anti-replay: a stale/forged challenge fails", () => {
  const cred = register(rootA, "mail", DOMAIN);
  const a = makeAssertion(rootA, "mail", newChallenge());
  assert.equal(verify(cred, a, newChallenge()).ok, false, "assertion must match the challenge the IdP issued");
});

test("cross-RP replay blocked: a credential for app A can't satisfy app B", () => {
  const google = register(rootA, "google", DOMAIN);
  const ch = newChallenge();
  const corpAssertion = makeAssertion(rootA, "corp-mdm", ch);
  assert.equal(verify(google, corpAssertion, ch).ok, false, "scope binding stops cross-app credential reuse");
});

test("impersonation blocked: another root cannot satisfy the credential", () => {
  const cred = register(rootA, "drive", DOMAIN);
  const ch = newChallenge();
  const forged = makeAssertion(rootB, "drive", ch);
  assert.equal(verify(cred, forged, ch).ok, false, "only the holder of the root can sign");
});

test("pairwise subjects: the same user is a DIFFERENT sub at each app", () => {
  const subs = ["google", "matrix", "mail", "drive"].map((s) => register(rootA, s, DOMAIN).pseudonym);
  assert.equal(new Set(subs).size, subs.length, "no app can correlate the user via the subject");
});
