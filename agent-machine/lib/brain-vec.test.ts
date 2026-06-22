/** Tests for the canonical brain-vector codec — round-trip fidelity + the alignment trap. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeVec, decodeVec, l2norm } from './brain-vec.js'

test('encode → decode round-trips Float32 values exactly', () => {
  const v = [0.1, -0.5, 3.14159, 0, 1e-6, -2.7e3]
  const out = decodeVec(encodeVec(v))
  assert.equal(out.length, v.length)
  for (let i = 0; i < v.length; i++) assert.ok(Math.abs(out[i]! - Math.fround(v[i]!)) < 1e-9)
})

test('decode is alignment-safe across every byte offset (the pooled-Buffer trap)', () => {
  // The old `new Float32Array(buf.buffer, buf.byteOffset, dims)` throws when byteOffset % 4 !== 0.
  // Force each possible misalignment by prepending 0..3 padding bytes before the vector payload,
  // base64-ing the whole thing, then decoding the offset slice — decodeVec must never throw.
  const v = Float32Array.from([1, 2, 3, 4])
  const payload = Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  for (let pad = 0; pad < 4; pad++) {
    const padded = Buffer.concat([Buffer.alloc(pad), payload])
    const sliced = padded.subarray(pad) // byteOffset = pad → 1,2,3 are non-4-aligned
    const b64 = sliced.toString('base64')
    const out = decodeVec(b64)
    assert.equal(out.length, 4, `pad=${pad}`)
    assert.deepEqual([...out], [1, 2, 3, 4], `pad=${pad}`)
  }
})

test('dims caps an over-long payload but leaves a short one intact', () => {
  const v = [1, 2, 3, 4, 5, 6]
  assert.equal(decodeVec(encodeVec(v), 4).length, 4)
  assert.equal(decodeVec(encodeVec(v), 10).length, 6)
})

test('l2norm floors a zero vector at 1 (safe division)', () => {
  assert.equal(l2norm(new Float32Array([0, 0, 0])), 1)
  assert.ok(Math.abs(l2norm(new Float32Array([3, 4])) - 5) < 1e-6)
})
