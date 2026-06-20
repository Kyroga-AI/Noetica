import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exponentVector, compose, primeEncode, factorize, primeSignature, dominantTopics, congruence, zeroVector, DIMENSION } from './prime-topics.js'

test('22-dim basis maps to primes; identity (empty mixture) encodes to 1', () => {
  assert.equal(DIMENSION, 22)
  assert.equal(primeEncode(zeroVector()), 1n) // the domain pole / monoid identity
})

test('unique prime encoding round-trips (factorization recovers the vector)', () => {
  const e = exponentVector({ rte: 2, pln: 1, lrn: 3 }) // rte=2 (2^2), pln=71, lrn=59
  const sig = primeEncode(e)
  assert.equal(sig, 4n * 71n * (59n ** 3n))
  assert.deepEqual(factorize(sig), e) // meaning decomposes back to its prime topics
})

test('composition is the free commutative monoid (exponent addition)', () => {
  const a = exponentVector({ rte: 1, pol: 2 })
  const b = exponentVector({ pol: 1, cmp: 1 })
  const c = compose(a, b)
  // monoid: encode(a⊕b) === encode(a) * encode(b)
  assert.equal(primeEncode(c), primeEncode(a) * primeEncode(b))
  assert.deepEqual(c, exponentVector({ rte: 1, pol: 3, cmp: 1 }))
})

test('factorize rejects signatures with non-basis factors', () => {
  assert.equal(factorize(83n), null) // 83 is the 23rd prime — outside the 22 basis
})

test('dominant topics expose the prime factors of meaning', () => {
  const e = exponentVector({ cmp: 5, rte: 1 }) // cmp = "regression/symbolic regression" topic
  const top = dominantTopics(e, 2)
  assert.equal(top[0]!.code, 'cmp')
  assert.equal(top[0]!.exp, 5)
})

test('mod-M congruence lane wraps evidence', () => {
  assert.deepEqual(congruence(exponentVector({ rte: 7, pol: 3 }), 5), exponentVector({ rte: 2, pol: 3 }))
})

test('primeSignature is a stable short string', () => {
  assert.equal(typeof primeSignature(exponentVector({ rte: 1 })), 'string')
})
