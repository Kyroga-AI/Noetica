import { evidenceHash } from '@/lib/evidence/hash'
import { models } from '@/config/models'
import { streamAnthropic } from '@/lib/providers/anthropic'
import { streamOpenAI } from '@/lib/providers/openai'
import { resolveProviderModelId } from '@/lib/providers/resolver'
import { routeModel } from '@/lib/model-router/adapter'
import type { NoeticaTaskInput, NoeticaTaskResult } from '@/lib/types/task'
import type { ChatMessage } from '@/lib/types/message'

export type { NoeticaTaskInput, NoeticaTaskResult } from '@/lib/types/task'

// Authority boundary: Noetica owns this adapter interface only. Real routing and
// task execution belong to github.com/SocioProphet/superconscious. Until a live
// superconscious endpoint is wired, SourceOS mode falls back to direct provider
// execution with full governance metadata — identical to standalone mode but
// wrapped in the SourceOS task result envelope.
export async function submitTask(input: NoeticaTaskInput): Promise<NoeticaTaskResult> {
  const started = Date.now()

  if (input.mode === 'standalone') {
    return standaloneBypass(input, started)
  }

  // SourceOS mode — execute via direct providers as a local fallback.
  // When a live SocioProphet/superconscious endpoint is available, replace
  // executeDirectProviderFallback with a call to that endpoint.
  return executeDirectProviderFallback(input, started)
}

function standaloneBypass(input: NoeticaTaskInput, started: number): NoeticaTaskResult {
  const timestamp = new Date().toISOString()
  return {
    schema_version: 'noetica.task.v0.1',
    status: 'stubbed',
    run_id: `standalone-bypass-${crypto.randomUUID()}`,
    content: 'Standalone mode bypasses the Superconscious adapter. Direct provider calls are handled by Noetica local standalone routing.',
    model_routed: input.model_hint ?? 'standalone-provider-router',
    provider: 'noetica-standalone',
    model_overridden: false,
    policy_admitted: true,
    policy_ref: 'noetica://standalone/local-policy',
    grant_refs: { requested: input.tool_grant_refs, resolved: [], missing: input.tool_grant_refs },
    memory_written: false,
    memory_scope_ref: input.memory_scope_ref,
    evidence_ref: input.agentplane_evidence_ref ?? 'agentplane://not-used/standalone-bypass',
    request_hash: input.request_hash,
    evidence_hash: evidenceHash({ mode: input.mode, request_hash: input.request_hash, status: 'stubbed', timestamp }),
    timestamp,
    latency_ms: Date.now() - started
  }
}

async function executeDirectProviderFallback(input: NoeticaTaskInput, started: number): Promise<NoeticaTaskResult> {
  const timestamp = new Date().toISOString()
  const run_id = `sourceos-local-${crypto.randomUUID()}`

  // Resolve model + provider via the model-router
  const availableProviders = Object.entries(input.provider_keys ?? {})
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k) as Array<'anthropic' | 'openai' | 'google' | 'mistral'>

  const routeDecision = await routeModel({
    schema_version: 'noetica.model_route.v0.1',
    request_id: crypto.randomUUID(),
    session_id: input.session_id,
    agent_id: 'noetica',
    mode: 'sourceos',
    task_class: 'sourceos-chat',
    model_hint: input.model_hint,
    available_providers: availableProviders.length > 0 ? availableProviders : undefined,
  })

  if (routeDecision.status === 'blocked') {
    return {
      schema_version: 'noetica.task.v0.1',
      status: 'blocked',
      run_id,
      content: routeDecision.blocked_reason ?? 'No provider available for SourceOS task.',
      model_routed: routeDecision.model_routed,
      provider: routeDecision.provider,
      model_overridden: false,
      policy_admitted: false,
      grant_refs: { requested: input.tool_grant_refs, resolved: [], missing: input.tool_grant_refs },
      memory_written: false,
      memory_scope_ref: input.memory_scope_ref,
      request_hash: input.request_hash,
      evidence_hash: evidenceHash({ mode: input.mode, run_id, status: 'blocked', timestamp }),
      timestamp,
      latency_ms: Date.now() - started
    }
  }

  const model = models.find((m) => m.id === routeDecision.model_routed) ?? models[0]
  if (model.provider !== 'openai' && model.provider !== 'anthropic') {
    return unavailableResult(input, run_id, started, timestamp, `Provider '${model.provider}' not implemented in local fallback.`)
  }

  const providerModelId = resolveProviderModelId(model)
  const messages: ChatMessage[] = input.messages ?? [{
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: input.message,
    created_at: new Date().toISOString(),
  }]

  try {
    const USAGE_PFX = '\x00usage\x00'
    const TOOL_PFX = '\x00tool_calls\x00'
    let content = ''
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    const providerStream = model.provider === 'openai'
      ? streamOpenAI({ model: providerModelId, messages, systemPrompt: input.system_prompt, apiKey: input.provider_keys?.openai })
      : streamAnthropic({ model: providerModelId, messages, systemPrompt: input.system_prompt, apiKey: input.provider_keys?.anthropic })

    for await (const delta of providerStream) {
      if (delta.startsWith(USAGE_PFX)) {
        const usage = JSON.parse(delta.slice(USAGE_PFX.length)) as { input_tokens?: number; output_tokens?: number }
        inputTokens = usage.input_tokens
        outputTokens = usage.output_tokens
      } else if (!delta.startsWith(TOOL_PFX) && !delta.startsWith('\x00thinking\x00')) {
        content += delta
      }
    }

    const latency_ms = Date.now() - started
    const evidence_hash = evidenceHash({
      mode: input.mode, run_id, model_id: model.id, prompt: input.message, response: content, timestamp
    })

    return {
      schema_version: 'noetica.task.v0.1',
      status: 'success',
      run_id,
      content,
      model_routed: model.id,
      provider: model.provider,
      model_overridden: routeDecision.model_overridden,
      policy_admitted: true,
      policy_ref: 'noetica://sourceos/local-direct-provider-fallback',
      grant_refs: { requested: input.tool_grant_refs, resolved: [], missing: input.tool_grant_refs },
      memory_written: false,
      memory_scope_ref: input.memory_scope_ref,
      request_hash: input.request_hash,
      evidence_hash,
      timestamp,
      latency_ms,
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    } as NoeticaTaskResult
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return unavailableResult(input, run_id, started, timestamp, `Provider call failed: ${msg}`)
  }
}

function unavailableResult(
  input: NoeticaTaskInput,
  run_id: string,
  started: number,
  timestamp: string,
  reason: string
): NoeticaTaskResult {
  return {
    schema_version: 'noetica.task.v0.1',
    status: 'unavailable',
    run_id,
    content: reason,
    model_routed: input.model_hint ?? 'model-router-pending',
    provider: 'superconscious',
    model_overridden: false,
    policy_admitted: false,
    grant_refs: { requested: input.tool_grant_refs, resolved: [], missing: input.tool_grant_refs },
    memory_written: false,
    memory_scope_ref: input.memory_scope_ref,
    request_hash: input.request_hash,
    evidence_hash: evidenceHash({ mode: input.mode, run_id, status: 'unavailable', timestamp }),
    timestamp,
    latency_ms: Date.now() - started
  }
}
