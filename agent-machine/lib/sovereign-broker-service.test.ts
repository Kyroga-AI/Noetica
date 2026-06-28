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
  for (const c of b.stores.creds.values()) assert.deepEqual(Object.keys(c).sort(), ["alias_email", "pseudonym", "public_key", "scope_ref"].sort());
});

test("discovery + jwks are well-formed for standard RPs", () => {
  const b = createBroker(cfg());
  assert.equal((b.discovery().body as { issuer: string }).issuer, ISS);
  assert.ok((b.jwksDoc().body as { keys: unknown[] }).keys.length === 1);
});
