/** Proofs for the broker service: full enroll→challenge→verify→token flow, one-time challenges, unknown-credential
 *  rejection, and that the service holds only public material (no roots/secrets) — compulsion-safe by storage. */
import { test } from "node:test";
import assert from "node:assert/strict";
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
