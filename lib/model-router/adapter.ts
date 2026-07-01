import { defaultModelId, models } from '@/config/models'
import type { ModelConfig } from '@/lib/types/model'
import type { Provider } from '@/lib/types/model'
import type { ModelRouteDecision, ModelRouteCostClass, ModelRouteRequest, ModelRouteTarget } from '@/lib/types/model-router'

// Noetica-local routing. When the external SocioProphet/model-router authority is
// unavailable, this adapter performs best-effort local routing: it verifies the
// requested model's provider has a key, falls back to an alternative provider if
// not, and blocks the request if no provider is reachable. Status is 'routed' for
// a successful local decision, 'blocked' if no viable provider exists.
export async function routeModel(request: ModelRouteRequest): Promise<ModelRouteDecision> {
  const available = request.available_providers ?? []
  const hasAvailability = available.length > 0

  const preferred = selectPreferredModel(request.model_hint, request.provider_hint)

  // Provider is available — route directly
  if (!hasAvailability || available.includes(preferred.provider)) {
    return buildDecision(request, preferred, 'routed', hasAvailability, null)
  }

  // Try to find a fallback model from an available provider
  const fallback = findFallbackModel(preferred, available)
  if (fallback) {
    return buildDecision(request, fallback, 'routed', true, `Requested provider '${preferred.provider}' unavailable — routed to '${fallback.provider}'`)
  }

  // No viable provider
  return {
    schema_version: 'noetica.model_route.v0.1',
    status: 'blocked',
    request_id: request.request_id,
    route_decided_at: new Date().toISOString(),
    authority: 'SocioProphet/model-router',
    live_route_performed: false,
    model_hint: request.model_hint,
    model_routed: preferred.id,
    provider: preferred.provider,
    model_overridden: false,
    route_target: 'deny',
    cost_class: 'no-model',
    prompt_egress: 'deny',
    policy_ref: request.policy_ref,
    budget_ref: request.budget_ref,
    privacy_ref: request.privacy_ref,
    evidence_required: ['ModelRouteDecision'],
    blocked_reason: `No available provider for requested model '${preferred.id}'. Available: [${available.join(', ')}]`,
    notes: ['Local routing blocked — no provider key found for any viable model.']
  }
}

function buildDecision(
  request: ModelRouteRequest,
  model: ModelConfig,
  status: 'routed',
  liveRoute: boolean,
  degradationReason: string | null,
): ModelRouteDecision {
  const routeTarget = inferRouteTarget(model)
  const costClass = inferCostClass(model)
  const overridden = Boolean(request.model_hint && request.model_hint !== model.id)

  return {
    schema_version: 'noetica.model_route.v0.1',
    status,
    request_id: request.request_id,
    route_decided_at: new Date().toISOString(),
    authority: 'SocioProphet/model-router',
    live_route_performed: liveRoute,
    model_hint: request.model_hint,
    model_routed: model.id,
    provider: model.provider,
    model_overridden: overridden,
    route_target: routeTarget,
    cost_class: costClass,
    prompt_egress: routeTarget === 'hosted' ? 'allow-with-policy' : 'allow',
    policy_ref: request.policy_ref ?? 'guardrail-fabric://noetica/local-default',
    budget_ref: request.budget_ref,
    privacy_ref: request.privacy_ref,
    evidence_required: ['ModelRouteDecision', 'ExternalModelProviderRouteEvidence'],
    route_evidence_ref: `agentplane://noetica/local-route/${request.request_id}`,
    ...(degradationReason ? { degradation_reason: degradationReason } : {}),
    notes: liveRoute
      ? ['Local routing performed — provider key verified.']
      : ['Provider key availability unknown — routing on model hint alone.']
  }
}

// Provider priority order for fallback selection
const PROVIDER_PRIORITY: Provider[] = ['anthropic', 'openai', 'google', 'mistral', 'meta']

function findFallbackModel(original: ModelConfig, available: Provider[]): ModelConfig | null {
  // Prefer same capability class, then degrade gracefully
  const candidates = models.filter((m) => available.includes(m.provider))
  if (candidates.length === 0) return null
  // Prefer highest priority provider
  for (const provider of PROVIDER_PRIORITY) {
    const m = candidates.find((c) => c.provider === provider)
    if (m) return m
  }
  return candidates[0] ?? null
}

function selectPreferredModel(modelHint?: string, providerHint?: Provider): ModelConfig {
  if (modelHint) {
    const exact = models.find((m) => m.id === modelHint)
    if (exact) return exact
  }
  if (providerHint) {
    const byProvider = models.find((m) => m.provider === providerHint)
    if (byProvider) return byProvider
  }
  return models.find((m) => m.id === defaultModelId) ?? models[0]
}

function inferRouteTarget(model: ModelConfig): ModelRouteTarget {
  if (model.local_capable && (model.provider === 'meta' || model.provider === 'neuronpedia')) {
    return 'base-local'
  }
  if (model.provider === 'openai' || model.provider === 'anthropic' || model.provider === 'google' || model.provider === 'mistral') {
    return 'hosted'
  }
  return 'deny'
}

function inferCostClass(model: ModelConfig): ModelRouteCostClass {
  if (model.local_capable) return 'local-cheap'
  const id = model.id.toLowerCase()
  if (id.includes('haiku') || id.includes('mini') || id.includes('nano') || id.includes('flash')) return 'cheap'
  if (id.includes('opus') || id.includes('pro')) return 'high-end'
  return 'standard'
}
