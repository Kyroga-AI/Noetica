export type ExternalProviderClass =
  | 'openai-compatible'
  | 'anthropic'
  | 'google-vertex'
  | 'azure-openai'
  | 'aws-bedrock'
  | 'enterprise-private'
  | 'user-private'
  | 'other'

export interface ExternalModelProviderRouteEvidence {
  kind: 'ExternalModelProviderRouteEvidence'
  capturedAt: string
  workspaceId: string
  bundle?: string | null
  agentRunRef?: string | null
  executor?: string | null
  backendIntent: 'external-model-provider'
  providerRef: string
  providerClass: ExternalProviderClass
  owner: 'user' | 'enterprise' | 'workspace' | 'tenant' | 'device'
  operation: 'plan' | 'route' | 'health-check' | 'evidence-inspect'
  status: 'planned' | 'success' | 'failure' | 'blocked' | 'requires-policy'
  networkAccessProfileRef: string
  firewallBindingRef?: string | null
  meshBindingRef?: string | null
  modelRouterBindingRef?: string | null
  taskClass?: string | null
  routeTarget?: 'base-local' | 'personal-local' | 'quality-local' | 'hosted' | 'byom' | 'enterprise-private' | 'deny' | null
  endpoint?: {
    baseUrlRef?: string | null
    authRef?: string | null
    tlsPolicyRef?: string | null
    endpointHash?: string | null
    endpointStored?: boolean
  }
  contactsProvider?: boolean
  providerHealth?: {
    checked?: boolean
    status?: 'available' | 'unavailable' | 'skipped' | 'blocked' | null
    latencyMs?: number | null
    errorRef?: string | null
  } | null
  promptHash?: string | null
  promptStored?: boolean
  promptEgressDefault: 'deny' | 'allow-with-policy' | 'allow'
  storesPrompt?: boolean
  storesCompletion?: boolean
  allowTrainingUse?: boolean
  requiresDpaOrEnterpriseTerms?: boolean
  requiresUserConsentForPersonalData?: boolean
  authInline: boolean
  authRefRequired?: boolean
  sideEffects?: {
    contactedExternalProvider?: boolean
    sentPrompt?: boolean
    storedCredentials?: boolean
    requiresPolicyApproval?: boolean
  }
  policyHash: string
  policyRefs?: string[]
  redactionSummary?: {
    endpointRedacted?: boolean
    promptTextRedacted?: boolean
    secretLikeValuesRedacted?: number
    notes?: string
  }
}
