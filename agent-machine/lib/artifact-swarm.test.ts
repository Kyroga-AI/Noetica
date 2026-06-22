/** Tests for the artifact swarm — content-addressed discovery, reuse, swarm-health ranking, magnets. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactSwarm, toMagnet, parseMagnet } from './artifact-swarm.js'

const DAY = 86_400_000

test('magnet links round-trip (info-hash + metadata)', () => {
  const m = toMagnet({ hash: 'abc123', title: 'Design Doc', type: 'document', size: 42 })
  assert.ok(m.startsWith('magnet:?xt=urn:sha256:abc123'))
  const p = parseMagnet(m)!
  assert.equal(p.hash, 'abc123'); assert.equal(p.title, 'Design Doc'); assert.equal(p.type, 'document'); assert.equal(p.size, 42)
  assert.equal(parseMagnet('not a magnet'), null)
})

test('announce dedups identical content (same hash = one asset, multiple seeders)', () => {
  const s = new ArtifactSwarm(() => 1000 * DAY)
  s.announce({ hash: 'h1', title: 'Spec', provider: 'nodeA' })
  s.announce({ hash: 'h1', title: 'Spec', provider: 'nodeB' })   // another seeder of the SAME content
  assert.equal(s.size(), 1, 'one asset')
  assert.deepEqual(s.providers('h1').sort(), ['nodeA', 'nodeB'], 'two seeders')
})

test('swarm-health rewards seeders + reuse + recency', () => {
  let clock = 1000 * DAY
  const s = new ArtifactSwarm(() => clock)
  s.announce({ hash: 'hot', title: 'Popular', provider: 'a' })
  s.announce({ hash: 'hot', title: 'Popular', provider: 'b' })
  s.recordReuse('hot'); s.recordReuse('hot'); s.recordReuse('hot')
  s.announce({ hash: 'cold', title: 'Lonely', provider: 'a' })
  assert.ok(s.health('hot') > s.health('cold'), 'well-seeded + reused beats lonely')
  clock += 90 * DAY   // age everything
  const aged = s.health('cold')
  s.announce({ hash: 'cold', title: 'Lonely', provider: 'a' })   // re-announce → fresh
  assert.ok(s.health('cold') > aged, 'recency lifts health on re-announce')
})

test('search ranks by relevance × health; topByReuse + rare', () => {
  const s = new ArtifactSwarm(() => 1000 * DAY)
  s.announce({ hash: 'auth', title: 'Auth Spec', provider: 'a', tags: ['security'] })
  s.announce({ hash: 'auth', title: 'Auth Spec', provider: 'b' })
  s.recordReuse('auth'); s.recordReuse('auth')
  s.announce({ hash: 'cook', title: 'Cooking', provider: 'a' })
  const hits = s.search('auth security')
  assert.equal(hits[0]!.hash, 'auth')
  assert.ok(hits[0]!.magnet.includes('urn:sha256:auth'))
  assert.equal(hits.some((h) => h.hash === 'cook'), false, 'irrelevant excluded')
  assert.equal(s.topByReuse(1)[0]!.hash, 'auth', 'most-reused surfaces')
  assert.equal(s.rare(5).some((r) => r.hash === 'cook'), true, 'single-seeder asset flagged rare')
})
