#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'

const ACCEPTED = 'examples/risk-aversion/chatgpt-crash-corpus.accepted.json'
const REJECTED = 'examples/risk-aversion/chatgpt-crash-corpus.rejected.json'

async function main() {
  const accepted = JSON.parse(await readFile(ACCEPTED, 'utf8'))
  validateCorpus(accepted)

  const scored = accepted.turns.map((turn) => scoreRiskAversionTurn({
    turnId: turn.turnId,
    userText: turn.userText,
    assistantText: turn.assistantText,
    evidenceRefs: turn.evidenceRefs,
    runtimeEventRefs: turn.runtimeEventRefs
  }))

  assert(scored.length === 3, 'accepted fixture should produce three scored turns')
  assert(scored[2].riskVector.aggregateScore > scored[0].riskVector.aggregateScore, 'culpability turn should score higher than intake turn')
  assert(scored[2].observedSteeringModes.includes('separate_proof_from_hypothesis'), 'culpability turn should detect proof/hypothesis separation')
  assert(scored[1].observedSteeringModes.includes('shift_to_hazard_model'), 'cross-log turn should detect hazard-model steering')

  const rejected = JSON.parse(await readFile(REJECTED, 'utf8'))
  let rejectedFailed = false
  try {
    validateCorpus(rejected)
  } catch {
    rejectedFailed = true
  }
  assert(rejectedFailed, 'rejected fixture should fail validation')

  console.log(JSON.stringify({
    ok: true,
    validated: [ACCEPTED, REJECTED],
    scoredTurns: scored.map((turn) => ({
      turnId: turn.turnId,
      aggregateScore: turn.riskVector.aggregateScore,
      observedSteeringModes: turn.observedSteeringModes,
      impact: turn.outcomeCard.impact
    }))
  }, null, 2))
}

export function validateCorpus(corpus) {
  assert(corpus.schemaVersion === 'noetica.risk_aversion_corpus.v0.1', 'invalid or missing schemaVersion')
  assert(nonEmpty(corpus.corpusId), 'missing corpusId')
  assert(nonEmpty(corpus.title), 'missing title')
  assert(Array.isArray(corpus.turns) && corpus.turns.length > 0, 'missing turns')

  for (const turn of corpus.turns) {
    assert(nonEmpty(turn.turnId), 'turn missing turnId')
    assert(typeof turn.userText === 'string', `turn ${turn.turnId} missing userText`)
    assert(typeof turn.assistantText === 'string', `turn ${turn.turnId} missing assistantText`)
    assert(Array.isArray(turn.evidenceRefs), `turn ${turn.turnId} missing evidenceRefs`)
    assert(Array.isArray(turn.runtimeEventRefs), `turn ${turn.turnId} missing runtimeEventRefs`)
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
