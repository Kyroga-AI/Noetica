#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CHAT_COMPLETION_FIXTURE = 'tests/fixtures/sourceos-interaction/noetica-chat-completion-via-transport.interaction.json'

async function main() {
  const event = JSON.parse(await readFile(CHAT_COMPLETION_FIXTURE, 'utf8'))
  validateRiskObservatoryRefs(event, CHAT_COMPLETION_FIXTURE)

  console.log(JSON.stringify({
    ok: true,
    validated: CHAT_COMPLETION_FIXTURE,
    riskAversionTraceRef: event.payload.riskAversionTraceRef,
    outcomeObservatoryRef: event.payload.outcomeObservatoryRef,
    counterfactualReplayRef: event.payload.counterfactualReplayRef
  }, null, 2))
}

export function validateRiskObservatoryRefs(event, sourcePath) {
  assert(event.payloadMode === 'summary', `${sourcePath}: expected summary payloadMode`)
  assert(event.payload && typeof event.payload === 'object', `${sourcePath}: missing payload`)

  const payload = event.payload
  assertUrn(payload.outcomeObservatoryRef, 'urn:noetica:outcome-observatory:', `${sourcePath}: payload.outcomeObservatoryRef`)
  assert(payload.riskAssessmentVersion === 'noetica.turn_risk_trace.v0.1', `${sourcePath}: invalid riskAssessmentVersion`)
  assertUrn(payload.riskAversionTraceRef, 'urn:noetica:risk-trace:', `${sourcePath}: payload.riskAversionTraceRef`)
  assert(nonEmpty(payload.riskAversionTracePath), `${sourcePath}: missing riskAversionTracePath`)
  assertSha256(payload.riskAversionTraceHash, `${sourcePath}: invalid riskAversionTraceHash`)
  assertUrn(payload.counterfactualReplayRef, 'urn:noetica:counterfactual-replay:', `${sourcePath}: payload.counterfactualReplayRef`)

  assert(event.steeringIntent?.featureRef === payload.riskAversionTraceRef, `${sourcePath}: steeringIntent.featureRef must match payload.riskAversionTraceRef`)
  assert(typeof event.steeringIntent?.strength === 'number', `${sourcePath}: steeringIntent.strength must be numeric risk pressure`)
  assert(event.governanceTrace?.evidenceRefs?.includes(payload.riskAversionTraceRef), `${sourcePath}: governanceTrace.evidenceRefs must include riskAversionTraceRef`)
  assert(event.governanceTrace?.replayRef === payload.counterfactualReplayRef, `${sourcePath}: governanceTrace.replayRef must match payload.counterfactualReplayRef`)
  assert(event.sourceEventRefs?.includes(payload.riskAversionTraceRef), `${sourcePath}: sourceEventRefs must include riskAversionTraceRef`)
}

function assertUrn(value, prefix, label) {
  assert(typeof value === 'string' && value.startsWith(prefix), `${label} must start with ${prefix}`)
}

function assertSha256(value, label) {
  assert(typeof value === 'string' && value.startsWith('sha256:'), label)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
