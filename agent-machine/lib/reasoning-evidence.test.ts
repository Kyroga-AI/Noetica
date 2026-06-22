/**
 * reasoning-evidence.test — conformance of emitted ReasoningRun/Event/Receipt against
 * the CANONICAL SourceOS schemas. No new dep: structural validation (required fields,
 * `type` consts, URN id-prefix patterns, enum membership) derived from the real schema
 * files when present, with a graceful skip when the spec dir is absent (CI without spec).
 * Writes to a temp SOURCEOS_REASONING_EVIDENCE so it never pollutes ~/.noetica.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SPEC_DIR = '/Users/michaelheller/dev/sourceos-spec/schemas'

// Route emission to a throwaway sink for the whole test file. Set BEFORE importing the
// module — the module reads SOURCEOS_REASONING_EVIDENCE lazily per call, so a static
// import below still observes this. (sink path is resolved at call time, not import time.)
const SINK = mkdtempSync(join(tmpdir(), 'noetica-reasoning-'))
process.env.SOURCEOS_REASONING_EVIDENCE = SINK

import * as re from './reasoning-evidence.js'

function loadSchema(name: string): any | null {
  const p = join(SPEC_DIR, name)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/** Tiny structural validator: required present, type consts, id pattern, enum membership. */
function structuralCheck(obj: any, schema: any, label: string): void {
  for (const req of schema.required ?? []) {
    assert.ok(obj[req] !== undefined, `${label}: missing required field "${req}"`)
  }
  for (const [key, def] of Object.entries<any>(schema.properties ?? {})) {
    if (obj[key] === undefined) continue
    if (def.const !== undefined) assert.equal(obj[key], def.const, `${label}.${key} must be const "${def.const}"`)
    if (Array.isArray(def.enum)) assert.ok(def.enum.includes(obj[key]), `${label}.${key}="${obj[key]}" not in enum`)
    if (typeof def.pattern === 'string') assert.match(String(obj[key]), new RegExp(def.pattern), `${label}.${key} fails pattern ${def.pattern}`)
  }
}

test('openReasoningRun → emit (computed+generated) → close conforms to canonical schemas', () => {
  const runSchema = loadSchema('ReasoningRun.json')
  const eventSchema = loadSchema('ReasoningEvent.json')
  const receiptSchema = loadSchema('ReasoningReceipt.json')

  const run = re.openReasoningRun('turn:demo_intent')

  // Run shape (independent of spec presence).
  assert.equal(run.type, 'ReasoningRun')
  assert.match(run.id, /^urn:srcos:reasoning-run:/)
  assert.equal(run.specVersion, '2.0.0')
  assert.equal(run.status, 'running')
  assert.match(run.task.id, /^urn:srcos:reasoning-task:/)
  assert.equal(run.safeTrace.mode, 'operational-trace-only')
  assert.equal(run.safeTrace.rawPrivateReasoning, 'not-collected')

  const e1 = re.emitReasoningEvent(run, { eventType: 'noetica.turn', summary: 'intent=demo computed(extractive) 12ms', trustLevel: 'trusted-workspace-source' })
  const e2 = re.emitReasoningEvent(run, { eventType: 'noetica.turn', summary: 'intent=demo generated(ollama) 800ms', trustLevel: 'semi-trusted-project-source' })
  assert.match(e1, /^urn:srcos:reasoning-event:/)
  assert.match(e2, /^urn:srcos:reasoning-event:/)
  assert.equal(run.eventRefs.length, 2)
  assert.equal(run.safeTrace.eventCount, 2)

  // The streamed NDJSON event conforms.
  const ndjson = readFileSync(join(SINK, 'reasoning-events.ndjson'), 'utf8').trim().split('\n')
  const event = JSON.parse(ndjson[0]!)
  assert.equal(event.type, 'ReasoningEvent')
  assert.equal(event.runRef, run.id)
  assert.ok(['public-safe', 'workspace-safe', 'operator-private', 'restricted'].includes(event.traceLevel))
  assert.ok(['trusted-control-input', 'trusted-workspace-source', 'semi-trusted-project-source', 'untrusted-observation', 'restricted-material'].includes(event.trustLevel))

  const receipt = re.closeReasoningRun(run, { status: 'completed', replayClass: 'exact', ledgerRef: 'urn:srcos:ledger:dispatch:abc123' })
  assert.equal(receipt.type, 'ReasoningReceipt')
  assert.match(receipt.id, /^urn:srcos:receipt:reasoning:/)
  assert.match(receipt.traceHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(receipt.replayClass, 'exact')
  assert.equal(receipt.runRef, run.id)
  assert.ok(run.artifactRefs.includes('urn:srcos:ledger:dispatch:abc123'), 'ledgerRef threaded into run.artifactRefs')

  // Persisted run.json + receipt.json conform to the REAL schemas (or structural check).
  const runHex = run.id.replace('urn:srcos:reasoning-run:', '')
  const runOut = JSON.parse(readFileSync(join(SINK, runHex, 'run.json'), 'utf8'))
  const receiptOut = JSON.parse(readFileSync(join(SINK, runHex, 'receipt.json'), 'utf8'))
  assert.equal(runOut.status, 'completed')
  assert.equal(runOut._runHex, undefined, 'private bookkeeping field must not be persisted')

  if (runSchema && eventSchema && receiptSchema) {
    structuralCheck(runOut, runSchema, 'ReasoningRun')
    structuralCheck(event, eventSchema, 'ReasoningEvent')
    structuralCheck(receiptOut, receiptSchema, 'ReasoningReceipt')
  } else {
    console.warn('[reasoning-evidence.test] spec dir absent — schema-file validation skipped (structural inline asserts still ran)')
  }
})

test('classifyReplay: computed → exact, generated → best-effort', () => {
  assert.equal(re.classifyReplay({ method: 'recall', decidable: true }), 'exact')
  assert.equal(re.classifyReplay({ method: 'compute' }), 'exact')
  assert.equal(re.classifyReplay({ method: 'extractive' }), 'exact')
  assert.equal(re.classifyReplay({ stop_reason: 'extractive' }), 'exact')
  assert.equal(re.classifyReplay({ decidable: true }), 'exact')
  assert.equal(re.classifyReplay({ method: 'qwen2.5:7b', stop_reason: 'end_turn' }), 'best-effort')
  assert.equal(re.classifyReplay({ model_routed: 'claude-haiku-4-5' }), 'best-effort')
})

test('replayClass exact vs best-effort produce the matching receipts', () => {
  const exactRun = re.openReasoningRun('turn:computed')
  re.emitReasoningEvent(exactRun, { eventType: 'noetica.turn', summary: 'computed', trustLevel: 'trusted-workspace-source' })
  const exactReceipt = re.closeReasoningRun(exactRun, { status: 'completed', replayClass: re.classifyReplay({ method: 'extractive', decidable: true }) })
  assert.equal(exactReceipt.replayClass, 'exact')

  const genRun = re.openReasoningRun('turn:generated')
  re.emitReasoningEvent(genRun, { eventType: 'noetica.turn', summary: 'generated', trustLevel: 'semi-trusted-project-source' })
  const genReceipt = re.closeReasoningRun(genRun, { status: 'completed', replayClass: re.classifyReplay({ method: 'qwen2.5:7b', stop_reason: 'end_turn' }) })
  assert.equal(genReceipt.replayClass, 'best-effort')
})

test('summaries redact obvious secrets (safe-trace hygiene)', () => {
  const run = re.openReasoningRun('turn:secret')
  re.emitReasoningEvent(run, { eventType: 'noetica.turn', summary: 'used token sk-abcdefghijklmnop1234', trustLevel: 'semi-trusted-project-source' })
  const lines = readFileSync(join(SINK, 'reasoning-events.ndjson'), 'utf8').trim().split('\n')
  const last = JSON.parse(lines[lines.length - 1]!)
  assert.ok(!/sk-abcdefghijklmnop1234/.test(last.summary), 'secret must be redacted from summary')
  assert.match(last.summary, /\[redacted\]/)
  re.closeReasoningRun(run, { status: 'completed', replayClass: 'best-effort' })
})

test.after(() => { try { rmSync(SINK, { recursive: true, force: true }) } catch { /* cleanup best-effort */ } })
