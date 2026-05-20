import { evidenceHash, sha256Hex } from '@/lib/evidence/hash'
import type { ExternalModelProviderRouteEvidence, ExternalProviderClass } from '@/lib/types/agentplane'
import type { ModelConfig } from '@/lib/types/model'

type BuildRouteEvidenceInput = {
  model: ModelConfig
  providerModelId: string
  runId: string
  capturedAt: string
  prompt: string
  latencyMs: number
  status: 'success' | 'failure' | 'blocked'
  errorRef?: string | null
}

export function buildExternalModelProviderRouteEvidence(
  input: BuildRouteEvidenceInput
): ExternalModelProviderRouteEvidence {
  const providerClass = providerToClass(input.model.provider)
  const providerRef = `${input.model.provider}:${input.providerModelId}`
  const policyPosture = {
    promptEgressDefault: 'allow-with-policy',
    authInline: false,
    storesPrompt: false,
    storesCompletion: false,
    allowTrainingUse: false,
    providerClass
  }

  return {
    kind: 'ExternalModelProviderRouteEvidence',
    capturedAt: input.capturedAt,
    workspaceId: 'noetica-standalone',
    bundle: null,
    agentRunRef: input.runId,
    executor: 'noetica',
    backendIntent: 'external-model-provider',
    providerRef,
    providerClass,
    owner: 'workspace',
    operation: 'route',
    status: input.status,
    networkAccessProfileRef: 'noetica-standalone-egress',
    firewallBindingRef: null,
    meshBindingRef: null,
    modelRouterBindingRef: null,
    taskClass: 'standalone-chat',
    routeTarget: 'hosted',
    endpoint: {
      baseUrlRef: `${input.model.provider}-default-endpoint`,
      authRef: `${input.model.provider}-runtime-env`,
      tlsPolicyRef: null,
      endpointHash: null,
      endpointStored: false
    },
    contactsProvider: input.status === 'success',
    providerHealth: {
      checked: true,
      status: input.status === 'success' ? 'available' : input.status === 'blocked' ? 'blocked' : 'unavailable',
      latencyMs: input.latencyMs,
      errorRef: input.errorRef ?? null
    },
    promptHash: sha256Hex(input.prompt),
    promptStored: false,
    promptEgressDefault: 'allow-with-policy',
    storesPrompt: false,
    storesCompletion: false,
    allowTrainingUse: false,
    requiresDpaOrEnterpriseTerms: true,
    requiresUserConsentForPersonalData: true,
    authInline: false,
    authRefRequired: true,
    sideEffects: {
      contactedExternalProvider: input.status === 'success' || input.status === 'failure',
      sentPrompt: input.status === 'success' || input.status === 'failure',
      storedCredentials: false,
      requiresPolicyApproval: false
    },
    policyHash: evidenceHash(policyPosture),
    policyRefs: ['noetica-standalone-m2a-policy'],
    redactionSummary: {
      endpointRedacted: true,
      promptTextRedacted: true,
      secretLikeValuesRedacted: 0,
      notes: 'Noetica records hashes and route posture only; prompt text, completion text, and runtime key material are not stored in this artifact.'
    }
  }
}

function providerToClass(provider: ModelConfig['provider']): ExternalProviderClass {
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'openai') return 'openai-compatible'
  if (provider === 'google') return 'google-vertex'
  return 'other'
}
