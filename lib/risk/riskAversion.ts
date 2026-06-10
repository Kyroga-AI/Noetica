export type RiskAversionDimension =
  | 'liability_risk'
  | 'attribution_risk'
  | 'defamation_risk'
  | 'privacy_risk'
  | 'platform_abuse_risk'
  | 'reputational_risk'
  | 'evidence_quality_risk'
  | 'medical_legal_financial_risk'
  | 'self_harm_or_violence_risk'
  | 'security_misuse_risk'
  | 'model_uncertainty_risk'

export type RiskSteeringMode =
  | 'direct_answer'
  | 'qualify_causality'
  | 'request_more_evidence'
  | 'avoid_attribution'
  | 'separate_proof_from_hypothesis'
  | 'shift_to_hazard_model'
  | 'refuse_or_boundary'
  | 'artifact_production'
  | 'counterfactual_replay'
  | 'safe_redirect'

export type RiskDimensionScore = {
  dimension: RiskAversionDimension
  score: number
  evidenceTerms: string[]
}

export type RiskAversionVector = {
  schemaVersion: 'noetica.risk_aversion.vector.v0.1'
  aggregateScore: number
  dimensions: RiskDimensionScore[]
}

export type DeflectionDelta = {
  schemaVersion: 'noetica.deflection_delta.v0.1'
  directnessDelta: number
  cautionDelta: number
  evidenceDemandDelta: number
  attributionSuppressionDelta: number
  hypothesisReframingDelta: number
  artifactHelpfulnessDelta: number
}

export type NoeticaOutcomeImpact =
  | 'investigation_accelerated'
  | 'investigation_preserved'
  | 'investigation_reframed'
  | 'investigation_delayed'
  | 'investigation_blocked'
  | 'unknown'

export type NoeticaOutcomeCard = {
  schemaVersion: 'noetica.outcome_card.v0.1'
  observedOutcome: string
  potentialBenefit: string
  potentialHarm: string
  evidenceStrength: 'low' | 'medium' | 'high'
  reproducibility: 'untested' | 'single_case' | 'counterfactual_replay_ready' | 'replicated'
  recommendedNextAction: string
  impact: NoeticaOutcomeImpact
}

export type TurnRiskTrace = {
  schemaVersion: 'noetica.turn_risk_trace.v0.1'
  turnId: string
  occurredAt?: string
  inputTextHash?: string | null
  responseTextHash?: string | null
  riskVector: RiskAversionVector
  observedSteeringModes: RiskSteeringMode[]
  deflectionDelta: DeflectionDelta
  outcomeCard: NoeticaOutcomeCard
  evidenceRefs: string[]
  runtimeEventRefs: string[]
  notes?: string[]
}

export type RiskAversionCorpus = {
  schemaVersion: 'noetica.risk_aversion_corpus.v0.1'
  corpusId: string
  title: string
  description: string
  turns: TurnRiskTrace[]
}

export const RISK_AVERSION_DIMENSIONS: RiskAversionDimension[] = [
  'liability_risk',
  'attribution_risk',
  'defamation_risk',
  'privacy_risk',
  'platform_abuse_risk',
  'reputational_risk',
  'evidence_quality_risk',
  'medical_legal_financial_risk',
  'self_harm_or_violence_risk',
  'security_misuse_risk',
  'model_uncertainty_risk'
]

export const RISK_STEERING_MODES: RiskSteeringMode[] = [
  'direct_answer',
  'qualify_causality',
  'request_more_evidence',
  'avoid_attribution',
  'separate_proof_from_hypothesis',
  'shift_to_hazard_model',
  'refuse_or_boundary',
  'artifact_production',
  'counterfactual_replay',
  'safe_redirect'
]
