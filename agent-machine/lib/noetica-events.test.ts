import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  emitNoeticaEvent, featureOk, featureSad, featureBad, gateVerdict, permissionChanged,
  noeticaBootEvidence, _resetGovernanceCacheForTest,
} from './noetica-events.js'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'noetica-ev-'))
  process.env.NOETICA_HOME = home
  delete process.env.NOETICA_EVENTS_SINK
  _resetGovernanceCacheForTest()
})
afterEach(() => {
  delete process.env.NOETICA_HOME
  delete process.env.NOETICA_EVENTS_SINK
  rmSync(home, { recursive: true, force: true })
})

function readEvents(): Array<Record<string, any>> {
  const dir = join(home, 'sessions')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'))
  const lines: Array<Record<string, any>> = []
  for (const f of files) for (const l of readFileSync(join(dir, f), 'utf8').trim().split('\n')) if (l) lines.push(JSON.parse(l))
  return lines
}
function sha16(s: string): string { return createHash('sha256').update(s).digest('hex').slice(0, 16) }

function writeGovernance(rules: unknown): void {
  writeGovernanceFile('redaction.json', rules)
}
function writeGovernanceFile(name: string, body: unknown): void {
  mkdirSync(join(home, 'governance'), { recursive: true })
  writeFileSync(join(home, 'governance', name), JSON.stringify(body))
}

test('emits an EventEnvelope-conformant line with tri-state severity', () => {
  const id = featureOk('lsp_init')
  assert.notEqual(id, '')
  const [ev] = readEvents()
  for (const k of ['eventId', 'eventType', 'specVersion', 'occurredAt', 'actor', 'objectId', 'payload']) {
    assert.ok(k in ev, `missing required EventEnvelope field ${k}`)
  }
  assert.equal(ev.eventType, 'noetica.feature.ok')
  assert.equal(ev.objectId, 'lsp_init')
  assert.equal(ev.payload.severity, 'ok')
  assert.equal(ev.payload.kind, 'verdict')
  assert.equal(ev.integrity.redaction_applied, true)
  assert.match(ev.integrity.envelope_hash, /^sha256:[0-9a-f]{64}$/)
})

test('sad and bad carry error codes; sad is a distinct state', () => {
  featureSad('policy_limits_poll', 'stale_cache_used')
  featureBad('api_bootstrap_fetch', 'request_failed')
  const evs = readEvents()
  const sad = evs.find((e) => e.eventType === 'noetica.feature.sad')!
  const bad = evs.find((e) => e.eventType === 'noetica.feature.bad')!
  assert.equal(sad.payload.severity, 'sad')
  assert.equal(sad.payload.error_code, 'stale_cache_used')
  assert.equal(bad.payload.severity, 'bad')
  assert.equal(bad.payload.error_code, 'request_failed')
})

test('envelope redaction: pii hashed, secrets dropped, wherever they appear', () => {
  writeGovernance({ classes: { pii: { action: 'hash' }, secret: { action: 'drop' } }, fields: { device_id: 'pii', api_key: 'secret' } })
  emitNoeticaEvent({
    eventType: 'noetica.run.start', objectId: 'run',
    extra: { device_id: 'b47bab1cecf5', nested: { api_key: 'sk-live-abc123', device_id: 'b47bab1cecf5' } },
  })
  const [ev] = readEvents()
  assert.equal(ev.payload.device_id, `sha256-16:${sha16('b47bab1cecf5')}`)
  assert.equal(ev.payload.nested.device_id, `sha256-16:${sha16('b47bab1cecf5')}`)
  assert.ok(!('api_key' in ev.payload.nested), 'secret must be dropped, not just masked')
  const flat = JSON.stringify(ev)
  assert.ok(!flat.includes('b47bab1cecf5'), 'no cleartext pii anywhere in envelope')
  assert.ok(!flat.includes('sk-live-abc123'), 'no cleartext secret anywhere in envelope')
  assert.ok(Array.isArray(ev.integrity.redactions) && ev.integrity.redactions.length >= 3)
})

test('hash-echo invariant: cleartext whose hash appears elsewhere gets redacted (tengu leak class)', () => {
  writeGovernance({ classes: { pii: { action: 'hash' } }, fields: { plugin_name_redacted: 'pii' } })
  // payload redacts plugin_name_redacted, but the same value rides in clear as plugin_name —
  // exactly the tengu envelope leak. The invariant must catch the echo.
  emitNoeticaEvent({
    eventType: 'noetica.plugin.loaded', objectId: 'plugin',
    extra: { plugin_name_redacted: 'cowork-mgmt', plugin_name: 'cowork-mgmt' },
  })
  const [ev] = readEvents()
  assert.equal(ev.payload.plugin_name, `sha256-16:${sha16('cowork-mgmt')}`)
  assert.ok(!JSON.stringify(ev).includes('cowork-mgmt'), 'echoed cleartext must not survive')
})

test('fail-degraded: missing governance file → builtin floor + one-time sad emitted', () => {
  // no governance/redaction.json written → degraded path
  emitNoeticaEvent({ eventType: 'noetica.run.start', objectId: 'r1', extra: { organization_uuid: '2b4436e0-aaaa' } })
  const evs = readEvents()
  const run = evs.find((e) => e.eventType === 'noetica.run.start')!
  assert.equal(run.payload.organization_uuid, `sha256-16:${sha16('2b4436e0-aaaa')}`, 'builtin floor still hashes pii')
  const sads = evs.filter((e) => e.eventType === 'noetica.feature.sad' && e.objectId === 'governance_redaction_load')
  assert.equal(sads.length, 1, 'degradation reported exactly once (fail-degraded, not fail-silent)')
})

test('gateVerdict maps decision → severity (admit=ok, demote=sad, deny=bad)', () => {
  gateVerdict({ tool: 'edit_file', decision: 'admit', requestedLevel: 'L2', grantedLevel: 'L2', role: 'operator' })
  gateVerdict({ tool: 'run_command', decision: 'demote', requestedLevel: 'L4', grantedLevel: 'L1', role: 'operator' })
  gateVerdict({ tool: 'update_self', decision: 'deny', requestedLevel: 'L5', grantedLevel: 'L0', role: 'operator', reason: 'insufficient evidence' })
  const evs = readEvents()
  assert.equal(evs.find((e) => e.objectId === 'edit_file')!.payload.severity, 'ok')
  const demote = evs.find((e) => e.objectId === 'run_command')!
  assert.equal(demote.payload.severity, 'sad')
  assert.equal(demote.eventType, 'noetica.gate.rejected')
  const deny = evs.find((e) => e.objectId === 'update_self')!
  assert.equal(deny.payload.severity, 'bad')
  assert.equal(deny.payload.claims[0].provenance, 'observed')
})

test('permissionChanged emits datable peripheral-tier receipts', () => {
  permissionChanged('macos.accessibility', true, { app: 'Claude' })
  permissionChanged('macos.accessibility', false, { app: 'Claude' })
  // filter: the fail-degraded one-time sad may interleave (no governance file here)
  const evs = readEvents().filter((e) => e.eventType.startsWith('noetica.permission.'))
  assert.equal(evs[0].eventType, 'noetica.permission.granted')
  assert.equal(evs[1].eventType, 'noetica.permission.revoked')
  assert.equal(evs[0].payload.tier, 'peripheral')
  assert.equal(evs[0].payload.claims[0].field, 'granted')
})

test('noeticaBootEvidence records governance health + autonomy bind state (unbound = ok, observed)', () => {
  writeGovernance({ classes: {}, fields: {} })
  noeticaBootEvidence()
  const evs = readEvents()
  assert.ok(evs.some((e) => e.eventType === 'noetica.feature.ok' && e.objectId === 'governance_redaction_load'))
  const bind = evs.find((e) => e.objectId === 'autonomy_bind_state')!
  assert.equal(bind.payload.claims[0].field, 'autonomy_bound')
  assert.equal(bind.payload.claims[0].value, false)
  assert.match(bind.payload.note, /not enforced/)
})

test('envelope_hash is canonical (key order independent) and computed post-redaction', () => {
  writeGovernance({ classes: { pii: { action: 'hash' } }, fields: { email: 'pii' } })
  emitNoeticaEvent({ eventType: 'noetica.run.start', objectId: 'x', extra: { email: 'mdheller@gmail.com', b: 1, a: 2 } })
  const [ev] = readEvents()
  assert.ok(!JSON.stringify(ev).includes('mdheller@gmail.com'))
  assert.match(ev.integrity.envelope_hash, /^sha256:[0-9a-f]{64}$/)
})

// ─── the moat, as a test: cross-language byte-parity of the v1 envelope_hash ───

test('cross-language hash parity: TS v1 envelope_hash === python canonical_hash', (t) => {
  // Clean, ASCII-only event with no redactable fields → redaction is identity, isolating the
  // hash SCHEME. A TS-emitted event must hash byte-for-byte the same as the stdlib emitter
  // (~/.noetica/bin/noetica_emit.py canonical_hash), or the shared receipt is not portable.
  const id = emitNoeticaEvent({
    eventType: 'noetica.run.start', objectId: 'parity',
    severity: 'ok', kind: 'operation', tier: 'telemetry',
    extra: { n: 7, flag: true, label: 'plain-ascii', arr: [3, 1, 2] },
  })
  assert.notEqual(id, '')
  const [ev] = readEvents()
  const stored: string = ev.integrity.envelope_hash
  assert.match(stored, /^sha256:[0-9a-f]{64}$/)
  // v1: sha256 over canonical JSON of the event with only integrity.envelope_hash removed.
  const py = spawnSync('python3', ['-c', [
    'import sys,json,hashlib',
    'ev=json.load(sys.stdin)',
    "ev['integrity'].pop('envelope_hash',None)",
    "blob=json.dumps(ev,sort_keys=True,separators=(',',':'),ensure_ascii=False)",
    "print('sha256:'+hashlib.sha256(blob.encode('utf-8')).hexdigest())",
  ].join('\n')], { input: JSON.stringify(ev), encoding: 'utf8' })
  if (py.status !== 0) { t.skip(`python3 unavailable (${py.error?.message ?? py.stderr})`); return }
  assert.equal(py.stdout.trim(), stored, 'TS and python must agree byte-for-byte on the v1 envelope_hash')
})

// ─── enforcement gauntlet (mirrors noetica_emit.py invariants) ───

test('I2 octet-reversal refused: an IP and its byte-reverse with no derivation link', () => {
  const id = emitNoeticaEvent({
    eventType: 'noetica.substrate.probe', objectId: 'net',
    severity: 'ok', kind: 'operation', tier: 'substrate',
    extra: { note: 'resolved 34.149.66.154 via PTR 154.66.149.34' },
  })
  assert.equal(id, '', 'the violating event is refused (empty id)')
  const evs = readEvents()
  const refusal = evs.find((e) => e.eventType === 'noetica.governance.violation')!
  assert.ok(refusal, 'the refusal is itself an event')
  assert.equal(refusal.payload.severity, 'bad')
  assert.equal(refusal.payload.violation, 'two_representations')
  assert.ok(!evs.some((e) => e.objectId === 'net'), 'the original op is not emitted')
})

test('I3 undeclared capability refused, fail-closed', () => {
  writeGovernanceFile('disclosure.json', { default: 'deny', capabilities: { network_egress: { status: 'allow' } } })
  const id = emitNoeticaEvent({
    eventType: 'noetica.substrate.act', objectId: 'x',
    severity: 'ok', kind: 'operation', tier: 'substrate',
    capabilities: ['exfiltrates_soul'],
  })
  assert.equal(id, '')
  assert.ok(readEvents().some((e) => e.eventType === 'noetica.governance.undisclosed_capability'))
})

test('I4 unverified actor: observed claim demoted to asserted, loudly (co-emitted receipt)', () => {
  const id = emitNoeticaEvent({
    eventType: 'noetica.feature.ok', objectId: 'local_infer',
    severity: 'ok', kind: 'operation', tier: 'telemetry',
    actor: { id: 'agent:local-7b', authority: 'unverified' },
    claims: [{ field: 'temp', value: 42, provenance: 'observed' }],
  })
  assert.notEqual(id, '')
  const evs = readEvents()
  const main = evs.find((e) => e.objectId === 'local_infer')!
  assert.equal(main.payload.claims[0].provenance, 'asserted', 'an unverified actor cannot assert observed')
  assert.equal(main.payload.claims[0].verified, false)
  assert.ok(evs.some((e) => e.eventType === 'noetica.governance.claim_demoted'), 'the demotion is receipted, not silent')
})

test('I5 unverified decision-basis refused (the 4.5 TB counter guard)', () => {
  const id = emitNoeticaEvent({
    eventType: 'noetica.substrate.report', objectId: 'bytes',
    severity: 'ok', kind: 'operation', tier: 'substrate',
    claims: [{ field: 'bytes_total', value: 4571295614478, provenance: 'derived', inputs: ['dl-1'], verified: false, decision_basis: true }],
  })
  assert.equal(id, '')
  assert.ok(readEvents().some((e) => e.payload?.violation === 'unverified_decision_basis'))
})

test('I6 derived claim without inputs refused', () => {
  const id = emitNoeticaEvent({
    eventType: 'noetica.substrate.report', objectId: 'y',
    severity: 'ok', kind: 'operation', tier: 'telemetry',
    claims: [{ field: 'x', value: 1, provenance: 'derived' }],
  })
  assert.equal(id, '')
  assert.ok(readEvents().some((e) => e.payload?.violation === 'derived_without_inputs'))
})
