import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEgressAudit, toCsv, type EgressRun } from './egressAudit.js'

const runs: EgressRun[] = [
  { run_id: 'r1', provider: 'ollama', model_routed: 'qwen2.5-coder', timestamp: '2026-06-21T10:00:00Z', tokens_egressed: 0, cost_usd: 0, policy_admitted: true },
  { run_id: 'r2', provider: 'anthropic', model_routed: 'claude-opus', timestamp: '2026-06-21T11:00:00Z', tokens_egressed: 1200, cost_usd: 0.03, policy_admitted: true },
  { run_id: 'r3', provider: 'noetica', model_routed: 'concierge', timestamp: '2026-06-21T12:00:00Z', tokens_egressed: 0, policy_admitted: true },
  { run_id: 'r4', provider: 'openai', model_routed: 'gpt-5', timestamp: '2026-06-21T13:00:00Z', tokens_egressed: 800, cost_usd: 0.01, policy_admitted: false },
]

test('buildEgressAudit summarizes sovereignty + lists only egress runs', () => {
  const a = buildEgressAudit(runs)
  assert.equal(a.summary.total_runs, 4)
  assert.equal(a.summary.sovereign_runs, 2)        // ollama + noetica
  assert.equal(a.summary.egress_runs, 2)           // anthropic + openai
  assert.equal(a.summary.total_tokens_egressed, 2000)
  assert.equal(a.summary.sovereignty_pct, 50)
  // rows are only the egress runs, newest first
  assert.deepEqual(a.rows.map((r) => r.run_id), ['r4', 'r2'])
  assert.equal(a.rows[0]!.policy, 'denied')        // openai was policy-denied
  assert.equal(a.rows[1]!.provider, 'anthropic')
})

test('all-local → 100% sovereign, no egress rows', () => {
  const a = buildEgressAudit([runs[0]!, runs[2]!])
  assert.equal(a.summary.sovereignty_pct, 100)
  assert.equal(a.rows.length, 0)
})

test('toCsv emits header + a row per egress run, escaping', () => {
  const csv = toCsv(buildEgressAudit(runs))
  const lines = csv.split('\n')
  assert.equal(lines[0], 'when,provider,model,tokens_egressed,cost_usd,policy,run_id')
  assert.equal(lines.length, 3)                    // header + 2 egress rows
  assert.match(lines[1]!, /anthropic|openai/)
})

test('empty ring → 100% sovereign', () => {
  assert.equal(buildEgressAudit([]).summary.sovereignty_pct, 100)
})
