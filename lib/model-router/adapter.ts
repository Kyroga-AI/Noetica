import { defaultModelId, models } from '@/config/models'
import type { ModelConfig } from '@/lib/types/model'
import type { ModelRouteDecision, ModelRouteRequest, ModelRouteTarget } from '@/lib/types/model-router'

// Authority boundary: Noetica may request or display a model route, but model
// routing authority belongs to github.com/SocioProphet/model-router. This stub
// deliberately performs no live route optimization, budget check, provider health
// check, quota check, or policy escalation.
export async function routeModel(request: ModelRouteRequest): Promise<ModelRouteDecision> {
  const model = selectStubModel(request.model_hint)
  const routeTarget = inferRouteTarget(model)

  return {
    schema_version: 'noetica.model_route.v0.1',
    status: 'stubbed',
    request_id: request.request_id,
    route_decided_at: new Date().toISOString(),
    authority: 'SocioProphet/model-router',
    live_route_performed: false,
    model_hint: request.model_hint,
    model_routed: model.id,
    provider: model.provider,
    model_overridden: Boolean(request.model_hint && request.model_hint !== model.id),
    route_target: routeTarget,
    cost_class: routeTarget === 'base-local' ? 'local-cheap' : 'standard',
    prompt_egress: routeTarget === 'hosted' ? 'allow-with-policy' : 'deny',
    policy_ref: request.policy_ref ?? 'guardrail-fabric://pending/noetica-model-route-stub',
    budget_ref: request.budget_ref,
    privacy_ref: request.privacy_ref,
    evidence_required: ['ModelRouteDecision', 'ExternalModelProviderRouteEvidence'],
    route_evidence_ref: 'agentplane://pending/noetica-model-route-stub',
    notes: [
      'Noetica model-router adapter is a contract stub.',
      'No live model-router call was performed.',
      'No budget, provider-health, quota, or escalation decision is authoritative in this stub.'
    ]
  }
}

function selectStubModel(modelHint?: string): ModelConfig {
  return models.find((model) => model.id === modelHint) ?? models.find((model) => model.id === defaultModelId) ?? models[0]
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
