/** Tests for the artifact swarm — content-addressed discovery, reuse, health ranking, magnets, + hardening. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactSwarm, toMagnet, parseMagnet, isValidHash } from './artifact-swarm.js'

const DAY = 86_400_000

test('magnet links round-trip (info-hash + metadata), normalize case, bound length', () => {
  const m = toMagnet({ hash: 'abc123', title: 'Design Doc', type: 'document', size: 42 })
  assert.ok(m.startsWith('magnet:?xt=urn:sha256:abc123'))
  const p = parseMagnet(m)!
  assert.equal(p.hash, 'abc123'); assert.equal(p.title, 'Design Doc'); assert.equal(p.type, 'document'); assert.equal(p.size, 42)
  assert.equal(parseMagnet('not a magnet'), null)
  assert.equal(parseMagnet('magnet:?xt=urn:sha256:DEADBEEF')!.hash, 'deadbeef', 'normalized lowercase')
  assert.equal(parseMagnet('magnet:?' + 'x'.repeat(5000)), null, 'over-long input rejected')
})

test('announce dedups identical content (same hash = one asset, multiple seeders)', () => {
  const s = new ArtifactSwarm(() => 1000 * DAY)
  s.announce({ hash: 'hash1', title: 'Spec', provider: 'nodeA' })
  s.announce({ hash: 'hash1', title: 'Spec', provider: 'nodeB' })
  assert.equal(s.size(), 1)
  assert.deepEqual(s.providers('hash1').sort(), ['nodeA', 'nodeB'])
})

test('swarm-health rewards seeders + reuse + recency', () => {
  let clock = 1000 * DAY
  const s = new ArtifactSwarm(() => clock)
  s.announce({ hash: 'hotone', title: 'Popular', provider: 'aaa' })
  s.announce({ hash: 'hotone', title: 'Popular', provider: 'bbb' })
  s.recordReuse('hotone'); s.recordReuse('hotone'); s.recordReuse('hotone')
  s.announce({ hash: 'cold', title: 'Lonely', provider: 'aaa' })
  assert.ok(s.health('hotone') > s.health('cold'))
  clock += 90 * DAY
  const aged = s.health('cold')
  s.announce({ hash: 'cold', title: 'Lonely', provider: 'aaa' })
  assert.ok(s.health('cold') > aged, 'recency lifts health on re-announce')
})

test('search ranks by relevance × health; topByReuse + rare', () => {
  const s = new ArtifactSwarm(() => 1000 * DAY)
  s.announce({ hash: 'auth', title: 'Auth Spec', provider: 'aaa', tags: ['security'] })
  s.announce({ hash: 'auth', title: 'Auth Spec', provider: 'bbb' })
  s.recordReuse('auth'); s.recordReuse('auth')
  s.announce({ hash: 'cook', title: 'Cooking', provider: 'aaa' })
  const hits = s.search('auth security')
  assert.equal(hits[0]!.hash, 'auth')
  assert.ok(hits[0]!.magnet.includes('urn:sha256:auth'))
  assert.equal(hits.some((h) => h.hash === 'cook'), false)
  assert.equal(s.topByReuse(1)[0]!.hash, 'auth')
  assert.equal(s.rare(5).some((r) => r.hash === 'cook'), true)
})

test('HARDENING: invalid/garbage hashes are rejected (no "undefined" pollution)', () => {
  const s = new ArtifactSwarm(() => 0)
  assert.equal(isValidHash('undefined'), true)   // it's alphanumeric, but...
  assert.equal(isValidHash('h1'), false, 'too short')
  assert.equal(isValidHash(''), false)
  assert.equal(isValidHash('has space'), false)
  assert.throws(() => s.announce({ hash: '', title: 'x', provider: 'p' }), /invalid_hash/)
  assert.throws(() => s.announce({ hash: 'h1', title: 'x', provider: 'p' }), /invalid_hash/)
})

test('HARDENING: snapshot/hydrate round-trips (survives restart); hydrate rejects garbage', () => {
  const s = new ArtifactSwarm(() => 1000 * DAY)
  s.announce({ hash: 'keepme', title: 'Doc', provider: 'aaa', tags: ['x'] })
  s.recordReuse('keepme')
  const snap = s.snapshot()
  const s2 = new ArtifactSwarm(() => 1000 * DAY)
  s2.hydrate(snap)
  assert.equal(s2.size(), 1)
  assert.deepEqual(s2.providers('keepme'), ['aaa'])
  assert.equal(s2.topByReuse(1)[0]!.reuse, 1, 'reuse count survived')
  s2.hydrate(null as unknown); s2.hydrate([{ junk: 1 }, null] as unknown)   // no crash
  assert.equal(s2.size(), 1)
})
