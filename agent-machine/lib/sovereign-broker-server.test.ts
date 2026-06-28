/** Proof the broker RUNS end-to-end over real HTTP: boot the server, enroll → challenge → verify → token, verify the
 *  token, and check discovery — the full sovereign login as a standard OIDC flow any relying party can drive. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createBrokerServer } from "./sovereign-broker-server.js";
import { generateSigningKey, verifyIdToken } from "./sovereign-oidc.js";
import { register, assert as makeAssertion } from "./sovereign-broker.js";

test("live HTTP: enroll → challenge → verify → token → RP verifies", async () => {
  const key = generateSigningKey();
  const ISS = "https://id.test";
  const server = createBrokerServer({ iss: ISS, signingKey: key });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = Buffer.alloc(32, 31);
  try {
    const cred = register(root, "mail", "socioprophet.ai"); // edge-side
    const enroll = await fetch(`${base}/credentials`, { method: "POST", body: JSON.stringify(cred) });
    assert.equal(enroll.status, 200);

    const ch = (await (await fetch(`${base}/challenge`, { method: "POST", body: JSON.stringify({ scope: "mail", pseudonym: cred.pseudonym }) })).json()) as { challenge: string };
    const a = makeAssertion(root, "mail", ch.challenge); // edge signs

    const vr = await fetch(`${base}/verify`, { method: "POST", body: JSON.stringify(a) });
    assert.equal(vr.status, 200);
    const body = (await vr.json()) as { id_token: string };
    const claims = verifyIdToken(key.publicKey, body.id_token, { iss: ISS, aud: "mail" });
    assert.ok(claims && claims.sub === cred.pseudonym && claims.email === cred.alias_email);

    const disc = (await (await fetch(`${base}/.well-known/openid-configuration`)).json()) as { issuer: string };
    assert.equal(disc.issuer, ISS);
    const jwks = (await (await fetch(`${base}/.well-known/jwks.json`)).json()) as { keys: unknown[] };
    assert.equal(jwks.keys.length, 1);
  } finally {
    server.close();
  }
});

test("bad input is rejected over HTTP (unknown credential)", async () => {
  const server = createBrokerServer({ iss: "https://id.test", signingKey: generateSigningKey() });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/challenge`, { method: "POST", body: JSON.stringify({ scope: "mail", pseudonym: "did:key:zNOPE" }) });
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});
