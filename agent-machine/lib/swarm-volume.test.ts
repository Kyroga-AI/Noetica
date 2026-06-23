/** Tests for the swarm volume (TopoLVM-style local mount for agent swarming). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { provisionSwarmVolume, joinSwarm, leaveSwarm, swarmMembers, readManifest } from './swarm-volume.js'

const SID = `test-${process.pid}-${Date.now()}`

test('provisionSwarmVolume creates a mountable directory volume + manifest + blackboard', () => {
  const v = provisionSwarmVolume({ swarmId: SID })
  assert.equal(v.backend, 'directory')   // no LVM in CI → directory-backed
  assert.equal(v.mounted, true)
  assert.ok(existsSync(v.path), 'mount path exists')
  assert.ok(existsSync(`${v.path}/blackboard`), 'shared blackboard exists')
  assert.ok(readManifest(SID), 'manifest written')
})

test('agents join + form the swarm; leave removes them', () => {
  joinSwarm(SID, 'agent-a', 'planner')
  joinSwarm(SID, 'agent-b', 'worker')
  joinSwarm(SID, 'agent-a')   // idempotent re-join
  let live = swarmMembers(SID)
  assert.equal(live.length, 2)
  assert.equal(live.find((m) => m.agentId === 'agent-a')?.role, 'planner')
  leaveSwarm(SID, 'agent-b')
  live = swarmMembers(SID)
  assert.equal(live.length, 1)
})

test('swarmMembers filters out stale members', () => {
  const sid2 = `${SID}-stale`
  joinSwarm(sid2, 'old-agent')
  // window of 0ms → everyone is stale
  assert.equal(swarmMembers(sid2, 0, Date.now() + 1000).length, 0)
})
