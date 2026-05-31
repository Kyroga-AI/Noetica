import { NextResponse } from 'next/server'
import { models } from '@/config/models'
import { buildExternalModelProviderRouteEvidence } from '@/lib/evidence/agentplane'
import { evidenceHash } from '@/lib/evidence/hash'
import { buildSourceOSTaskInteractionEvent, buildStandaloneInteractionEvent } from '@/lib/sourceos/interaction'
import type { ChatMessage } from '@/lib/types/message'
import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaTaskResult } from '@/lib/types/task'
import { streamAnthropic } from '@/lib/providers/anthropic'
import { streamOpenAI } from '@/lib/providers/openai'
import { submitTask } from '@/lib/superconscious/adapter'

export const runtime = 'nodejs'

// Browser/dev fallback implementation of the Noetica chat service contract.
// The static desktop UI must call this through lib/client/noeticaTransport.ts,
// and durable runtime authority should move behind a local service, SourceOS
// endpoint, Agent Machine endpoint, or model-router boundary.

type ChatRequest = {
  session_id?: string
  mode?: 'standalone' | 'sourceos'
  model_id?: string
  messages?: ChatMessage[]
  steering?: SteeringConfig
  memory_scope?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest
  const mode = body.mode ?? 'standalone'
  const messages = body.messages ?? []
  const latest = messages[messages.length - 1]
  const sessionId = body.session_id ?? crypto.randomUUID()
  const memoryScope = body.memory_scope ?? 'noetica-session-local'

  if (!latest?.content?.trim()) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  const model = models.find((candidate) => candidate.id === body.model_id) ?? models[0]

  if (body.steering && model.steering === 'none') {
    return NextResponse.json(
      { error: 'model_not_steering_capable', model_id: model.id, steering: model.steering },
      { status: 400 }
    )
  }

  if (body.steering && model.steering === 'local' && mode === 'standalone') {
    return NextResponse.json(
      { error: 'local_steering_requires_sourceos', model_id: model.id, steering: model.steering },
      { status: 400 }
    )
  }

  if (mode === 'sourceos') {
    const timestamp = new Date().toISOString()
    const toolGrantRefs = inferToolGrantRefs(model, body.steering)
    const steeringHintForHash = body.steering
      ? {
          feature_id: body.steering.feature_id,
          layer: body.steering.layer,
          preset: body.steering.preset ?? null,
          strength: body.steering.strength
        }
      : null
    const requestHash = evidenceHash({
      agent_id: 'noetica',
      mode,
      model_hint: model.id,
      prompt: latest.content,
      steering_hint: steeringHintForHash,
      tool_grant_refs: toolGrantRefs,
      timestamp
    })
    const result = await submitTask({
      schema_version: 'noetica.task.v0.1',
      session_id: sessionId,
      agent_id: 'noetica',
      message: latest.content,
      mode,
      model_hint: model.id,
      steering_hint: body.steering,
      tool_grant_refs: toolGrantRefs,
      memory_scope_ref: memoryScope,
      request_hash: requestHash
    })

    result.sourceos_interaction_event = buildSourceOSTaskInteractionEvent({
      sessionId,
      mode,
      result,
      modelHint: model.id,
      steeringConfig: body.steering,
      payloadSummary: result.content
    })

    return streamTaskResult(result)
  }

  if (model.provider !== 'openai' && model.provider !== 'anthropic') {
    return NextResponse.json(
      {
        error: 'provider_not_implemented_in_m2a',
        provider: model.provider,
        model_id: model.id
      },
      { status: 501 }
    )
  }

  const providerModelId = resolveProviderModelId(model)
  const run_id = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const request_hash = evidenceHash({
    model_id: model.id,
    provider_model_id: providerModelId,
    prompt: latest.content,
    timestamp
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const started = Date.now()
      let content = ''

      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const submittedInteraction = buildStandaloneInteractionEvent({
        sessionId,
        mode,
        eventClass: 'interaction.task_submitted',
        runId: run_id,
        modelHint: model.id,
        modelRouted: providerModelId,
        provider: model.provider,
        latencyMs: 0,
        policyAdmitted: true,
        grantRefs: inferToolGrantRefs(model, body.steering),
        memoryScopeRef: memoryScope,
        memoryWritten: false,
        requestHash: request_hash,
        status: 'submitted',
        steeringConfig: body.steering,
        payloadSummary: 'Noetica submitted a standalone provider call.'
      })

      send('meta', {
        governance: {
          run_id,
          model_routed: providerModelId,
          provider: model.provider,
          policy_admitted: true,
          memory_written: false,
          memory_scope_ref: memoryScope,
          request_hash,
          sourceos_interaction_event: submittedInteraction,
          timestamp,
          latency_ms: 0
        }
      })

      try {
        const providerStream = model.provider === 'openai'
          ? streamOpenAI({ model: providerModelId, messages })
          : streamAnthropic({ model: providerModelId, messages })

        for await (const delta of providerStream) {
          content += delta
          send('delta', { delta })
        }

        const latency_ms = Date.now() - started
        const evidence_hash = evidenceHash({
          model_id: model.id,
          provider_model_id: providerModelId,
          prompt: latest.content,
          response: content,
          timestamp
        })
        const provider_route_evidence = buildExternalModelProviderRouteEvidence({
          model,
          providerModelId,
          runId: run_id,
          capturedAt: timestamp,
          prompt: latest.content,
          latencyMs: latency_ms,
          status: 'success'
        })
        const sourceos_interaction_event = buildStandaloneInteractionEvent({
          sessionId,
          mode,
          eventClass: 'interaction.task_completed',
          runId: run_id,
          modelHint: model.id,
          modelRouted: providerModelId,
          provider: model.provider,
          latencyMs: latency_ms,
          policyAdmitted: true,
          grantRefs: inferToolGrantRefs(model, body.steering),
          memoryScopeRef: memoryScope,
          memoryWritten: false,
          requestHash: request_hash,
          evidenceHashValue: evidence_hash,
          providerRouteEvidence: provider_route_evidence,
          steeringConfig: body.steering,
          status: 'success',
          payloadSummary: 'Noetica completed a standalone provider call and emitted a SourceOS interaction event.'
        })

        send('done', {
          result: {
            run_id,
            content,
            model_routed: providerModelId,
            provider: model.provider,
            policy_admitted: true,
            memory_written: false,
            memory_scope_ref: memoryScope,
            request_hash,
            evidence_hash,
            provider_route_evidence,
            sourceos_interaction_event,
            timestamp,
            latency_ms
          }
        })
      } catch (error) {
        const latency_ms = Date.now() - started
        const provider_route_evidence = buildExternalModelProviderRouteEvidence({
          model,
          providerModelId,
          runId: run_id,
          capturedAt: timestamp,
          prompt: latest.content,
          latencyMs: latency_ms,
          status: 'failure',
          errorRef: 'provider-route-error'
        })
        const sourceos_interaction_event = buildStandaloneInteractionEvent({
          sessionId,
          mode,
          eventClass: 'interaction.task_failed',
          runId: run_id,
          modelHint: model.id,
          modelRouted: providerModelId,
          provider: model.provider,
          latencyMs: latency_ms,
          policyAdmitted: true,
          grantRefs: inferToolGrantRefs(model, body.steering),
          memoryScopeRef: memoryScope,
          memoryWritten: false,
          requestHash: request_hash,
          providerRouteEvidence: provider_route_evidence,
          steeringConfig: body.steering,
          status: 'failure',
          payloadSummary: 'Noetica standalone provider call failed.'
        })

        send('error', {
          error: error instanceof Error ? error.message : 'unknown_provider_error',
          provider_route_evidence,
          sourceos_interaction_event
        })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

function streamTaskResult(result: NoeticaTaskResult): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const governance = {
        run_id: result.run_id,
        model_routed: result.model_routed,
        provider: result.provider,
        model_overridden: result.model_overridden,
        policy_admitted: result.policy_admitted,
        policy_ref: result.policy_ref,
        memory_scope_ref: result.memory_scope_ref,
        memory_written: result.memory_written,
        evidence_ref: result.evidence_ref,
        replay_ref: result.replay_ref,
        agentplane_run_id: result.agentplane_run_id,
        request_hash: result.request_hash,
        evidence_hash: result.evidence_hash,
        provider_route_evidence: result.provider_route_evidence,
        sourceos_interaction_event: result.sourceos_interaction_event,
        grant_refs: result.grant_refs,
        sourceos_status: result.status,
        timestamp: result.timestamp,
        latency_ms: result.latency_ms
      }

      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ governance })}\n\n`))
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ result })}\n\n`))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

function inferToolGrantRefs(model: ModelConfig, steering?: SteeringConfig): string[] {
  const refs: string[] = []

  if (model.provider === 'anthropic') refs.push('call:anthropic')
  if (model.provider === 'openai') refs.push('call:openai')
  if (model.provider === 'neuronpedia' || steering) refs.push('call:neuronpedia:steer')

  return Array.from(new Set(refs))
}

function resolveProviderModelId(model: ModelConfig): string {
  if (model.provider === 'anthropic') {
    return process.env.ANTHROPIC_MODEL_ID?.trim() || model.id
  }

  if (model.provider === 'openai') {
    return process.env.OPENAI_MODEL_ID?.trim() || model.id
  }

  return model.id
}
