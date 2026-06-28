/**
 * Pure unit tests for the agentic-surface reasoning-evidence helpers:
 *   - emitToolCallEvidence  → a conformant `tool.*` ReasoningEvent
 *   - openSubAgentRun / closeSubAgentRun → a CHILD run linked to the parent
 *
 * No ollama, no models, no network: the helpers are pure fs emitters. We point
 * SOURCEOS_REASONING_EVIDENCE at a temp dir, exercise the helpers, and validate the
 * emitted records structurally against the canonical ReasoningEvent/ReasoningRun
 * required fields + URN id patterns. Temp artifacts are cleaned up afterwards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each test runs in its own temp sink so order/parallelism can't cross-contaminate.
function withTempSink(fn: (dir: string) => Promise<void> | void) {
  const prev = process.env.SOURCEOS_REASONING_EVIDENCE
  const dir = mkdtempSync(join(tmpdir(), 'noetica-re-test-'))
  process.env.SOURCEOS_REASONING_EVIDENCE = dir
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (prev === undefined) delete process.env.SOURCEOS_REASONING_EVIDENCE
      else process.env.SOURCEOS_REASONING_EVIDENCE = prev
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    })
}

function readEvents(dir: string): Array<Record<string, unknown>> {
  const p = join(dir, 'reasoning-events.ndjson')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

// Structural conformance to the canonical ReasoningEvent contract.
function assertConformantEvent(e: Record<string, unknown>) {
  for (const k of ['id', 'type', 'specVersion', 'runRef', 'eventType', 'summary', 'traceLevel', 'trustLevel', 'capturedAt']) {
    assert.ok(k in e, `event missing required field: ${k}`)
  }
  assert.equal(e.type, 'ReasoningEvent')
  assert.equal(e.specVersion, '2.0.0')
  assert.match(String(e.id), /^urn:srcos:reasoning-event:[0-9a-f]+$/)
  assert.match(String(e.runRef), /^urn:srcos:reasoning-run:[0-9a-f]+$/)
  assert.ok(['public-safe', 'workspace-safe', 'operator-private', 'restricted'].includes(String(e.traceLevel)))
  assert.ok(['trusted-control-input', 'trusted-workspace-source', 'semi-trusted-project-source', 'untrusted-observation', 'restricted-material'].includes(String(e.trustLevel)))
  assert.ok(!isNaN(Date.parse(String(e.capturedAt))))
}

// Structural conformance to the canonical ReasoningRun contract (as persisted).
function assertConformantRun(r: Record<string, unknown>) {
  for (const k of ['id', 'type', 'specVersion', 'status', 'task', 'agentRef', 'workspaceRef', 'safeTrace', 'eventRefs', 'artifactRefs', 'startedAt']) {
    assert.ok(k in r, `run missing required field: ${k}`)
  }
  assert.equal(r.type, 'ReasoningRun')
  assert.match(String(r.id), /^urn:srcos:reasoning-run:[0-9a-f]+$/)
  const task = r.task as Record<string, unknown>
  assert.ok('id' in task && 'title' in task)
  const st = r.safeTrace as Record<string, unknown>
  assert.equal(st.mode, 'operational-trace-only')
  assert.equal(st.rawPrivateReasoning, 'not-collected')
}

test('emitToolCallEvidence: read-only tool → conformant tool.* event + evidence-only run', () => withTempSink(async (dir) => {
  const re = await import('./reasoning-evidence.js')
  re.setCurrentReasoningRun(null) // no ambient run: helper opens+closes a lightweight per-call run
  const id = re.emitToolCallEvidence('read_file')
  assert.match(id, /^urn:srcos:reasoning-event:/)

  const events = readEvents(dir)
  assert.equal(events.length, 1)
  const e = events[0]!
  assertConformantEvent(e)
  assert.equal(e.eventType, 'tool.read_file')
  assert.equal(e.trustLevel, 'trusted-control-input') // user-initiated default
  assert.match(String(e.summary), /called tool read_file/)

  // The lightweight run was opened AND closed: run.json + receipt.json on disk.
  const runDirs = readdirSync(dir).filter((d) => !d.endsWith('.ndjson'))
  assert.equal(runDirs.length, 1)
  const runDir = join(dir, runDirs[0]!)
  const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
  assertConformantRun(run)
  assert.equal(run.status, 'completed')
  const receipt = JSON.parse(readFileSync(join(runDir, 'receipt.json'), 'utf8'))
  assert.equal(receipt.type, 'ReasoningReceipt')
  assert.equal(receipt.replayClass, 'evidence-only') // read-only ⇒ observational
  assert.equal(receipt.runRef, run.id)
}))

test('emitToolCallEvidence: side-effect tool → non-replayable-side-effect receipt', () => withTempSink(async (dir) => {
  const re = await import('./reasoning-evidence.js')
  re.setCurrentReasoningRun(null)
  re.emitToolCallEvidence('run_command')
  const runDir = join(dir, readdirSync(dir).filter((d) => !d.endsWith('.ndjson'))[0]!)
  const receipt = JSON.parse(readFileSync(join(runDir, 'receipt.json'), 'utf8'))
  assert.equal(receipt.replayClass, 'non-replayable-side-effect')
}))

test('emitToolCallEvidence: secrets in detail are redacted (safe-trace)', () => withTempSink(async (dir) => {
  const re = await import('./reasoning-evidence.js')
  re.setCurrentReasoningRun(null)
  re.emitToolCallEvidence('web_search', { detail: 'token=ghp_abcdefgh12345678ZZ' })
  const e = readEvents(dir)[0]!
  assert.doesNotMatch(String(e.summary), /ghp_abcdefgh12345678ZZ/)
  assert.match(String(e.summary), /redacted/)
}))

test('emitToolCallEvidence: threads onto an ambient run when one is open', () => withTempSink(async (dir) => {
  const re = await import('./reasoning-evidence.js')
  const ambient = re.openReasoningRun('turn:test')
  re.setCurrentReasoningRun(ambient)
  re.emitToolCallEvidence('list_directory')
  re.emitToolCallEvidence('read_file')
  re.setCurrentReasoningRun(null)
  // Both events thread onto the ambient run; no per-call run dirs were created.
  assert.equal(ambient.eventRefs.length, 2)
  assert.equal(ambient.safeTrace.eventCount, 2)
  const events = readEvents(dir)
  assert.equal(events.length, 2)
  for (const e of events) {
    assertConformantEvent(e)
    assert.equal(e.runRef, ambient.id)
  }
  // No run was closed (no run.json dirs), since the helper did not own the ambient run.
  assert.equal(readdirSync(dir).filter((d) => !d.endsWith('.ndjson')).length, 0)
}))

test('openSubAgentRun/closeSubAgentRun: child run links to parent + dispatch event on parent', () => withTempSink(async (dir) => {
  const re = await import('./reasoning-evidence.js')
  const parent = re.openReasoningRun('turn:concierge')
  re.setCurrentReasoningRun(parent)

  const child = re.openSubAgentRun('researcher', 'find the spec authority files', parent)
  assert.ok(child, 'child run should be created')
  assert.match(child!.id, /^urn:srcos:reasoning-run:/)
  assert.notEqual(child!.id, parent.id)

  // Parent ↔ child linkage: child carries the parent run ref on its task AND in artifactRefs.
  assert.equal((child!.task as unknown as Record<string, unknown>).parentRunRef, parent.id)
  assert.ok(child!.artifactRefs.includes(parent.id))

  // A `subagent.dispatch` event was emitted on the PARENT referencing the child run.
  const dispatch = readEvents(dir).find((e) => e.eventType === 'subagent.dispatch')
  assert.ok(dispatch, 'subagent.dispatch event must be emitted on the parent')
  assertConformantEvent(dispatch!)
  assert.equal(dispatch!.runRef, parent.id)
  assert.equal(dispatch!.childRunRef, child!.id)

  // Closing the child writes a best-effort receipt and persists the linked run.
  re.closeSubAgentRun(child, { status: 'completed' })
  re.setCurrentReasoningRun(null)

  // Find the child's persisted dir (its run.json id === child id).
  const runDirs = readdirSync(dir).filter((d) => !d.endsWith('.ndjson'))
  let foundChild = false
  for (const d of runDirs) {
    const run = JSON.parse(readFileSync(join(dir, d, 'run.json'), 'utf8'))
    if (run.id === child!.id) {
      foundChild = true
      assertConformantRun(run)
      assert.equal(run.status, 'completed')
      assert.equal((run.task as unknown as Record<string, unknown>).parentRunRef, parent.id)
      const receipt = JSON.parse(readFileSync(join(dir, d, 'receipt.json'), 'utf8'))
      assert.equal(receipt.replayClass, 'best-effort') // sub-agents GENERATE
      assert.equal(receipt.runRef, child!.id)
    }
  }
  assert.ok(foundChild, 'child run must be persisted with parent linkage')
}))

test('closeSubAgentRun tolerates a null child (evidence-disabled no-op)', () => withTempSink(async () => {
  const re = await import('./reasoning-evidence.js')
  assert.doesNotThrow(() => re.closeSubAgentRun(null))
}))
