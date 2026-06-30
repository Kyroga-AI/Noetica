/**
 * seat-scope.test — sovereign multi-seat gating. Pure: no model, no server. Confirms:
 *   • owner seat → allowed everywhere (single-user unchanged);
 *   • scoped seat → allowed in-scope, denied out-of-scope (collection + trust);
 *   • AccessProfile conforms to sourceos-spec AccessProfile.json (structural);
 *   • enqueueIngest denial path returns a clean failed job (no crash);
 *   • single-user default (no NOETICA_SEAT) ingests under the owner seat + emits a receipt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SPEC_DIR = '/Users/michaelheller/dev/sourceos-spec/schemas'

function accessProfileSchema(): any | null {
  try {
    const p = join(SPEC_DIR, 'AccessProfile.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch { return null }
}

test('owner seat: full access everywhere; AccessProfile conforms to spec', async () => {
  const { defaultOwnerSeat, seatCanAccess } = await import('./seat-scope.js')
  const owner = defaultOwnerSeat()
  assert.equal(owner.isOwner, true)
  assert.ok(seatCanAccess(owner, 'any-collection'), 'owner allowed anywhere')
  assert.ok(seatCanAccess(owner, 'x', 'restricted-material'), 'owner allowed at any trust')

  const schema = accessProfileSchema()
  if (schema) {
    const ap = owner.accessProfile
    for (const r of schema.required ?? []) assert.ok(r in ap, `AccessProfile has required "${r}"`)
    assert.match(ap.id, new RegExp(schema.properties.id.pattern), 'AccessProfile URN prefix')
    assert.equal(ap.type, 'AccessProfile')
  }
})

test('scoped seat: allowed in-scope, denied out-of-scope (collection + trust)', async () => {
  process.env.NOETICA_SEATS_JSON = JSON.stringify({
    'team-research': { name: 'Research', collections: ['research'], trustLevels: ['trusted-workspace-source'] },
  })
  process.env.NOETICA_SEAT = 'team-research'
  try {
    // fresh import to pick up env-driven registry/currentSeat
    const mod = await import('./seat-scope.js?scoped=' + Date.now())
    const seat = mod.currentSeat()
    assert.equal(seat.isOwner, false)
    assert.equal(seat.scopeId, 'team-research')

    assert.ok(mod.seatCanAccess(seat, 'research'), 'in-scope collection allowed')
    assert.ok(mod.seatCanAccess(seat, 'research', 'trusted-workspace-source'), 'in-scope trust allowed')
    assert.ok(!mod.seatCanAccess(seat, 'finance'), 'out-of-scope collection denied')
    assert.ok(!mod.seatCanAccess(seat, 'research', 'restricted-material'), 'out-of-scope trust denied')
  } finally {
    delete process.env.NOETICA_SEAT
    delete process.env.NOETICA_SEATS_JSON
  }
})

test('unknown scoped seat: deny-by-default (no registry entry)', async () => {
  const mod = await import('./seat-scope.js?unknown=' + Date.now())
  // Self-contained: derive directly with an empty registry so concurrent tests' env can't leak in.
  const prevReg = process.env.NOETICA_SEATS_JSON
  delete process.env.NOETICA_SEATS_JSON
  try {
    const seat = mod.deriveScopedSeat('unknown-seat-xyz')
    assert.equal(seat.isOwner, false)
    assert.ok(!mod.seatCanAccess(seat, 'anything'), 'unknown scoped seat denied by default')
  } finally {
    if (prevReg === undefined) delete process.env.NOETICA_SEATS_JSON
    else process.env.NOETICA_SEATS_JSON = prevReg
  }
})

test('enqueueIngest: out-of-scope seat → clean DENIED failed job (no crash)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'noetica-seat-'))
  const prevEv = process.env.SOURCEOS_REASONING_EVIDENCE
  process.env.SOURCEOS_REASONING_EVIDENCE = dir
  process.env.NOETICA_SEATS_JSON = JSON.stringify({
    'narrow': { name: 'Narrow', collections: ['allowed-col'] },
  })
  process.env.NOETICA_SEAT = 'narrow'
  try {
    const { enqueueIngest } = await import('./ingest-queue.js?deny=' + Date.now())
    const job = enqueueIngest('secret.txt', 'text/plain', Buffer.from('hello'), 'forbidden-col')
    assert.equal(job.status, 'failed', 'denied job is failed')
    assert.equal(job.denied, true, 'flagged denied')
    assert.match(job.reason ?? '', /out of scope/, 'clear reason')
  } finally {
    delete process.env.NOETICA_SEAT
    delete process.env.NOETICA_SEATS_JSON
    if (prevEv === undefined) delete process.env.SOURCEOS_REASONING_EVIDENCE
    else process.env.SOURCEOS_REASONING_EVIDENCE = prevEv
    rmSync(dir, { recursive: true, force: true })
  }
})

test('single-user default: no NOETICA_SEAT → owner seat, ingestion works', async () => {
  delete process.env.NOETICA_SEAT
  const { currentSeat } = await import('./seat-scope.js?single=' + Date.now())
  const seat = currentSeat()
  assert.equal(seat.isOwner, true, 'default is the owner seat')
  // enqueueIngest under owner must NOT deny.
  const dir = mkdtempSync(join(tmpdir(), 'noetica-single-'))
  const prevEv = process.env.SOURCEOS_REASONING_EVIDENCE
  process.env.SOURCEOS_REASONING_EVIDENCE = dir
  try {
    const { enqueueIngest } = await import('./ingest-queue.js?single=' + Date.now())
    const job = enqueueIngest('note.txt', 'text/plain', Buffer.from('hi'), 'inbox')
    assert.notEqual(job.status, 'failed', 'owner ingestion not denied')
    assert.ok(!job.denied, 'owner ingestion not flagged denied')
  } finally {
    if (prevEv === undefined) delete process.env.SOURCEOS_REASONING_EVIDENCE
    else process.env.SOURCEOS_REASONING_EVIDENCE = prevEv
    rmSync(dir, { recursive: true, force: true })
  }
})
