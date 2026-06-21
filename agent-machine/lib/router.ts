/**
 * Prophet-mesh conductor+choir routing for local-first model selection.
 *
 * Classifies every incoming request by task type, selects the appropriate
 * local specialist model, and records a governed routing decision with full
 * evidence trail — mirroring the prophet-mesh model-task-policy contract.
 */

// ─── Task taxonomy (from prophet-mesh model-task-policy.yaml) ────────────────

export type TaskType =
  | 'chat'       // short conversational exchange
  | 'coding'     // implementation, debugging, review
  | 'reasoning'  // analysis, comparison, deep problem solving
  | 'writing'    // drafts, emails, documents
  | 'research'   // lookup, synthesis, citation
  | 'general'    // everything else

export type PolicyDecision = 'allow' | 'requires_approval' | 'deny'

export interface ModelRoute {
  task: TaskType
  domain: string
  localModel: string       // primary Ollama model
  fallbackModel: string    // secondary local model if primary unavailable
  cloudModel?: {           // vendor augmentation — only used when key is present
    provider: 'anthropic' | 'openai'
    model: string
  }
  specialistAgents: string[]
  policyDecision: PolicyDecision
  evidenceRequired: boolean
  rationale: string
}

export interface RouterDecision {
  requestId: string
  conductorId: string
  task: TaskType
  domain: string
  selectedRoute: string    // resolved model name that will actually run
  routeType: 'local_model' | 'open_model' | 'hosted_balanced' | 'hosted_frontier'
  fallbackRoute: string
  specialistAgents: string[]
  policyDecision: PolicyDecision
  rationale: string
  evidenceRef: string
  auditRef: string
  // Set only on the security-research path. Carries the self-attestation state and
  // which rung of the security lane was selected — recorded for the Govern audit.
  securityLane?: {
    armed: boolean       // true only when the operator self-attested
    attested: boolean
    rung: 'offensive' | 'defensive' | 'uncensored-fallback' | 'general-large' | 'disarmed'
    model: string
  }
  controls: {
    identity: boolean
    policy: boolean
    evidence: boolean
    attestation: boolean
    revocation: boolean
    audit: boolean
    tenant_isolation: boolean
  }
}

// ─── Task classification ──────────────────────────────────────────────────────

const CODE_RE = /\b(code|function|class|bug|debug|implement|typescript|python|javascript|rust|go|sql|api|refactor|test|error|exception|compile|build|deploy|script|module|import|export|variable|loop|array|object|type|interface|async|await|promise|callback|hook|component)\b/i
const CODE_SYNTAX_RE = /```|def |const |let |var |import |export |class |function |=>|==|!=|>=|<=|\?\?|\|\||&&/

const REASONING_RE = /\b(analyze|analyse|reason|explain why|compare|evaluate|critique|pros and cons|trade.?off|hypothesis|prove|derive|calculate|should i|which is better|what if|is it|why does|how does|difference between|versus|vs\.?)\b/i

const WRITING_RE = /\b(write|draft|email|letter|essay|blog|post|message|summarize|summarise|rewrite|improve|edit|compose|create a.*doc|proposal|report|cover letter|announcement)\b/i

const RESEARCH_RE = /\b(research|find|search|look up|what is|who is|when did|how does|latest|news|current|recent|tell me about|overview of|history of|explain)\b/i

// A question — by '?' or a leading interrogative — is a KNOWLEDGE task regardless
// of length. Short factual questions ("what does a DS earn?", "how much is X?")
// must NOT be dumped into the fast 'chat' bucket, which is the only route that can
// degrade to the tiny llama3.2:3b. Length ≠ triviality.
const QUESTION_LEAD_RE = /^(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|tell me|give me|list|name|define|how much|how many)\b/i

export function classifyTask(content: string): TaskType {
  const t = content.toLowerCase()

  if (CODE_RE.test(t) || CODE_SYNTAX_RE.test(content)) return 'coding'
  if (REASONING_RE.test(t)) return 'reasoning'
  if (WRITING_RE.test(t)) return 'writing'
  if (RESEARCH_RE.test(t)) return 'research'

  // Any interrogative → knowledge task on a capable model, even if short.
  if (content.includes('?') || QUESTION_LEAD_RE.test(content.trim())) return 'research'

  // Only genuinely casual, non-question short messages (greetings, acks) → fast chat.
  const words = content.trim().split(/\s+/).length
  if (words < 25) return 'chat'

  return 'general'
}

// ─── Security-research lane ───────────────────────────────────────────────────
// The compliance lane for the SECURITY_RESEARCHER profile. Arms ONLY under
// self-attestation (local-first: the operator attests, the mesh records it — there
// is no central vetter because there is no central server). The lane has three
// rungs, resolved by the request's offensive/defensive lean and what's installed:
//   1. purpose-built  — WhiteRabbitNeo (offensive lean) / Foundation-Sec (defensive)
//   2. uncensored     — dolphin3 (generic abliterated fallback)
//   3. general-large  — qwen2.5:14b (no uncensored model installed)
// The content-policy floor (CBRN/CSAM/explosives) is enforced upstream and is NOT
// lifted by this lane — it only changes which local model answers legitimate
// security-research work.

const OFFENSIVE_RE = /\b(exploit|payload|shellcode|reverse.?engineer|malware|ransomware|c2|command.and.control|privilege.escalation|rootkit|bypass|evasion|obfuscat|buffer.overflow|rop.chain|fuzz|pentest|red.?team|backdoor|keylogger|injection|xss|sqli|csrf|deserializ|disassembl|decompil)\b/i
const DEFENSIVE_RE = /\b(detect|defen[sc]|harden|mitigat|blue.?team|incident.response|forensic|siem|threat.intel|signature|yara|audit|patch|remediat|monitor|hunt)\b/i

// Canonical Ollama tags for the purpose-built security models. These are the
// community GGUF builds that actually resolve in the registry:
//   WhiteRabbitNeo — jimscard's well-maintained 13B GGUF
//   Foundation-Sec — Cisco's model via the huihui_ai abliteration line (no refusals)
export const SEC_OFFENSIVE_MODEL = 'jimscard/whiterabbit-neo:13b'
export const SEC_DEFENSIVE_MODEL = 'huihui_ai/foundation-sec-abliterated:8b'

function resolveSecurityModel(
  content: string,
  available: string[],
): { model: string; rung: NonNullable<RouterDecision['securityLane']>['rung'] } {
  const offensive = OFFENSIVE_RE.test(content)
  const defensive = DEFENSIVE_RE.test(content)
  // WhiteRabbitNeo covers both but leans offensive; Foundation-Sec leans defensive.
  // Order the purpose-built rung by the detected lean; default to offensive-first.
  const purposeBuilt: Array<[string, 'offensive' | 'defensive']> =
    defensive && !offensive
      ? [[SEC_DEFENSIVE_MODEL, 'defensive'], [SEC_OFFENSIVE_MODEL, 'offensive']]
      : [[SEC_OFFENSIVE_MODEL, 'offensive'], [SEC_DEFENSIVE_MODEL, 'defensive']]

  for (const [name, lean] of purposeBuilt) {
    if (isModelAvailable(name, available)) return { model: name, rung: lean }
  }
  if (isModelAvailable('dolphin3:8b', available)) return { model: 'dolphin3:8b', rung: 'uncensored-fallback' }
  return { model: 'qwen2.5:14b', rung: 'general-large' }
}

// ─── Model routing table ──────────────────────────────────────────────────────
// Maps each task type to the specialist local model plus cloud augmentation.
// Cloud models are ONLY used when a vendor API key is present in the request.

const ROUTING_TABLE: Record<TaskType, Omit<ModelRoute, 'task'>> = {
  chat: {
    domain: 'conversation',
    localModel: 'qwen2.5:7b',
    fallbackModel: 'llama3.2:3b',
    cloudModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    specialistAgents: ['governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'General conversational exchange — qwen2.5:7b is capable and fast enough for chat.',
  },
  coding: {
    domain: 'engineering',
    localModel: 'qwen2.5-coder:7b',
    fallbackModel: 'qwen2.5:7b',
    cloudModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    specialistAgents: ['coding-agent', 'governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'Code-specialized model for implementation, debugging, and review.',
  },
  reasoning: {
    domain: 'analysis',
    localModel: 'deepseek-r1:8b',
    fallbackModel: 'qwen2.5:7b',
    cloudModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    specialistAgents: ['planning-agent', 'analytics-agent', 'governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'DeepSeek R1 reasoning model for complex analysis and multi-step problems.',
  },
  writing: {
    domain: 'communications',
    localModel: 'qwen2.5:7b',
    fallbackModel: 'deepseek-r1:8b',
    cloudModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    specialistAgents: ['writing-agent', 'governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'General-purpose model for writing, drafting, and communication tasks.',
  },
  research: {
    domain: 'knowledge',
    localModel: 'qwen2.5:7b',
    fallbackModel: 'deepseek-r1:8b',
    cloudModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    specialistAgents: ['research-agent', 'governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'General model with tool use for research and knowledge synthesis.',
  },
  general: {
    domain: 'general',
    localModel: 'qwen2.5:7b',
    fallbackModel: 'deepseek-r1:8b',
    cloudModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    specialistAgents: ['governance-sentinel'],
    policyDecision: 'allow',
    evidenceRequired: true,
    rationale: 'General-purpose model for open-ended tasks.',
  },
}

// ─── Conductor routing decision ───────────────────────────────────────────────

export function buildRouterDecision(opts: {
  requestId: string
  content: string
  ollamaAvailable: boolean
  availableModels: string[]
  hasAnthropicKey: boolean
  hasOpenAIKey: boolean
  explicitModelId?: string
  policyProfile?: string
  securityAttested?: boolean  // operator self-attestation — arms the uncensored security lane
  hasImages?: boolean
  hasTools?: boolean
  taskOverride?: TaskType  // from the 22-intent classifier; wins over keyword classifyTask
}): RouterDecision & { resolvedModel: string; resolvedProvider: 'ollama' | 'anthropic' | 'openai' } {
  const {
    requestId, content, ollamaAvailable, availableModels,
    hasAnthropicKey, hasOpenAIKey, explicitModelId, policyProfile, hasImages,
  } = opts

  // The structured intent classifier (intent-router) is authoritative when it
  // resolves a task; classifyTask is the keyword fallback for when it doesn't.
  const task = opts.taskOverride ?? classifyTask(content)
  const route = ROUTING_TABLE[task]

  // Vision: route to LLaVA when images are present
  if (!explicitModelId && hasImages && ollamaAvailable) {
    const visionModel = isModelAvailable('llava:13b', availableModels) ? 'llava:13b'
      : isModelAvailable('llava:7b', availableModels) ? 'llava:7b'
      : isModelAvailable('llava', availableModels) ? 'llava'
      : null
    if (visionModel) {
      return {
        requestId,
        conductorId: 'noetica-conductor',
        task,
        domain: 'vision',
        selectedRoute: visionModel,
        routeType: 'local_model',
        fallbackRoute: 'llava:7b',
        specialistAgents: ['vision-agent'],
        policyDecision: 'allow',
        rationale: `Vision request — routing to ${visionModel} for image understanding.`,
        evidenceRef: `evidence:${requestId}`,
        auditRef: `audit:${requestId}`,
        controls: FULL_CONTROLS,
        resolvedModel: visionModel,
        resolvedProvider: 'ollama',
      }
    }
    // LLaVA not installed — fall through to cloud path with vision capable model
  }

  // Security-research profile. Local-first self-attestation: the uncensored lane
  // arms ONLY when the operator has attested (settings.securityAttestation). Without
  // attestation the lane stays disarmed — we route to the standard local model and
  // record the requested-but-disarmed state for the audit trail. Either way the
  // decision is deterministic and carries a securityLane record for Govern.
  if (!explicitModelId && policyProfile === 'security' && ollamaAvailable) {
    if (!opts.securityAttested) {
      const safe = isModelAvailable(route.localModel, availableModels)
        ? route.localModel
        : route.fallbackModel
      return {
        requestId,
        conductorId: 'noetica-conductor',
        task,
        domain: 'security',
        selectedRoute: safe,
        routeType: 'local_model',
        fallbackRoute: route.fallbackModel,
        specialistAgents: ['governance-sentinel'],
        policyDecision: 'allow',
        rationale: `SECURITY_RESEARCHER profile requested WITHOUT self-attestation — security lane DISARMED; routing to standard local model (${safe}). Accept the attestation in Settings → Policy to arm the uncensored lane.`,
        evidenceRef: `evidence:${requestId}`,
        auditRef: `audit:${requestId}`,
        controls: FULL_CONTROLS,
        securityLane: { armed: false, attested: false, rung: 'disarmed', model: safe },
        resolvedModel: safe,
        resolvedProvider: 'ollama',
      }
    }

    const { model: secModel, rung } = resolveSecurityModel(content, availableModels)
    return {
      requestId,
      conductorId: 'noetica-conductor',
      task,
      domain: 'security',
      selectedRoute: secModel,
      routeType: 'local_model',
      fallbackRoute: isModelAvailable('dolphin3:8b', availableModels) ? 'dolphin3:8b' : 'qwen2.5:14b',
      specialistAgents: ['security-agent', 'governance-sentinel'],
      policyDecision: 'allow',
      rationale: `CITIZEN_FOG / SECURITY_RESEARCHER profile (self-attested) — armed ${rung} security lane → ${secModel}. Sovereign local compute; CBRN/CSAM/explosives content floor still enforced upstream.`,
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      securityLane: { armed: true, attested: true, rung, model: secModel },
      resolvedModel: secModel,
      resolvedProvider: 'ollama',
    }
  }

  // If caller explicitly named a model, respect it
  if (explicitModelId) {
    const isOllama = !explicitModelId.startsWith('claude') && !explicitModelId.startsWith('gpt') && !explicitModelId.startsWith('o1') && !explicitModelId.startsWith('o3')
    const isOpenAI = explicitModelId.startsWith('gpt') || explicitModelId.startsWith('o1') || explicitModelId.startsWith('o3') || explicitModelId.startsWith('o4')
    const provider = isOllama ? 'ollama' : isOpenAI ? 'openai' : 'anthropic'
    return {
      requestId,
      conductorId: 'noetica-conductor',
      task,
      domain: route.domain,
      selectedRoute: explicitModelId,
      routeType: isOllama ? 'local_model' : 'hosted_balanced',
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: `Explicit model override: ${explicitModelId}`,
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: explicitModelId,
      resolvedProvider: provider,
    }
  }

  // Local-first: try primary local model
  if (ollamaAvailable) {
    const primary = route.localModel
    const fallback = route.fallbackModel

    // If this request carries tools, never route to a model that can't use them.
    // Upgrade the conductor (llama3.2:3b) to the first available tool-capable model.
    const needsToolUse = opts.hasTools ?? false
    const resolveToolCapable = () => {
      const capable = LOCAL_MODEL_SUITE
        .filter(m => m.toolUse)
        .sort((a, b) => a.priority - b.priority)
      return capable.find(m => isModelAvailable(m.name, availableModels))?.name
        ?? capable[0]?.name
        ?? 'qwen2.5:7b'
    }

    const toolCapable = (name: string) => LOCAL_MODEL_SUITE.find(m => m.name === name)?.toolUse !== false
    const candidatePrimary = (needsToolUse && !toolCapable(primary))
      ? resolveToolCapable()
      : primary
    // The fallback must ALSO respect the tool requirement — otherwise a tool
    // request whose upgraded primary isn't installed could fall back to a
    // tool-incapable model (e.g. deepseek-r1), which Ollama 400s on.
    const safeFallback = (needsToolUse && !toolCapable(fallback))
      ? resolveToolCapable()
      : fallback

    const modelToUse = isModelAvailable(candidatePrimary, availableModels) ? candidatePrimary
      : isModelAvailable(safeFallback, availableModels) ? safeFallback
      : candidatePrimary // will trigger auto-pull by Ollama

    return {
      requestId,
      conductorId: 'noetica-conductor',
      task,
      domain: route.domain,
      selectedRoute: modelToUse,
      routeType: 'local_model',
      fallbackRoute: fallback,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: route.rationale,
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: modelToUse,
      resolvedProvider: 'ollama',
    }
  }

  // Ollama unavailable — fall back to cloud augmentation if a key is present
  if (route.cloudModel) {
    const { provider, model } = route.cloudModel
    const keyAvailable = provider === 'anthropic' ? hasAnthropicKey : hasOpenAIKey
    if (keyAvailable) {
      return {
        requestId,
        conductorId: 'noetica-conductor',
        task,
        domain: route.domain,
        selectedRoute: model,
        routeType: 'hosted_balanced',
        fallbackRoute: route.fallbackModel,
        specialistAgents: route.specialistAgents,
        policyDecision: route.policyDecision,
        rationale: `Local Ollama unavailable — routing to cloud augmentation (${provider}/${model}).`,
        evidenceRef: `evidence:${requestId}`,
        auditRef: `audit:${requestId}`,
        controls: FULL_CONTROLS,
        resolvedModel: model,
        resolvedProvider: provider,
      }
    }
  }

  // Try other cloud key
  if (hasAnthropicKey) {
    return {
      requestId,
      conductorId: 'noetica-conductor',
      task,
      domain: route.domain,
      selectedRoute: 'claude-sonnet-4-6',
      routeType: 'hosted_balanced',
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: 'Local Ollama unavailable — routing to Anthropic Claude.',
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: 'claude-sonnet-4-6',
      resolvedProvider: 'anthropic',
    }
  }

  if (hasOpenAIKey) {
    return {
      requestId,
      conductorId: 'noetica-conductor',
      task,
      domain: route.domain,
      selectedRoute: 'gpt-4o',
      routeType: 'hosted_balanced',
      fallbackRoute: route.fallbackModel,
      specialistAgents: route.specialistAgents,
      policyDecision: route.policyDecision,
      rationale: 'Local Ollama unavailable — routing to OpenAI GPT-4o.',
      evidenceRef: `evidence:${requestId}`,
      auditRef: `audit:${requestId}`,
      controls: FULL_CONTROLS,
      resolvedModel: 'gpt-4o',
      resolvedProvider: 'openai',
    }
  }

  // Nothing available
  throw new Error('No local Ollama runtime and no cloud API key. Start Ollama or add an API key in Settings.')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isModelAvailable(model: string, available: string[]): boolean {
  const base = model.split(':')[0]!
  return available.some((m) => m === model || m.startsWith(base))
}

const FULL_CONTROLS = {
  identity: true,
  policy: true,
  evidence: true,
  attestation: true,
  revocation: true,
  audit: true,
  tenant_isolation: true,
}

// ─── Model suite definition ───────────────────────────────────────────────────
// Used by the first-run setup and status API.

// Derived from prophet-mesh.manifest.json — this is the canonical model list.
// tool_use: false means the model cannot reliably execute function calls and must
// be restricted to chat/conductor tasks only.
export const LOCAL_MODEL_SUITE = [
  {
    name: 'nomic-embed-text',
    role: 'embedding',
    description: 'Text embedding model — used for semantic similarity and MERGE_PROPOSAL',
    priority: 1,
    sizeGb: 0.3,
    toolUse: false,
  },
  {
    name: 'llama3.2:3b',
    role: 'conductor',
    description: 'Fast conductor — conversational routing only, no tool use',
    priority: 2,
    sizeGb: 2.0,
    toolUse: false,
  },
  {
    name: 'qwen2.5:7b',
    role: 'general',
    description: 'General-purpose workhorse — writing, research, open-ended tasks',
    priority: 3,
    sizeGb: 4.7,
    toolUse: true,
  },
  {
    name: 'qwen2.5-coder:7b',
    role: 'coding',
    description: 'Code-specialized model — implementation, debugging, review',
    priority: 4,
    sizeGb: 4.7,
    toolUse: true,
  },
  {
    name: 'deepseek-r1:8b',
    role: 'reasoning',
    description: 'Reasoning model — analysis, complex problem solving',
    priority: 5,
    sizeGb: 4.9,
    // DeepSeek-R1 does NOT support the tools API in Ollama (returns 400 if tools
    // are sent). It reasons natively instead — never pass it a tool schema.
    toolUse: false,
  },
  {
    name: 'qwen2.5:14b',
    role: 'general-large',
    description: 'Strongest local general model — writing, research, complex open-ended tasks',
    priority: 6,
    sizeGb: 9.0,
    toolUse: true,
  },
  {
    name: 'dolphin3:8b',
    role: 'uncensored',
    description: 'Uncensored generic fallback — abliterated; security-lane rung 2 when no purpose-built security model is installed. Opt-in.',
    priority: 7,
    sizeGb: 4.9,
    toolUse: true,
  },
  {
    name: 'huihui_ai/foundation-sec-abliterated:8b',
    role: 'security-defensive',
    description: 'Cisco Foundation-Sec (huihui_ai abliterated) — defensive/blue-team security model (threat analysis, detection, hardening, forensics), refusal-free. Security-lane defensive rung. Opt-in under attested security profile.',
    priority: 9,
    sizeGb: 4.9,
    toolUse: true,
  },
  {
    name: 'jimscard/whiterabbit-neo:13b',
    role: 'security-offensive',
    description: 'WhiteRabbitNeo 13B (GGUF) — purpose-built offensive+defensive cybersecurity model (exploit dev, pentest, reverse engineering, CTF). Security-lane offensive rung. Opt-in under attested security profile.',
    priority: 10,
    sizeGb: 9.2,
    toolUse: true,
  },
  {
    name: 'llava:13b',
    role: 'vision',
    description: 'Vision model — activated automatically when images are pasted or attached',
    priority: 8,
    sizeGb: 8.0,
    toolUse: false,
  },
] as const

export type LocalModel = (typeof LOCAL_MODEL_SUITE)[number]
