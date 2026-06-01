import type { NoeticaChatRequest, NoeticaServiceStatus, NoeticaStreamDoneResult } from '@/lib/contracts/noeticaService'
import type { SourceOSInteractionEvent } from '@/lib/contracts/sourceos/generated/sourceos-interaction-event'

export type NoeticaInteractionEventBuildContext = {
  occurredAt?: string
  actorRef?: string
  workroomRef?: string | null
  topicRef?: string | null
}

const DEFAULT_ACTOR_REF = 'urn:srcos:subject:user:operator'
const DEFAULT_WORKROOM_REF = 'urn:srcos:workroom:noetica-desktop-phase-1h'

export function buildNoeticaLocalServiceStatusInteractionEvent(
  status: NoeticaServiceStatus,
  context: NoeticaInteractionEventBuildContext = {}
): SourceOSInteractionEvent {
  const occurredAt = context.occurredAt ?? new Date().toISOString()

  return {
    interactionEventId: 'urn:srcos:interaction-event:noetica-local-service-status-0001',
    type: 'SourceOSInteractionEvent',
    specVersion: '2.0.0',
    eventClass: 'interaction.governance_trace',
    occurredAt,
    surface: {
      surfaceKind: 'noetica',
      sourcePlane: 'SocioProphet/Noetica',
      clientRef: 'noetica-tauri-static-shell'
    },
    mode: 'standalone',
    session: {
      sessionId: 'noetica-local-service-session',
      conversationRef: null,
      roomRef: null,
      threadRef: 'urn:srcos:thread:noetica-local-service-status',
      workroomRef: context.workroomRef ?? DEFAULT_WORKROOM_REF,
      topicRef: context.topicRef ?? 'urn:srcos:topic:noetica-local-service-boundary',
      opsHistoryEventRef: null
    },
    actor: {
      actorRef: context.actorRef ?? DEFAULT_ACTOR_REF,
      actorKind: 'human',
      agentRegistryRef: null,
      onBehalfOfRef: null
    },
    participants: [
      {
        role: 'user',
        participantRef: context.actorRef ?? DEFAULT_ACTOR_REF,
        agentRegistryRef: null
      },
      {
        role: 'provider',
        participantRef: 'urn:srcos:service:noetica-local-service',
        agentRegistryRef: null
      }
    ],
    task: {
      taskRef: 'urn:srcos:task:noetica-local-service-status-0001',
      status: status.chat === 'ready' ? 'success' : 'not_configured',
      modelHint: null,
      modelRouted: null,
      provider: status.endpoint_kind,
      latencyMs: null
    },
    steeringIntent: {
      steeringKind: 'none',
      featureRef: null,
      strength: null,
      status: 'noop'
    },
    governanceTrace: {
      policyAdmitted: true,
      policyRef: 'urn:srcos:policy:noetica-standalone-status-read',
      policyDecisionRefs: ['urn:srcos:decision:noetica-local-service-status-admit-0001'],
      grantRefs: [],
      memoryScopeRef: null,
      memoryWritten: false,
      contextPackRefs: [],
      requestHash: 'sha256:noetica-local-service-status-request-placeholder',
      evidenceHash: 'sha256:noetica-local-service-status-evidence-placeholder',
      providerRouteEvidenceRef: null,
      agentPlaneRunRef: null,
      evidenceRefs: [],
      replayRef: null
    },
    payloadMode: 'summary',
    payload: {
      summary: 'Noetica local service boundary status check succeeded. This event is bounded and non-authoritative outside Noetica runtime export.',
      serviceStatus: status.chat === 'ready' ? 'ok' : status.chat,
      endpointKind: status.endpoint_kind,
      desktopMode: status.desktop_mode
    },
    sourceEventRefs: [],
    redactionRefs: [],
    integrity: null
  }
}

export function buildNoeticaChatCompletionInteractionEvent(
  request: NoeticaChatRequest,
  result: NoeticaStreamDoneResult,
  context: NoeticaInteractionEventBuildContext = {}
): SourceOSInteractionEvent {
  const occurredAt = context.occurredAt ?? result.timestamp ?? new Date().toISOString()
  const eventSlug = safeSlug(result.run_id)
  const memoryScopeRef = result.memory_scope_ref ?? `urn:srcos:memory-scope:${safeSlug(request.memory_scope)}`

  return {
    interactionEventId: `urn:srcos:interaction-event:noetica-chat-completion-${eventSlug}`,
    type: 'SourceOSInteractionEvent',
    specVersion: '2.0.0',
    eventClass: 'interaction.task_completed',
    occurredAt,
    surface: {
      surfaceKind: 'noetica',
      sourcePlane: 'SocioProphet/Noetica',
      clientRef: 'lib/client/noeticaTransport.ts'
    },
    mode: request.mode,
    session: {
      sessionId: request.session_id,
      conversationRef: `urn:srcos:conversation:${safeSlug(request.session_id)}`,
      roomRef: null,
      threadRef: `urn:srcos:thread:${safeSlug(request.session_id)}`,
      workroomRef: context.workroomRef ?? DEFAULT_WORKROOM_REF,
      topicRef: context.topicRef ?? 'urn:srcos:topic:noetica-transport-boundary',
      opsHistoryEventRef: null
    },
    actor: {
      actorRef: context.actorRef ?? DEFAULT_ACTOR_REF,
      actorKind: 'human',
      agentRegistryRef: null,
      onBehalfOfRef: null
    },
    participants: [
      {
        role: 'user',
        participantRef: context.actorRef ?? DEFAULT_ACTOR_REF,
        agentRegistryRef: null
      },
      {
        role: 'assistant',
        participantRef: 'urn:srcos:assistant:noetica-standalone-provider',
        agentRegistryRef: null
      }
    ],
    task: {
      taskRef: `urn:srcos:task:${eventSlug}`,
      status: result.policy_admitted ? 'success' : 'blocked',
      modelHint: request.model_id,
      modelRouted: result.model_routed,
      provider: result.provider,
      latencyMs: result.latency_ms
    },
    steeringIntent: {
      steeringKind: request.steering ? 'sourceos_local' : 'none',
      featureRef: null,
      strength: null,
      status: result.steering_applied ? 'applied' : 'noop'
    },
    governanceTrace: {
      policyAdmitted: result.policy_admitted,
      policyRef: result.policy_ref ?? null,
      policyDecisionRefs: result.policy_ref ? [`urn:srcos:decision:${eventSlug}`] : [],
      grantRefs: result.grant_refs?.resolved ?? [],
      memoryScopeRef,
      memoryWritten: result.memory_written,
      contextPackRefs: [],
      requestHash: result.request_hash ?? null,
      evidenceHash: result.evidence_hash ?? null,
      providerRouteEvidenceRef: result.evidence_ref ?? null,
      agentPlaneRunRef: result.agentplane_run_id ?? null,
      evidenceRefs: result.evidence_ref ? [result.evidence_ref] : [],
      replayRef: result.replay_ref ?? null
    },
    payloadMode: 'summary',
    payload: {
      summary: 'Noetica chat completion returned through the typed transport boundary.',
      transportBoundary: 'lib/client/noeticaTransport.ts',
      runtimeBoundary: 'local-service-or-next-fallback',
      contentLength: result.content.length
    },
    sourceEventRefs: [],
    redactionRefs: [],
    integrity: null
  }
}

export function assertNoeticaInteractionEventIsExportable(event: SourceOSInteractionEvent): void {
  if (!event.interactionEventId.startsWith('urn:srcos:interaction-event:')) {
    throw new Error(`invalid interactionEventId: ${event.interactionEventId}`)
  }

  if (event.type !== 'SourceOSInteractionEvent') {
    throw new Error(`invalid event type: ${event.type}`)
  }

  if (!['metadata-only', 'summary', 'ref-only', 'inline-bounded', 'redacted'].includes(event.payloadMode)) {
    throw new Error(`invalid payloadMode: ${event.payloadMode}`)
  }

  if (event.payloadMode === 'summary' && typeof event.payload?.summary !== 'string') {
    throw new Error('summary payload requires payload.summary')
  }
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'event'
}
