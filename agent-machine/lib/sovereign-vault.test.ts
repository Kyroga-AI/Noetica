/** Proofs for compulsion resistance: data is sealed under root-derived keys; without the root there is no access —
 *  the operator/DAO holds only ciphertext it cannot decrypt, and cannot be compelled to reveal what it can't read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveDataKey, seal, open, sealForScope, openForScope } from "./sovereign-vault.js";

const root = Buffer.alloc(32, 5);
const attackerRoot = Buffer.alloc(32, 6); // a compelled operator with a DIFFERENT key (or no key at all)

test("round-trips for the holder of the root", () => {
  const blob = sealForScope(root, "mail", "the confidential message");
  assert.equal(openForScope(root, "mail", blob).toString(), "the confidential message");
});

test("COMPULSION RESISTANCE: without the user's root there is no access to the plaintext", () => {
  const blob = sealForScope(root, "mail", "subpoena me, you get nothing");
  // operator holds only `blob`. With any other/no root, derivation yields a different key → open fails.
  assert.throws(() => openForScope(attackerRoot, "mail", blob), "a different root cannot open it");
  assert.notDeepEqual(deriveDataKey(root, "mail"), deriveDataKey(attackerRoot, "mail"));
});

test("tamper-evident (GCM auth): flipped ciphertext fails", () => {
  const key = deriveDataKey(root, "drive");
  const blob = seal(key, "x", "drive");
  const buf = Buffer.from(blob, "base64url"); buf[buf.length - 1] ^= 0xff;
  assert.throws(() => open(key, buf.toString("base64url"), "drive"));
});

test("per-scope isolation: one scope's key cannot open another scope's data", () => {
  const blob = sealForScope(root, "mail", "secret");
  assert.throws(() => openForScope(root, "drive", blob), "AAD + key both bind the scope");
});

test("deterministic key per (root, scope) — recoverable from the seed alone, no operator escrow", () => {
  assert.deepEqual(deriveDataKey(root, "mail"), deriveDataKey(root, "mail"));
});
