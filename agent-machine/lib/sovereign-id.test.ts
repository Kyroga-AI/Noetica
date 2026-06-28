/** Proofs for the sovereign anonymous-first identity core: determinism, cross-scope unlinkability,
 *  root-isolation, Senzing-defeating per-scope aliasing, and compartmentalized signing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScope, verifyFacet, scopeAlias, buildSubjectContext } from "./sovereign-id.js";

const rootA = Buffer.alloc(32, 1);
const rootB = Buffer.alloc(32, 2);
const DOMAIN = "socioprophet.ai";

test("deterministic per (root, scope)", () => {
  assert.equal(deriveScope(rootA, "google").pseudonym, deriveScope(rootA, "google").pseudonym);
  assert.equal(scopeAlias(rootA, "google", DOMAIN), scopeAlias(rootA, "google", DOMAIN));
});

test("UNLINKABLE across scopes — distinct pseudonym AND distinct alias (the Senzing defeat)", () => {
  const scopes = ["google", "corp-mdm", "matrix", "mail", "github"];
  const pseudonyms = scopes.map((s) => deriveScope(rootA, s).pseudonym);
  const aliases = scopes.map((s) => scopeAlias(rootA, s, DOMAIN));
  assert.equal(new Set(pseudonyms).size, scopes.length, "every scope has a distinct pseudonym");
  assert.equal(new Set(aliases).size, scopes.length, "every scope has a distinct email alias — nothing to join on");
});

test("root-bound + root-isolated — different roots give different facets for the same scope", () => {
  assert.notEqual(deriveScope(rootA, "google").pseudonym, deriveScope(rootB, "google").pseudonym);
  assert.notEqual(scopeAlias(rootA, "google", DOMAIN), scopeAlias(rootB, "google", DOMAIN));
  // the facet must not embed the raw root bytes
  const facet = deriveScope(rootA, "google");
  assert.ok(!facet.publicKeyRaw.equals(rootA), "facet key is derived, not the root");
});

test("compartmentalized signing — a facet signs only as itself", () => {
  const google = deriveScope(rootA, "google");
  const corp = deriveScope(rootA, "corp-mdm");
  const msg = "authorize: read mail";
  const sig = google.sign(msg);
  assert.ok(verifyFacet(google.publicKeyRaw, msg, sig), "facet verifies its own signature");
  assert.ok(!verifyFacet(corp.publicKeyRaw, msg, sig), "another scope's key cannot verify it");
  assert.ok(!verifyFacet(google.publicKeyRaw, "tampered", sig), "tampered message fails");
});

test("subject context: anonymous by default, proofed with an external factor, never leaks the root", () => {
  const anon = buildSubjectContext(rootA, "matrix", DOMAIN);
  assert.equal(anon.assurance, "anonymous");
  assert.equal(anon.external_factor, undefined);

  const proofed = buildSubjectContext(rootA, "corp-mdm", DOMAIN, "google-oidc");
  assert.equal(proofed.assurance, "proofed");
  assert.equal(proofed.external_factor, "google-oidc");

  // two scopes' contexts share NO field value (full compartmentalization)
  assert.notEqual(anon.pseudonymous_subject_commitment, proofed.pseudonymous_subject_commitment);
  assert.notEqual(anon.alias_email, proofed.alias_email);
  // root bytes never appear in the serialized context
  assert.ok(!JSON.stringify(proofed).includes(rootA.toString("hex")));
});
