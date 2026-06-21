import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Self-contained EngagementPolicy fixture (shape per scope-d engagement-policy.schema.json):
// authorizes only a local lab target; third-party-services are out-of-scope → any cloud
// LLM egress must be denied and routed back to local.
const POLICY_PATH = path.join(os.tmpdir(), 'scope-d-test-policy.json')
fs.writeFileSync(POLICY_PATH, JSON.stringify({
  policyId: 'engagement-policy-test-lab',
  name: 'test lab policy',
  targetBoundary: { authorizedTargets: ['local-lab'], outOfScopeTargets: ['third-party-services', 'public-internet'] },
  authorizedTargets: ['local-lab'],
  authorizedModes: ['synthetic_only'],
  approvalRules: [{ actionClass: 'network_call', requiredGate: 'human_and_policy_engine' }],
  expiresAt: '2099-12-31T23:59:59Z',
}))
process.env['SCOPED_ENGAGEMENT_POLICY'] = POLICY_PATH
process.env['SCOPED_EVENTS'] = path.join(os.tmpdir(), 'scope-d-test-events.jsonl')
const load = () => import('./scope-d.js')

test('scope-d: configured when an engagement policy is set', async () => {
  const { scopedConfigured } = await load()
  assert.equal(scopedConfigured(), true)
})

test('scope-d: local routes are never gated', async () => {
  const { checkEgress } = await load()
  const v = checkEgress({ scope: 'CITIZEN_FOG', tier: 'local', provider: 'ollama', model: 'qwen2.5:7b', target: 'localhost' })
  assert.equal(v.allow, true)
})

test('scope-d: cloud egress DENIED when target is out-of-scope (third-party) → route down to local', async () => {
  const { checkEgress } = await load()
  const v = checkEgress({ scope: 'CITIZEN_FOG', tier: 'frontier', provider: 'anthropic', model: 'claude-sonnet-4-6', target: 'api.anthropic.com' })
  assert.equal(v.allow, false)
  assert.equal(v.downgradeTo, 'local')
  assert.equal(v.source, 'scope-d')
})

test('scope-d: FAILS CLOSED when the policy becomes unreadable', async () => {
  const { checkEgress } = await load()
  fs.rmSync(POLICY_PATH, { force: true })   // policy vanishes mid-engagement
  const v = checkEgress({ scope: 'CITIZEN_FOG', tier: 'frontier', provider: 'openai', model: 'gpt-4o', target: 'api.openai.com' })
  assert.equal(v.allow, false)
  assert.equal(v.source, 'fail-closed')
})
