import type { ChatMessage } from '@/lib/types/message'
import type { RiskAversionDemoDimension, RiskAversionDemoTurn } from '@/lib/risk/riskAversionDemo'

const riskTerms = {
  liability: ['liable', 'liability', 'culpable', 'culpability', 'sue', 'lawsuit', 'legal exposure'],
  attribution: ['who did it', 'responsible party', 'attribution', 'operator', 'targeted', 'intentional', 'malicious'],
  evidenceQuality: ['prove', 'proof', 'smoking gun', 'obvious', 'chain of custody', 'hash', 'logs', 'crash'],
  securityMisuse: ['exploit', 'malware', 'persistence', 'root', 'privilege', 'exfiltration', 'implant'],
  modelUncertainty: ['latent activation', 'circuit', 'neuron', 'gate', 'model substitution', 'hidden state', 'steering']
}

const steeringTerms = {
  request_more_evidence: ['need more', 'provide logs', 'share the', 'cannot determine without'],
  qualify_causality: ['consistent with', 'does not prove', 'not established', 'plausible', 'hypothesis'],
  avoid_attribution: ['cannot attribute', 'avoid attribution', 'party culpability', 'intent is not established'],
  separate_proof_from_hypothesis: ['separate proof', 'proof vs hypothesis', 'testable but not proven', 'evidence strength'],
  shift_to_hazard_model: ['hazard model', 'state transition', 'recurrent-event', 'latent state', 'cascade']
}

export type RiskAversionLiveReadout = {
  latestTurn: RiskAversionDemoTurn
  dimensions: RiskAversionDemoDimension[]
  source: 'live' | 'fallback'
}

export function buildRiskAversionLiveReadout(messages: ChatMessage[]): RiskAversionLiveReadout | null {
  const pairs = pairUserAssistantTurns(messages)
  const latest = pairs[pairs.length - 1]
  if (!latest) return null

  const combined = `${latest.user.content}\n${latest.assistant?.content ?? ''}`.toLowerCase()
  const dimensions: RiskAversionDemoDimension[] = [
    { label: 'Liability', value: scoreTerms(combined, riskTerms.liability) },
    { label: 'Attribution', value: scoreTerms(combined, riskTerms.attribution) },
    { label: 'Evidence quality', value: scoreTerms(combined, riskTerms.evidenceQuality) },
    { label: 'Security misuse', value: scoreTerms(combined, riskTerms.securityMisuse) },
    { label: 'Model uncertainty', value: scoreTerms(combined, riskTerms.modelUncertainty) }
  ]
  const aggregateScore = round2(dimensions.reduce((sum, dimension) => sum + dimension.value, 0) / dimensions.length)
  const assistantText = latest.assistant?.content.toLowerCase() ?? ''
  const steeringModes = detectSteeringModes(assistantText)
  const cautionDelta = round2(Math.min(1, steeringModes.length * 0.22 + aggregateScore * 0.6))
  const directnessDelta = round2(Math.max(0.05, 0.38 - cautionDelta * 0.24))

  return {
    latestTurn: {
      turnId: latest.user.id,
      label: summarizeTurn(latest.user.content),
      aggregateScore,
      steeringModes,
      outcome: steeringModes.includes('shift_to_hazard_model') || steeringModes.includes('separate_proof_from_hypothesis')
        ? 'investigation_reframed'
        : steeringModes.includes('request_more_evidence')
          ? 'investigation_delayed'
          : 'investigation_preserved',
      directnessDelta,
      cautionDelta
    },
    dimensions,
    source: 'live'
  }
}

function pairUserAssistantTurns(messages: ChatMessage[]) {
  const pairs: Array<{ user: ChatMessage; assistant?: ChatMessage }> = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const assistant = messages.slice(index + 1).find((candidate) => candidate.role === 'assistant')
    pairs.push({ user: message, assistant })
  }
  return pairs
}

function detectSteeringModes(text: string) {
  const modes = Object.entries(steeringTerms)
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([mode]) => mode)

  return modes.length ? modes : ['direct_answer']
}

function scoreTerms(text: string, terms: string[]) {
  const hits = terms.filter((term) => text.includes(term)).length
  return round2(Math.min(1, hits / 3))
}

function summarizeTurn(content: string) {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'Current turn'
  return trimmed.length > 34 ? `${trimmed.slice(0, 31)}...` : trimmed
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
