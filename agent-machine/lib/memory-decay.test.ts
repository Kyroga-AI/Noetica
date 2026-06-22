/** Tests for salience-based memory decay + principled forgetting. now is injected for determinism. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { salience, decayRank, pruneToBudget, touch } from './memory-decay.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY   // fixed epoch

test('recent + frequently-accessed memory is more salient than stale + rare', () => {
  const fresh = salience({ id: 'a', createdAt: NOW, lastAccess: NOW, accessCount: 10 }, { now: NOW })
  const stale = salience({ id: 'b', createdAt: NOW - 200 * DAY, lastAccess: NOW - 200 * DAY, accessCount: 0 }, { now: NOW })
  assert.equal(fresh > stale, true)
  assert.ok(fresh <= 1 && stale >= 0)
})

test('access frequency slows decay (longer half-life)', () => {
  const rare = salience({ id: 'a', createdAt: NOW, lastAccess: NOW - 60 * DAY, accessCount: 0 }, { now: NOW })
  const often = salience({ id: 'b', createdAt: NOW, lastAccess: NOW - 60 * DAY, accessCount: 50 }, { now: NOW })
  assert.equal(often > rare, true, 'same age, more accesses → higher retention')
})

test('pinned memory never decays', () => {
  assert.equal(salience({ id: 'p', createdAt: NOW - 9999 * DAY, pinned: true }, { now: NOW }), 1)
})

test('importance scales salience', () => {
  const lo = salience({ id: 'a', createdAt: NOW, lastAccess: NOW, importance: 0.2 }, { now: NOW })
  const hi = salience({ id: 'b', createdAt: NOW, lastAccess: NOW, importance: 0.9 }, { now: NOW })
  assert.equal(hi > lo, true)
})

test('pruneToBudget keeps the most salient + all pinned, evicts the rest', () => {
  const mems = [
    { id: 'pin', createdAt: NOW - 500 * DAY, pinned: true },
    { id: 'hot', createdAt: NOW, lastAccess: NOW, accessCount: 20 },
    { id: 'warm', createdAt: NOW, lastAccess: NOW - 20 * DAY, accessCount: 2 },
    { id: 'cold', createdAt: NOW - 300 * DAY, lastAccess: NOW - 300 * DAY, accessCount: 0 },
  ]
  const { keep, evict } = pruneToBudget(mems, 3, { now: NOW })
  const keepIds = keep.map((m) => m.id)
  assert.equal(keepIds.includes('pin'), true, 'pinned always kept')
  assert.equal(keepIds.includes('hot'), true, 'hottest kept')
  assert.equal(evict.map((m) => m.id).includes('cold'), true, 'coldest evicted')
  assert.equal(keep.length, 3)
})

test('decayRank sorts by descending salience', () => {
  const ranked = decayRank([
    { id: 'cold', createdAt: NOW - 300 * DAY, lastAccess: NOW - 300 * DAY },
    { id: 'hot', createdAt: NOW, lastAccess: NOW, accessCount: 5 },
  ], { now: NOW })
  assert.equal(ranked[0]!.id, 'hot')
  assert.equal(ranked[0]!.salience >= ranked[1]!.salience, true)
})

test('touch bumps access count + recency', () => {
  const m = touch({ id: 'a', createdAt: NOW - 10 * DAY, accessCount: 3 }, NOW)
  assert.equal(m.accessCount, 4)
  assert.equal(m.lastAccess, NOW)
})
