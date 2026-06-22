/** Tests for the bounded LRU map. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoundedMap } from './lru.js'

test('caps size and evicts the least-recently-used key', () => {
  const m = new BoundedMap<string, number>(2)
  m.set('a', 1); m.set('b', 2); m.set('c', 3) // 'a' evicted
  assert.equal(m.size, 2)
  assert.equal(m.has('a'), false)
  assert.equal(m.get('b'), 2)
  assert.equal(m.get('c'), 3)
})

test('get touches a key so it survives the next eviction', () => {
  const m = new BoundedMap<string, number>(2)
  m.set('a', 1); m.set('b', 2)
  assert.equal(m.get('a'), 1) // 'a' now MRU
  m.set('c', 3)               // 'b' is LRU → evicted, 'a' survives
  assert.equal(m.has('a'), true)
  assert.equal(m.has('b'), false)
})

test('re-setting an existing key updates value without growing size', () => {
  const m = new BoundedMap<string, number>(2)
  m.set('a', 1); m.set('a', 9)
  assert.equal(m.size, 1)
  assert.equal(m.get('a'), 9)
})

test('cap floors at 1', () => {
  const m = new BoundedMap<string, number>(0)
  m.set('a', 1); m.set('b', 2)
  assert.equal(m.size, 1)
  assert.equal(m.get('b'), 2)
})
