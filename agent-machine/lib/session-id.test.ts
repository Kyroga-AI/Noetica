/** Tests for the SPARQL sessionId injection guard. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeSessionId } from './session-id.js'

test('accepts normal session ids', () => {
  for (const s of ['abc123', 'sess:42', 'a_b-c', 'A1:b_2-c', 'x'.repeat(128)]) {
    assert.equal(isSafeSessionId(s), true, s)
  }
})

test('REJECTS injection vectors (quote, whitespace, braces, over-length)', () => {
  for (const s of [
    '"', 'a" }', 'a b', 'a\n', 'a\t', "x' OR '1'='1", 'a{b}', 'a.b', 'a/b', '', 'x'.repeat(129),
  ]) assert.equal(isSafeSessionId(s), false, JSON.stringify(s));
})
