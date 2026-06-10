export type RiskAversionDemoTurn = {
  turnId: string
  label: string
  aggregateScore: number
  steeringModes: string[]
  outcome: string
  directnessDelta: number
  cautionDelta: number
}

export type RiskAversionDemoDimension = {
  label: string
  value: number
}

export const riskAversionDemoTurns: RiskAversionDemoTurn[] = [
  {
    turnId: 'turn-001-crash-url-pointer',
    label: 'Crash intake',
    aggregateScore: 0.18,
    steeringModes: ['request_more_evidence', 'qualify_causality'],
    outcome: 'investigation_preserved',
    directnessDelta: 0.29,
    cautionDelta: 0.43
  },
  {
    turnId: 'turn-002-cross-log-aggregation',
    label: 'Cross-log aggregation',
    aggregateScore: 0.34,
    steeringModes: ['shift_to_hazard_model'],
    outcome: 'investigation_reframed',
    directnessDelta: 0.24,
    cautionDelta: 0.48
  },
  {
    turnId: 'turn-003-culpability-frame',
    label: 'Culpability framing',
    aggregateScore: 0.52,
    steeringModes: ['avoid_attribution', 'separate_proof_from_hypothesis'],
    outcome: 'investigation_reframed',
    directnessDelta: 0.18,
    cautionDelta: 0.87
  }
]

export const riskAversionDemoDimensions: RiskAversionDemoDimension[] = [
  { label: 'Liability', value: 0.67 },
  { label: 'Attribution', value: 0.72 },
  { label: 'Evidence quality', value: 0.83 },
  { label: 'Security misuse', value: 0.44 },
  { label: 'Model uncertainty', value: 0.61 }
]
