/** Tests for the local-model + scope-d self-hardening capability (pure parts + orchestration via fake model). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewPrompt, parseFindings, summarize, reviewCode, VULN_CLASSES } from './security-review.js'

test('buildReviewPrompt lists all vuln classes + demands JSON', () => {
  const p = buildReviewPrompt('const x = 1', { subject: 'foo.ts' })
  for (const v of VULN_CLASSES) assert.ok(p.includes(v.id))
  assert.ok(p.includes('STRICT JSON') && p.includes('foo.ts'))
})

test('parseFindings extracts + validates JSON, tolerates prose, clamps bad fields', () => {
  const out = 'Here are the issues:\n[{"severity":"critical","vulnClass":"xss","detail":"innerHTML","line":42,"fix":"escape"},{"severity":"bogus","vulnClass":"made-up","detail":"x"}]\nThat is all.'
  const f = parseFindings(out)
  assert.equal(f.length, 2)
  assert.equal(f[0]!.severity, 'critical'); assert.equal(f[0]!.vulnClass, 'xss'); assert.equal(f[0]!.line, 42)
  assert.equal(f[1]!.severity, 'medium', 'invalid severity → medium')
  assert.equal(f[1]!.vulnClass, 'unknown', 'invalid class → unknown')
  assert.deepEqual(parseFindings('no json here'), [])
  assert.deepEqual(parseFindings('[]'), [], 'clean → empty')
})

test('summarize counts + passed gate (no critical/high = passed)', () => {
  assert.equal(summarize([{ severity: 'medium', vulnClass: 'x', detail: 'd' }]).passed, true)
  assert.equal(summarize([{ severity: 'critical', vulnClass: 'x', detail: 'd' }]).passed, false)
  const s = summarize([{ severity: 'high', vulnClass: 'a', detail: 'd' }, { severity: 'low', vulnClass: 'b', detail: 'd' }])
  assert.equal(s.high, 1); assert.equal(s.low, 1); assert.equal(s.total, 2); assert.equal(s.passed, false)
})

test('reviewCode runs on an injected (local) model + returns structured result', async () => {
  const fakeModel = async () => '[{"severity":"high","vulnClass":"path-traversal","detail":"unvalidated path","fix":"realpath+allowlist"}]'
  const r = await reviewCode('fs.readFileSync(userPath)', { generate: fakeModel, model: 'qwen2.5:7b' })
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0]!.vulnClass, 'path-traversal')
  assert.equal(r.summary.passed, false, 'a high finding fails the gate')
  assert.equal(r.model, 'qwen2.5:7b')
})
