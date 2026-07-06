import { NextResponse } from 'next/server'
import { models } from '@/config/models'
import { buildExternalModelProviderRouteEvidence } from '@/lib/evidence/agentplane'
import { evidenceHash } from '@/lib/evidence/hash'
import { buildRuntimeRiskTrace } from '@/lib/risk/riskAversionRuntime'
import { writeRuntimeRiskTraceArtifact } from '@/lib/risk/riskAversionArtifact'
import { buildSourceOSTaskInteractionEvent, buildStandaloneInteractionEvent } from '@/lib/sourceos/interaction'
import type { ChatMessage } from '@/lib/types/message'
import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaTaskResult } from '@/lib/types/task'
import type { ProviderTool, ToolUseBlock } from '@/lib/providers'
import { streamAnthropic, TOOL_CALLS_PREFIX as ANTHROPIC_TOOL_CALLS_PREFIX } from '@/lib/providers/anthropic'
import { streamOpenAI } from '@/lib/providers/openai'
import { streamGoogle } from '@/lib/providers/google'
import { streamMistral } from '@/lib/providers/mistral'
import { streamOllama } from '@/lib/providers/ollama'
import { submitTask } from '@/lib/superconscious/adapter'
import { routeModel } from '@/lib/model-router/adapter'
import { resolveProviderModelId } from '@/lib/providers/resolver'
import { recallMemory, storeMemoryContent, proposeMemoryWrite } from '@/lib/memory-mesh/adapter'
import { checkContentPolicy } from '@/lib/policy/contentPolicy'
import { runLocalSteering } from '@/lib/sae/localSteering'
import { saeSteer } from '@/lib/sae/saeClient'
import type { SteeringResult } from '@/lib/types/steering'
import { ingestInteraction, ingestMessage, ingestMemory } from '@socioprophet/hellgraph'

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
  thinking_budget?: number
  temperature?: number
  max_tokens?: number
  top_p?: number
  provider_keys?: { anthropic?: string; openai?: string; google?: string; mistral?: string; neuronpedia?: string; serper?: string }
  tools?: ProviderTool[]
  system_prompt?: string
  agent_machine_endpoint?: string
  policy_profile?: string
  security_attested?: boolean
  api_endpoint_override?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest
  const mode = body.mode ?? 'standalone'
  const messages = body.messages ?? []
  const latest = messages[messages.length - 1]
  const sessionId = body.session_id ?? crypto.randomUUID()
  const memoryScope = body.memory_scope ?? 'noetica-session-local'

  // Agent-machine proxy — forward to the configured endpoint and pipe the SSE stream back.
  // This avoids CORS issues when the agent machine is a local service.
  if (body.agent_machine_endpoint && mode !== 'sourceos') {
    return proxyToAgentMachine(body.agent_machine_endpoint, body, request.signal)
  }

  if (!latest?.content?.trim()) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  // Content policy check — runs before provider selection or memory recall
  const policyResult = checkContentPolicy(latest.content, body.policy_profile ?? 'default')
  if (!policyResult.admitted) {
    return NextResponse.json(
      {
        error: 'policy_blocked',
        reason: policyResult.reason,
        profile: policyResult.profile,
        flagged_pattern: policyResult.flagged_pattern,
      },
      { status: 403 }
    )
  }

  let model = models.find((candidate) => candidate.id === body.model_id) ?? models[0]

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
      request_hash: requestHash,
      provider_keys: body.provider_keys,
      messages,
      system_prompt: body.system_prompt,
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

  // Determine which providers the caller has keys for
  const availableProviders = Object.entries(body.provider_keys ?? {})
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k) as import('@/lib/types/model').Provider[]

  const routeDecision = await routeModel({
    schema_version: 'noetica.model_route.v0.1',
    request_id: crypto.randomUUID(),
    session_id: sessionId,
    agent_id: 'noetica',
    mode,
    task_class: 'standalone-chat',
    model_hint: model.id,
    available_providers: availableProviders.length > 0 ? availableProviders : undefined,
  })

  if (routeDecision.status === 'blocked') {
    return NextResponse.json(
      {
        error: 'model_route_blocked',
        blocked_reason: routeDecision.blocked_reason,
        model_id: model.id,
        route_decision: routeDecision,
      },
      { status: 503 }
    )
  }

  // Apply routing override — downstream code continues using `model`
  if (routeDecision.model_routed !== model.id) {
    model = models.find((m) => m.id === routeDecision.model_routed) ?? model
  }

  const SERVED_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'mistral', 'meta'])
  if (!SERVED_PROVIDERS.has(model.provider)) {
    // 'neuronpedia' targets are steering/feature-inspection surfaces (see /api/steer),
    // not general chat-completion providers; 'xai' is not yet implemented. Route those
    // through the local Agent Machine (Ollama) or SourceOS instead.
    return NextResponse.json(
      {
        error: 'provider_not_chat_capable',
        provider: model.provider,
        model_id: model.id,
        hint: model.provider === 'neuronpedia'
          ? 'Neuronpedia models are steering targets — use the Steer surface, or run the open-weight base locally via Ollama (provider: meta).'
          : 'Provider not yet implemented for standalone chat.',
      },
      { status: 501 }
    )
  }

  // Memory-mesh recall — inject relevant prior context into the system prompt
  let systemPromptWithMemory = body.system_prompt
  if (memoryScope && memoryScope !== 'disabled' && latest.content) {
    const recalled = await recallMemory({
      schema_version: 'noetica.memory.v0.1',
      request_id: crypto.randomUUID(),
      session_id: sessionId,
      agent_id: 'noetica',
      scope_id: memoryScope,
      query_hash: latest.content,
      limit: 6,
    })
    if (recalled.entries.length > 0) {
      const snippets = recalled.entries
        .filter((e) => e.text)
        .map((e) => `- ${e.text}`)
        .join('\n')
      const meshBlock = `\n\n[Memory mesh — scope: ${memoryScope}]\n${snippets}`
      systemPromptWithMemory = body.system_prompt ? `${body.system_prompt}${meshBlock}` : meshBlock.trimStart()
    }
  }

  // SAE steering — real activation patching via sae_patch.py sidecar when available,
  // falling back to prompt-injection approximation.
  let steeringResult: SteeringResult | null = null
  if (body.steering && (model.steering === 'full' || model.steering === 'local')) {
    const numericFeatureId = parseInt(body.steering.feature_id, 10)
    if (!isNaN(numericFeatureId)) {
      const saeResult = await saeSteer(
        latest.content,
        numericFeatureId,
        body.steering.strength,
        body.max_tokens ?? 200,
      )
      if (saeResult?.ok) {
        // SAE sidecar performed full generation — stream its completion back and short-circuit.
        const saeCompletion = saeResult.steered_completion
        const saeStream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            const enc = new TextEncoder()
            const emit = (event: string, data: unknown) =>
              ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            emit('meta', {
              governance: { run_id: crypto.randomUUID(), sae_patch: true, feature_id: numericFeatureId, hook: saeResult.hook },
              steering: { source: 'sae_patch', original_activation: saeResult.original_feature_activation, resid_delta_norm: saeResult.resid_delta_norm },
            })
            emit('delta', { delta: saeCompletion })
            emit('done', {
              result: {
                run_id: crypto.randomUUID(),
                content: saeCompletion,
                model_routed: 'sae_patch',
                provider: 'local',
                policy_admitted: true,
                memory_written: false,
                stop_reason: 'end_turn',
                steering_result: { source: 'sae_patch', feature_id: numericFeatureId, hook: saeResult.hook },
                timestamp: new Date().toISOString(),
                latency_ms: 0,
              },
            })
            ctrl.close()
          },
        })
        return new Response(saeStream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        })
      }
    }
    // Sidecar unavailable or non-numeric feature_id — fall back to prompt-injection
    steeringResult = runLocalSteering(latest.content, body.steering)
    if (steeringResult.status === 'applied') {
      const steeringPrefix = steeringResult.steered.slice(0, steeringResult.steered.length - latest.content.length)
      systemPromptWithMemory = systemPromptWithMemory
        ? `${steeringPrefix.trim()}\n\n${systemPromptWithMemory}`
        : steeringPrefix.trim()
    }
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
        const THINKING_PFX = '\x00thinking\x00'
        const TOOL_PFX = ANTHROPIC_TOOL_CALLS_PREFIX  // same value as OPENAI prefix
        const USAGE_PFX = '\x00usage\x00'

        const baseUrl = body.api_endpoint_override || undefined
        const common = {
          model: providerModelId,
          messages,
          tools: body.tools,
          systemPrompt: systemPromptWithMemory,
          temperature: body.temperature,
          max_tokens: body.max_tokens,
          top_p: body.top_p,
          baseUrl,
        }
        let providerStream: AsyncGenerator<string>
        switch (model.provider) {
          case 'openai':
            providerStream = streamOpenAI({ ...common, apiKey: body.provider_keys?.openai })
            break
          case 'google':
            providerStream = streamGoogle({ ...common, apiKey: body.provider_keys?.google })
            break
          case 'mistral':
            providerStream = streamMistral({ ...common, apiKey: body.provider_keys?.mistral })
            break
          case 'meta':
            // Local Ollama runtime — keyless. Base URL falls back to OLLAMA_BASE_URL / localhost.
            providerStream = streamOllama({ ...common })
            break
          case 'anthropic':
          default:
            providerStream = streamAnthropic({ ...common, thinking_budget: body.thinking_budget, apiKey: body.provider_keys?.anthropic })
            break
        }

        let thinkingContent = ''
        let toolCalls: ToolUseBlock[] | undefined
        let inputTokens: number | undefined
        let outputTokens: number | undefined
        for await (const delta of providerStream) {
          if (delta.startsWith(THINKING_PFX)) {
            const chunk = delta.slice(THINKING_PFX.length)
            thinkingContent += chunk
            send('thinking_delta', { delta: chunk })
          } else if (delta.startsWith(TOOL_PFX)) {
            toolCalls = JSON.parse(delta.slice(TOOL_PFX.length)) as ToolUseBlock[]
          } else if (delta.startsWith(USAGE_PFX)) {
            const usage = JSON.parse(delta.slice(USAGE_PFX.length)) as { input_tokens?: number; output_tokens?: number }
            inputTokens = usage.input_tokens
            outputTokens = usage.output_tokens
          } else {
            content += delta
            send('delta', { delta })
          }
        }
        if (thinkingContent) {
          send('thinking_done', { thinking: thinkingContent })
        }
        if (toolCalls?.length) {
          send('tool_calls', { tool_calls: toolCalls })
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
        const riskTrace = buildRuntimeRiskTrace({
          runId: run_id,
          messages,
          assistantText: content,
          occurredAt: timestamp,
          evidenceRefs: [providerRouteEvidenceRef(provider_route_evidence, run_id)],
          runtimeEventRefs: [`urn:srcos:interaction-event:standalone-provider-run:${run_id}`]
        })
        const riskArtifact = riskTrace ? await writeRuntimeRiskTraceArtifact(riskTrace).catch(() => null) : null
        const riskObservatoryRef = riskTrace
          ? {
              traceRef: riskArtifact?.traceRef ?? `urn:noetica:risk-trace:${riskTrace.turnId}`,
              traceHash: riskArtifact?.traceHash ?? null,
              outputPath: riskArtifact?.outputPath ?? null,
              assessmentVersion: riskTrace.schemaVersion,
              outcomeObservatoryRef: 'urn:noetica:outcome-observatory:risk-aversion-v0.1',
              counterfactualReplayRef: null,
              aggregateScore: riskTrace.riskVector.aggregateScore
            }
          : null
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
          riskObservatoryRef,
          status: 'success',
          payloadSummary: 'Noetica completed a standalone provider call and emitted a SourceOS interaction event.'
        })

        // Store the turn in the memory mesh so future turns can recall it
        let memoryWritten = false
        if (memoryScope && memoryScope !== 'disabled' && content.trim()) {
          const turnText = `[turn] user: ${latest.content.slice(0, 200)} | assistant: ${content.slice(0, 400)}`
          const hash = storeMemoryContent(memoryScope, sessionId, turnText, [evidence_hash])
          await proposeMemoryWrite({
            schema_version: 'noetica.memory.v0.1',
            proposal_id: crypto.randomUUID(),
            session_id: sessionId,
            agent_id: 'noetica',
            scope_id: memoryScope,
            content_hash: hash,
            source_evidence_refs: [evidence_hash],
          }).catch(() => null)
          memoryWritten = true

          // Index the turn into HellGraph (memory entry grounded by evidence).
          try {
            ingestMemory({ scopeId: memoryScope, contentHash: hash, text: turnText, sessionId, evidenceRefs: [evidence_hash] })
          } catch { /* graph ingest is best-effort */ }
        }

        // Index this interaction and its turn into the HellGraph substrate.
        try {
          ingestInteraction({
            runId: run_id,
            sessionId,
            modelRouted: providerModelId,
            provider: model.provider,
            promptSummary: latest.content,
            responseSummary: content,
            evidenceHash: evidence_hash,
            policyAdmitted: true,
            steeringFeatureId: body.steering?.feature_id,
            latencyMs: latency_ms,
            timestamp,
          })
          ingestMessage({
            messageId: `${run_id}:user`,
            conversationId: sessionId,
            role: 'user',
            content: latest.content,
            createdAt: timestamp,
          })
          ingestMessage({
            messageId: run_id,
            conversationId: sessionId,
            role: 'assistant',
            content,
            createdAt: timestamp,
            precededBy: `${run_id}:user`,
            modelRouted: providerModelId,
            evidenceHash: evidence_hash,
          })
        } catch { /* graph ingest is best-effort */ }

        send('done', {
          result: {
            run_id,
            content,
            model_routed: providerModelId,
            provider: model.provider,
            policy_admitted: true,
            memory_written: memoryWritten,
            memory_scope_ref: memoryScope,
            request_hash,
            evidence_hash,
            provider_route_evidence,
            sourceos_interaction_event,
            tool_calls: toolCalls,
            stop_reason: toolCalls?.length ? 'tool_use' : 'end_turn',
            steering_result: steeringResult,
            timestamp,
            latency_ms,
            ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
            ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
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


function providerRouteEvidenceRef(evidence: ReturnType<typeof buildExternalModelProviderRouteEvidence>, runId: string): string {
  const provider = evidence.providerRef || evidence.providerClass || 'provider'
  return `urn:srcos:evidence:provider-route:${provider}-${runId}`.toLowerCase().replace(/[^a-z0-9._:~-]+/g, '-')
}

// Proxy a request to an agent-machine endpoint that speaks the Noetica SSE protocol.
// SSRF guard: the agent_machine_endpoint is user-supplied, so we only allow it to
// point at the local loopback interface. Without this, a crafted request could make
// the server fetch arbitrary internal hosts (cloud metadata, other localhost services).
async function proxyToAgentMachine(url: string, body: ChatRequest, signal: AbortSignal): Promise<Response> {
  // Parse + validate INLINE (a boolean predicate in a separate helper is not a barrier
  // CodeQL recognizes for js/request-forgery) and fetch the VALIDATED URL object rather
  // than the raw string, so the loopback-host allowlist dominates the fetch sink here.
  let target: URL
  try { target = new URL(url) } catch {
    return NextResponse.json({ error: 'agent_machine_endpoint must be a localhost URL' }, { status: 400 })
  }
  // Guard on target.hostname DIRECTLY (URL already lowercases the host) so the loopback
  // allowlist is a barrier CodeQL's request-forgery recognizer ties to the fetch(target) below.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'agent_machine_endpoint must be a localhost URL' }, { status: 400 })
  }
  if (target.hostname !== 'localhost' && target.hostname !== '127.0.0.1' && target.hostname !== '::1' && target.hostname !== '[::1]') {
    return NextResponse.json({ error: 'agent_machine_endpoint must be a localhost URL' }, { status: 400 })
  }
  // Strip agent_machine_endpoint from the forwarded body to prevent infinite recursion
  // if the agent machine itself proxies to /api/chat.
  const { agent_machine_endpoint: _dropped, ...forwardBody } = body
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forwardBody),
      signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'agent_machine_unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => 'unknown')
    return NextResponse.json({ error: `agent_machine: ${text}` }, { status: 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
