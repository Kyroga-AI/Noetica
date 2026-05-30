import { evidenceHash, type EvidencePayload } from '@/lib/evidence/hash'
import type { ExternalModelProviderRouteEvidence } from '@/lib/types/agentplane'
import type { SourceOSInteractionEvent, SourceOSSteeringKind, SourceOSSteeringStatus } from '@/lib/types/sourceos-interaction'
import type { GrantResolutionRefs, NoeticaTaskMode, NoeticaTaskResult, NoeticaTaskStatus } from '@/lib/types/task'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

const SPEC_VERSION = '2.0.0'
const NOETICA_ACTOR_REF = 'urn:srcos:agent:noetica'
const NOETICA_AGENT_REGISTRY_REF = 'urn:srcos:agent-registry:noetica'

export interface BuildInteractionBaseInput {
  sessionId: string
  mode: NoeticaTaskMode
  actorRef?: string
  workroomRef?: string | null
  topicRef?: string | null
  conversationRef?: string | null
  threadRef?: string | null
  occurredAt?: string
}

export interface BuildStandaloneInteractionInput extends BuildInteractionBaseInput {
  eventClass?: 'interaction.task_submitted' | 'interaction.task_completed' | 'interaction.task_failed' | 'interaction.governance_trace'
  runId: string
  modelHint?: string | null
  modelRouted: string
  provider: string
  latencyMs: number
  policyAdmitted: boolean
  policyRef?: string | null
  grantRefs?: string[]
  memoryScopeRef?: string | null
  memoryWritten: boolean
  requestHash?: string | null
  evidenceHashValue?: string | null
  providerRouteEvidence?: ExternalModelProviderRouteEvidence
  evidenceRefs?: string[]
  replayRef?: string | null
  steeringConfig?: SteeringConfig
  steeringResult?: SteeringResult
  status?: 'submitted' | 'streaming' | 'success' | 'failure' | 'blocked' | 'unavailable' | 'not_configured'
  payloadSummary?: string
}

export interface BuildSourceOSTaskInteractionInput extends BuildInteractionBaseInput {
  result: NoeticaTaskResult
  modelHint?: string | null
  steeringConfig?: SteeringConfig
  payloadSummary?: string
}

export function buildStandaloneInteractionEvent(input: BuildStandaloneInteractionInput): SourceOSInteractionEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const status = input.status ?? (input.policyAdmitted ? 'success' : 'blocked')
  const eventClass = input.eventClass ?? (status === 'success' ? 'interaction.task_completed' : 'interaction.task_failed')
  const event: SourceOSInteractionEvent = {
    interactionEventId: interactionEventId(input.sessionId, input.runId, eventClass),
    type: 'SourceOSInteractionEvent',
    specVersion: SPEC_VERSION,
    eventClass,
    occurredAt,
    surface: sourceSurface(),
    mode: input.mode,
    session: sourceSession(input),
    actor: sourceActor(input.actorRef, input.workroomRef),
    participants: sourceParticipants(input.provider),
    task: {
      taskRef: `urn:srcos:task:${safeUrnTail(input.runId)}`,
      status,
      modelHint: input.modelHint ?? input.modelRouted,
      modelRouted: input.modelRouted,
      provider: input.provider,
      latencyMs: input.latencyMs
    },
    steeringIntent: sourceSteeringIntent(input.steeringConfig, input.steeringResult),
    governanceTrace: {
      policyAdmitted: input.policyAdmitted,
      policyRef: input.policyRef ?? null,
      policyDecisionRefs: input.policyRef ? [input.policyRef] : [],
      grantRefs: input.grantRefs ?? [],
      memoryScopeRef: input.memoryScopeRef ?? null,
      memoryWritten: input.memoryWritten,
      contextPackRefs: [],
      requestHash: input.requestHash ?? null,
      evidenceHash: input.evidenceHashValue ?? null,
      providerRouteEvidenceRef: input.providerRouteEvidence ? providerRouteEvidenceRef(input.providerRouteEvidence, input.runId) : null,
      agentPlaneRunRef: null,
      evidenceRefs: input.evidenceRefs ?? [],
      replayRef: input.replayRef ?? null
    },
    payloadMode: 'summary',
    payload: {
      summary: input.payloadSummary ?? `${eventClass} via ${input.provider}`,
      provider_route_evidence: input.providerRouteEvidence ? summarizeProviderRouteEvidence(input.providerRouteEvidence) : null
    },
    sourceEventRefs: [],
    redactionRefs: [],
    integrity: null
  }

  return withIntegrity(event)
}

export function buildSourceOSTaskInteractionEvent(input: BuildSourceOSTaskInteractionInput): SourceOSInteractionEvent {
  const result = input.result
  const eventClass = taskStatusToEventClass(result.status)
  const taskStatus = taskStatusToInteractionStatus(result.status)
  const event: SourceOSInteractionEvent = {
    interactionEventId: interactionEventId(input.sessionId, result.run_id, eventClass),
    type: 'SourceOSInteractionEvent',
    specVersion: SPEC_VERSION,
    eventClass,
    occurredAt: result.timestamp ?? input.occurredAt ?? new Date().toISOString(),
    surface: sourceSurface(),
    mode: input.mode,
    session: sourceSession(input),
    actor: sourceActor(input.actorRef, input.workroomRef),
    participants: sourceParticipants(result.provider),
    task: {
      taskRef: `urn:srcos:task:${safeUrnTail(result.run_id)}`,
      status: taskStatus,
      modelHint: input.modelHint ?? null,
      modelRouted: result.model_routed,
      provider: result.provider,
      latencyMs: result.latency_ms
    },
    steeringIntent: sourceSteeringIntent(input.steeringConfig, result.steering_applied),
    governanceTrace: {
      policyAdmitted: result.policy_admitted,
      policyRef: result.policy_ref ?? null,
      policyDecisionRefs: result.policy_ref ? [result.policy_ref] : [],
      grantRefs: flattenGrantRefs(result.grant_refs),
      memoryScopeRef: result.memory_scope_ref ?? null,
      memoryWritten: result.memory_written,
      contextPackRefs: [],
      requestHash: result.request_hash ?? null,
      evidenceHash: result.evidence_hash ?? null,
      providerRouteEvidenceRef: result.provider_route_evidence ? providerRouteEvidenceRef(result.provider_route_evidence, result.run_id) : null,
      agentPlaneRunRef: result.agentplane_run_id ?? null,
      evidenceRefs: result.evidence_ref ? [result.evidence_ref] : [],
      replayRef: result.replay_ref ?? null
    },
    payloadMode: 'summary',
    payload: {
      summary: input.payloadSummary ?? result.content,
      sourceos_status: result.status,
      provider_route_evidence: result.provider_route_evidence ? summarizeProviderRouteEvidence(result.provider_route_evidence) : null
    },
    sourceEventRefs: [],
    redactionRefs: [],
    integrity: null
  }

  return withIntegrity(event)
}

function sourceSurface(): SourceOSInteractionEvent['surface'] {
  return {
    surfaceKind: 'noetica',
    sourcePlane: 'SocioProphet/Noetica',
    clientRef: 'web:noetica'
  }
}

function sourceSession(input: BuildInteractionBaseInput): SourceOSInteractionEvent['session'] {
  return {
    sessionId: input.sessionId,
    conversationRef: input.conversationRef ?? `urn:srcos:conversation:${safeUrnTail(input.sessionId)}`,
    roomRef: null,
    threadRef: input.threadRef ?? `urn:srcos:thread:${safeUrnTail(input.sessionId)}`,
    workroomRef: input.workroomRef ?? null,
    topicRef: input.topicRef ?? null,
    opsHistoryEventRef: null
  }
}

function sourceActor(actorRef?: string, workroomRef?: string | null): SourceOSInteractionEvent['actor'] {
  return {
    actorRef: actorRef ?? 'urn:srcos:subject:user:operator',
    actorKind: 'human',
    agentRegistryRef: null,
    onBehalfOfRef: workroomRef ?? null
  }
}

function sourceParticipants(provider: string): SourceOSInteractionEvent['participants'] {
  return [
    {
      role: 'user',
      participantRef: 'urn:srcos:subject:user:operator',
      agentRegistryRef: null
    },
    {
      role: 'assistant',
      participantRef: NOETICA_ACTOR_REF,
      agentRegistryRef: NOETICA_AGENT_REGISTRY_REF
    },
    {
      role: 'provider',
      participantRef: `provider:${provider}`,
      agentRegistryRef: null
    }
  ]
}

function sourceSteeringIntent(config?: SteeringConfig, result?: SteeringResult): SourceOSInteractionEvent['steeringIntent'] {
  if (!config && !result) {
    return {
      steeringKind: 'none',
      featureRef: null,
      strength: null,
      status: 'noop'
    }
  }

  const steeringKind: SourceOSSteeringKind = config?.feature_id ? 'neuronpedia_feature' : 'other'
  const status: SourceOSSteeringStatus = result?.status ?? 'requested'

  return {
    steeringKind,
    featureRef: config?.feature_id ?? null,
    strength: config?.strength ?? null,
    status
  }
}

function taskStatusToEventClass(status: NoeticaTaskStatus): SourceOSInteractionEvent['eventClass'] {
  if (status === 'accepted' || status === 'stubbed') return 'interaction.task_completed'
  return 'interaction.task_failed'
}

function taskStatusToInteractionStatus(status: NoeticaTaskStatus): NonNullable<SourceOSInteractionEvent['task']>['status'] {
  if (status === 'accepted' || status === 'stubbed') return 'success'
  if (status === 'blocked') return 'blocked'
  return 'unavailable'
}

function flattenGrantRefs(refs: GrantResolutionRefs): string[] {
  return Array.from(new Set([...refs.requested, ...refs.resolved, ...refs.missing]))
}

function providerRouteEvidenceRef(evidence: ExternalModelProviderRouteEvidence, runId: string): string {
  const provider = safeUrnTail(evidence.providerRef || evidence.providerClass || 'provider')
  return `urn:srcos:evidence:provider-route:${provider}-${safeUrnTail(runId)}`
}

function summarizeProviderRouteEvidence(evidence: ExternalModelProviderRouteEvidence): Record<string, unknown> {
  return {
    kind: evidence.kind,
    status: evidence.status,
    providerRef: evidence.providerRef,
    providerClass: evidence.providerClass,
    promptEgressDefault: evidence.promptEgressDefault,
    contactedExternalProvider: Boolean(evidence.sideEffects?.contactedExternalProvider),
    sentPrompt: Boolean(evidence.sideEffects?.sentPrompt)
  }
}

function interactionEventId(sessionId: string, runId: string, eventClass: SourceOSInteractionEvent['eventClass']): string {
  return `urn:srcos:interaction-event:${safeUrnTail(sessionId)}-${safeUrnTail(runId)}-${safeUrnTail(eventClass)}`
}

function withIntegrity(event: SourceOSInteractionEvent): SourceOSInteractionEvent {
  const unsigned: SourceOSInteractionEvent = {
    ...event,
    integrity: null
  }
  return {
    ...event,
    integrity: {
      eventHash: `sha256:${evidenceHash(toEvidencePayload(unsigned))}`,
      signature: null
    }
  }
}

function toEvidencePayload(value: unknown): EvidencePayload {
  return JSON.parse(JSON.stringify(value)) as EvidencePayload
}

function safeUrnTail(value: string): string {
  return value
    .toLowerCase()
    .replace(/^urn:srcos:[a-z0-9-]+:/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'event'
}
