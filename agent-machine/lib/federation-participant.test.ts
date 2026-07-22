/**
 * The Noetica participant's full membership loop against a real in-test org SuperPeer:
 * opt in by base key → unadmitted pumps NOTHING (local-only is silent, correct) → org
 * admits the writer key → the local knowledge-graph node percolates into the org index
 * (causal cut recording this writer). Skips when autobase/corestore (engine optional
 * deps) are absent — engine test convention.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SuperPeer, getHellGraph } from '@socioprophet/hellgraph'
import { optIn, optOut, pumpOnce, federationHandle, federationStatus } from './federation-participant.js'

process.env['FEDERATION_SWARM'] = '0'   // no DHT in tests — direct replication streams only
process.env['FEDERATION_PUMP'] = '0'    // tests drive pumpOnce() directly
process.env['FEDERATION_STATE'] =       // NEVER touch the user's real ~/.noetica opt-in state
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-fedstate-')), 'federation.json')

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-fed-'))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function federationAvailable(): Promise<boolean> {
  try { await import('autobase' as string); await import('corestore' as string); return true } catch { return false }
}

test('status is honest when never opted in; optIn validates the base key', async () => {
  assert.equal(federationStatus()['enabled'], false)
  await assert.rejects(() => optIn('nope'), /64 hex/)
})

test('opt-in → silent while unadmitted → admitted → local node percolates to the org', async (t) => {
  if (!(await federationAvailable())) return t.skip('autobase/corestore not installed')
  process.env['FEDERATION_DIR'] = tmp()

  const sp = await SuperPeer.create(tmp())          // in-test org (open/dev mode)
  const { writerKey } = await optIn(sp.baseKey())
  assert.match(writerKey, /^[0-9a-f]{64}$/i)
  assert.equal(federationStatus()['writable'], false)

  // pipe replication directly (tests) — production uses hyperswarm by base key
  const fas = federationHandle()!
  const s1 = sp.replicate(true) as { pipe: (x: unknown) => { pipe: (y: unknown) => void } }
  const s2 = fas.replicate(false) as { pipe: (x: unknown) => void }
  ;(s1.pipe(s2) as { pipe: (y: unknown) => void }).pipe(s1)
  await wait(200)

  // a local knowledge-graph write happens (any write site — the pump sees the graph, not the caller)
  getHellGraph().addNode('noetica:test:local-insight', ['Insight'], { note: 'born local' } as never)

  // UNADMITTED: the pump sends nothing — local-only is silent and correct
  assert.equal(await pumpOnce(), 0)

  // the org admits this machine — THE one-time governance action
  await sp.admit(fas.localWriterKey())
  await wait(300)
  await fas.update()
  assert.equal(fas.isWritable(), true)

  // now the pump percolates the local node
  const sent = await pumpOnce()
  assert.ok(sent >= 1, 'pump federates the local node once admitted')
  assert.equal(await pumpOnce(), 0, 'idempotent — nothing re-sent')

  // ...and the ORG INDEX sees it, with the causal cut naming this writer
  let health = await sp.health()
  for (let i = 0; i < 30 && health.nodes < 1; i++) { await wait(200); health = await sp.health() }
  assert.ok(health.nodes >= 1, 'org index materialized the participant node')
  assert.ok(((health.cut as Record<string, number>)[fas.localWriterKey()] ?? 0) >= 1,
    'causal cut records this participant — who contributed what')

  await optOut()
  assert.equal(federationStatus()['enabled'], false)
  await sp.close()
})
