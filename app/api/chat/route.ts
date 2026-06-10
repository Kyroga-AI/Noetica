import { NextResponse } from 'next/server'
import { models } from '@/config/models'
import { buildExternalModelProviderRouteEvidence } from '@/lib/evidence/agentplane'
import { evidenceHash } from '@/lib/evidence/hash'
import { buildSourceOSTaskInteractionEvent, buildStandaloneInteractionEvent } from '@/lib/sourceos/interaction'
import type { ChatMessage } from '@/lib/types/message'
import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaTaskResult } from '@/lib/types/task'
import type { NoeticaProviderKeys } from '@/lib/contracts/noeticaService'
import { streamAnthropic } from '@/lib/providers/anthropic'
import { streamOpenAI } from '@/lib/providers/openai'
import { streamGoogle } from '@/lib/providers/google'
import { streamMistral } from '@/lib/providers/mistral'
import { submitTask } from '@/lib/superconscious/adapter'

export const runtime = 'nodejs'

type ChatRequest = {
  session_id?: string
  mode?: 'standalone' | 'sourceos'
  model_id?: string
  messages?: ChatMessage[]
  steering?: SteeringConfig
  memory_scope?: string
  provider_keys?: NoeticaProviderKeys
  agent_machine_endpoint?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest
  const mode = body.mode ?? 'standalone'
  const messages = body.messages ?? []
  const latest = messages[messages.length - 1]
  const sessionId = body.session_id ?? crypto.randomUUID()
  const memoryScope = body.memory_scope ?? 'noetica-session-local'
  const providerKeys = body.provider_keys ?? {}

  if (!latest?.content?.trim()) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  const model = models.find((m) => m.id === body.model_id) ?? models[0]

  if (body.steering && model.steering === 'none') {
    return NextResponse.json(
      { error: 'model_not_steering_capable', model_id: model.id },
      { status: 400 }
    )
  }

  if (body.steering && model.steering === 'local' && mode === 'standalone') {
    return NextResponse.json(
      { error: 'local_steering_requires_sourceos', model_id: model.id },
      { status: 400 }
    )
  }

  // ── Agent Machine proxy ──────────────────────────────────────────────────
  // When an Agent Machine endpoint is supplied, proxy the entire request there
  // and pipe the SSE response back verbatim. The agent machine handles model
  // routing, steering, and evidence internally.

  if (body.agent_machine_endpoint) {
    return proxyToAgentMachine(body.agent_machine_endpoint, body)
  }

  // ── SourceOS mode ────────────────────────────────────────────────────────

  if (mode === 'sourceos') {
    const timestamp = new Date().toISOString()
    const toolGrantRefs = inferToolGrantRefs(model, body.steering)
    const steeringHintForHash = body.steering
      ? { feature_id: body.steering.feature_id, layer: body.steering.layer, preset: body.steering.preset ?? null, strength: body.steering.strength }
      : null
    const requestHash = evidenceHash({
      agent_id: 'noetica', mode, model_hint: model.id, prompt: latest.content,
      steering_hint: steeringHintForHash, tool_grant_refs: toolGrantRefs, timestamp
    } as Parameters<typeof evidenceHash>[0])
    const result = await submitTask({
      schema_version: 'noetica.task.v0.1',
      session_id: sessionId, agent_id: 'noetica', message: latest.content, mode,
      model_hint: model.id, steering_hint: body.steering, tool_grant_refs: toolGrantRefs,
      memory_scope_ref: memoryScope, request_hash: requestHash
    })
    result.sourceos_interaction_event = buildSourceOSTaskInteractionEvent({
      sessionId, mode, result, modelHint: model.id,
      steeringConfig: body.steering, payloadSummary: result.content
    })
    return streamTaskResult(result)
  }

  // ── Standalone mode ──────────────────────────────────────────────────────

  const STREAMABLE_PROVIDERS = ['anthropic', 'openai', 'google', 'mistral']
  if (!STREAMABLE_PROVIDERS.includes(model.provider)) {
    return NextResponse.json(
      { error: 'provider_not_implemented_in_standalone', provider: model.provider, model_id: model.id },
      { status: 501 }
    )
  }

  const providerModelId = resolveProviderModelId(model)
  const run_id = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const request_hash = evidenceHash({ model_id: model.id, provider_model_id: providerModelId, prompt: latest.content, timestamp })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const started = Date.now()
      let content = ''

      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      send('meta', {
        governance: {
          run_id, model_routed: providerModelId, provider: model.provider,
          policy_admitted: true, memory_written: false, memory_scope_ref: memoryScope,
          request_hash,
          sourceos_interaction_event: buildStandaloneInteractionEvent({
            sessionId, mode, eventClass: 'interaction.task_submitted', runId: run_id,
            modelHint: model.id, modelRouted: providerModelId, provider: model.provider,
            latencyMs: 0, policyAdmitted: true, grantRefs: inferToolGrantRefs(model, body.steering),
            memoryScopeRef: memoryScope, memoryWritten: false, requestHash: request_hash,
            status: 'submitted', steeringConfig: body.steering,
            payloadSummary: 'Noetica submitted a standalone provider call.'
          }),
          timestamp, latency_ms: 0
        }
      })

      try {
        const providerStream = selectProviderStream(model, providerModelId, messages, providerKeys)

        for await (const delta of providerStream) {
          content += delta
          send('delta', { delta })
        }

        const latency_ms = Date.now() - started
        const evidence_hash = evidenceHash({ model_id: model.id, provider_model_id: providerModelId, prompt: latest.content, response: content, timestamp })
        const provider_route_evidence = buildExternalModelProviderRouteEvidence({
          model, providerModelId, runId: run_id, capturedAt: timestamp,
          prompt: latest.content, latencyMs: latency_ms, status: 'success'
        })

        send('done', {
          result: {
            run_id, content, model_routed: providerModelId, provider: model.provider,
            policy_admitted: true, memory_written: false, memory_scope_ref: memoryScope,
            request_hash, evidence_hash, provider_route_evidence,
            sourceos_interaction_event: buildStandaloneInteractionEvent({
              sessionId, mode, eventClass: 'interaction.task_completed', runId: run_id,
              modelHint: model.id, modelRouted: providerModelId, provider: model.provider,
              latencyMs: latency_ms, policyAdmitted: true, grantRefs: inferToolGrantRefs(model, body.steering),
              memoryScopeRef: memoryScope, memoryWritten: false, requestHash: request_hash,
              evidenceHashValue: evidence_hash, providerRouteEvidence: provider_route_evidence,
              steeringConfig: body.steering, status: 'success',
              payloadSummary: 'Noetica completed a standalone provider call.'
            }),
            timestamp, latency_ms
          }
        })
      } catch (error) {
        const latency_ms = Date.now() - started
        const provider_route_evidence = buildExternalModelProviderRouteEvidence({
          model, providerModelId, runId: run_id, capturedAt: timestamp,
          prompt: latest.content, latencyMs: latency_ms, status: 'failure', errorRef: 'provider-route-error'
        })
        send('error', {
          error: error instanceof Error ? error.message : 'unknown_provider_error',
          provider_route_evidence
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

// ─── Provider dispatch ────────────────────────────────────────────────────────

function selectProviderStream(
  model: ModelConfig,
  providerModelId: string,
  messages: ChatMessage[],
  keys: NoeticaProviderKeys
): AsyncGenerator<string> {
  const input = { model: providerModelId, messages }
  switch (model.provider) {
    case 'anthropic': return streamAnthropic({ ...input, apiKey: keys.anthropic })
    case 'openai':    return streamOpenAI({ ...input, apiKey: keys.openai })
    case 'google':    return streamGoogle({ ...input, apiKey: keys.google })
    case 'mistral':   return streamMistral({ ...input, apiKey: keys.mistral })
    default: throw new Error(`Unsupported provider: ${model.provider}`)
  }
}

// ─── Agent Machine proxy ──────────────────────────────────────────────────────

async function proxyToAgentMachine(endpoint: string, body: ChatRequest): Promise<Response> {
  const url = endpoint.replace(/\/$/, '') + '/api/chat'
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Don't re-forward the agent_machine_endpoint to avoid loops
      body: JSON.stringify({ ...body, agent_machine_endpoint: undefined }),
    })
    if (!upstream.ok || !upstream.body) {
      const err = await upstream.text().catch(() => 'upstream_error')
      return new Response(
        `event: error\ndata: ${JSON.stringify({ error: `Agent Machine error ${upstream.status}: ${err}` })}\n\n`,
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
      )
    }
    // Pipe upstream SSE response verbatim
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'agent_machine_unreachable'
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`,
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
    )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function streamTaskResult(result: NoeticaTaskResult): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const governance = {
        run_id: result.run_id, model_routed: result.model_routed, provider: result.provider,
        model_overridden: result.model_overridden, policy_admitted: result.policy_admitted,
        policy_ref: result.policy_ref, memory_scope_ref: result.memory_scope_ref,
        memory_written: result.memory_written, evidence_ref: result.evidence_ref,
        replay_ref: result.replay_ref, agentplane_run_id: result.agentplane_run_id,
        request_hash: result.request_hash, evidence_hash: result.evidence_hash,
        provider_route_evidence: result.provider_route_evidence,
        sourceos_interaction_event: result.sourceos_interaction_event,
        grant_refs: result.grant_refs, sourceos_status: result.status,
        timestamp: result.timestamp, latency_ms: result.latency_ms
      }
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ governance })}\n\n`))
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ result })}\n\n`))
      controller.close()
    }
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' }
  })
}

function inferToolGrantRefs(model: ModelConfig, steering?: SteeringConfig): string[] {
  const refs: string[] = []
  if (model.provider === 'anthropic') refs.push('call:anthropic')
  if (model.provider === 'openai')    refs.push('call:openai')
  if (model.provider === 'google')    refs.push('call:google')
  if (model.provider === 'mistral')   refs.push('call:mistral')
  if (model.provider === 'neuronpedia' || steering) refs.push('call:neuronpedia:steer')
  return Array.from(new Set(refs))
}

function resolveProviderModelId(model: ModelConfig): string {
  const envMap: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_MODEL_ID,
    openai:    process.env.OPENAI_MODEL_ID,
    google:    process.env.GOOGLE_MODEL_ID,
    mistral:   process.env.MISTRAL_MODEL_ID,
  }
  return envMap[model.provider]?.trim() || model.id
}
