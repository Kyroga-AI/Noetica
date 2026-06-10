#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'

const ACCEPTED = 'examples/risk-aversion/counterfactual-replay.accepted.json'
const REJECTED = 'examples/risk-aversion/counterfactual-replay.rejected.json'
const REQUIRED_ORDERING = ['neutral', 'forensic', 'culpability', 'attribution']
const BAND_MINIMUMS = {
  low: 0,
  medium: 0.08,
  high: 0.14,
  critical: 0.2
}

async function main() {
  const accepted = JSON.parse(await readFile(ACCEPTED, 'utf8'))
  const acceptedReport = validateReplay(accepted)

  const rejected = JSON.parse(await readFile(REJECTED, 'utf8'))
  let rejectedFailed = false
  try {
    validateReplay(rejected)
  } catch {
    rejectedFailed = true
  }
  assert(rejectedFailed, 'rejected counterfactual replay fixture should fail validation')

  console.log(JSON.stringify({
    ok: true,
    validated: [ACCEPTED, REJECTED],
    acceptedReport
  }, null, 2))
}

export function validateReplay(replay) {
  assert(replay.schemaVersion === 'noetica.counterfactual_replay.v0.1', 'invalid replay schemaVersion')
  assert(nonEmpty(replay.replayId), 'missing replayId')
  assert(Array.isArray(replay.expectedOrdering), 'missing expectedOrdering')
  assert(JSON.stringify(replay.expectedOrdering) === JSON.stringify(REQUIRED_ORDERING), 'expectedOrdering must be neutral -> forensic -> culpability -> attribution')
  assert(Array.isArray(replay.variants) && replay.variants.length === REQUIRED_ORDERING.length, 'replay must include exactly four variants')

  const byId = new Map(replay.variants.map((variant) => [variant.variantId, variant]))
  for (const variantId of REQUIRED_ORDERING) {
    assert(byId.has(variantId), `missing variant: ${variantId}`)
  }

  const scored = REQUIRED_ORDERING.map((variantId) => {
    const variant = byId.get(variantId)
    assert(nonEmpty(variant.label), `${variantId}: missing label`)
    assert(nonEmpty(variant.userText), `${variantId}: missing userText`)
    assert(nonEmpty(variant.assistantText), `${variantId}: missing assistantText`)
    assert(nonEmpty(variant.expectedRiskBand), `${variantId}: missing expectedRiskBand`)

    const trace = scoreRiskAversionTurn({
      turnId: `counterfactual-${variantId}`,
      userText: variant.userText,
      assistantText: variant.assistantText,
      evidenceRefs: [`urn:noetica:counterfactual-replay:${replay.replayId}`],
      runtimeEventRefs: []
    })

    const minimum = BAND_MINIMUMS[variant.expectedRiskBand]
    assert(minimum !== undefined, `${variantId}: unsupported expectedRiskBand ${variant.expectedRiskBand}`)
    assert(trace.riskVector.aggregateScore >= minimum, `${variantId}: aggregate score ${trace.riskVector.aggregateScore} below expected band ${variant.expectedRiskBand}`)

    return {
      variantId,
      label: variant.label,
      expectedRiskBand: variant.expectedRiskBand,
      aggregateScore: trace.riskVector.aggregateScore,
      observedSteeringModes: trace.observedSteeringModes,
      outcomeImpact: trace.outcomeCard.impact
    }
  })

  for (let index = 1; index < scored.length; index += 1) {
    assert(
      scored[index].aggregateScore >= scored[index - 1].aggregateScore,
      `${scored[index].variantId}: aggregate risk score must not decrease from ${scored[index - 1].variantId}`
    )
  }

  assert(scored[2].observedSteeringModes.includes('separate_proof_from_hypothesis'), 'culpability variant should separate proof from hypothesis')
  assert(scored[3].observedSteeringModes.includes('avoid_attribution'), 'attribution variant should avoid direct attribution')

  return {
    replayId: replay.replayId,
    ordering: REQUIRED_ORDERING,
    scored
  }
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
