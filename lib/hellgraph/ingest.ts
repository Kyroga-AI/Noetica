import { getHellGraph } from './store'

/**
 * Ingestion: project Noetica runtime activity into the HellGraph substrate.
 *
 * Each governed interaction becomes a small subgraph:
 *
 *   (Session) -[:HAS_INTERACTION]-> (Interaction) -[:ROUTED_TO]-> (Model)
 *                                        |                           |
 *                                  [:PRODUCED]                 [:OFFERED_BY]
 *                                        v                           v
 *                                   (Evidence)                  (Provider)
 *
 * The Time Service is the graph's append-only log; ingestion advances the
 * logical clock, so operational health and replay windows are derived, not
 * mocked.
 */

export interface InteractionFact {
  runId: string
  sessionId: string
  modelRouted: string
  provider: string
  promptSummary: string
  responseSummary: string
  evidenceHash: string
  policyAdmitted: boolean
  steeringFeatureId?: string
  latencyMs: number
  timestamp: string
}

export function ingestInteraction(fact: InteractionFact): void {
  const g = getHellGraph()

  const sessionNode = `urn:noetica:session:${fact.sessionId}`
  const interactionNode = `urn:noetica:interaction:${fact.runId}`
  const modelNode = `urn:noetica:model:${fact.modelRouted}`
  const providerNode = `urn:noetica:provider:${fact.provider}`
  const evidenceNode = `urn:noetica:evidence:${fact.evidenceHash}`

  g.addNode(sessionNode, ['Session'], { sessionId: fact.sessionId })
  g.addNode(interactionNode, ['Interaction', 'ProviderCall'], {
    runId: fact.runId,
    promptSummary: fact.promptSummary.slice(0, 280),
    responseSummary: fact.responseSummary.slice(0, 280),
    policyAdmitted: fact.policyAdmitted,
    latencyMs: fact.latencyMs,
    timestamp: fact.timestamp,
  })
  g.addNode(modelNode, ['Model'], { modelId: fact.modelRouted })
  g.addNode(providerNode, ['Provider'], { providerId: fact.provider })
  g.addNode(evidenceNode, ['Evidence'], { hash: fact.evidenceHash })

  g.addEdge('HAS_INTERACTION', sessionNode, interactionNode, { at: fact.timestamp })
  g.addEdge('ROUTED_TO', interactionNode, modelNode)
  g.addEdge('OFFERED_BY', modelNode, providerNode)
  g.addEdge('PRODUCED', interactionNode, evidenceNode, { at: fact.timestamp })

  if (fact.steeringFeatureId) {
    const featureNode = `urn:noetica:sae-feature:${fact.steeringFeatureId}`
    g.addNode(featureNode, ['SaeFeature'], { featureId: fact.steeringFeatureId })
    g.addEdge('STEERED_BY', interactionNode, featureNode)
  }
}

// ─── Conversation / chat indexing ──────────────────────────────────────────────
//
// HellGraph is the substrate for Noetica's conversation graph, not just the
// Operate dashboard. A conversation is a subgraph: the thread, its turns, the
// entities mentioned, and the evidence produced are all atoms, queryable via
// SPARQL, Gremlin, or the pattern matcher.

export interface ConversationFact {
  conversationId: string
  title?: string
  sessionId?: string
  workspaceMode?: string
}

export function ingestConversation(fact: ConversationFact): string {
  const g = getHellGraph()
  const convNode = `urn:noetica:conversation:${fact.conversationId}`
  g.addNode(convNode, ['Conversation'], {
    conversationId: fact.conversationId,
    ...(fact.title ? { title: fact.title.slice(0, 200) } : {}),
    ...(fact.workspaceMode ? { workspaceMode: fact.workspaceMode } : {}),
  })
  if (fact.sessionId) {
    const sessionNode = `urn:noetica:session:${fact.sessionId}`
    g.addNode(sessionNode, ['Session'], { sessionId: fact.sessionId })
    g.addEdge('IN_SESSION', convNode, sessionNode)
  }
  return convNode
}

export interface MessageFact {
  messageId: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  /** Previous message id in the thread, for NEXT/PREV ordering edges. */
  precededBy?: string
  modelRouted?: string
  evidenceHash?: string
}

export function ingestMessage(fact: MessageFact): string {
  const g = getHellGraph()
  const convNode = `urn:noetica:conversation:${fact.conversationId}`
  const msgNode = `urn:noetica:message:${fact.messageId}`

  g.addNode(convNode, ['Conversation'], { conversationId: fact.conversationId })
  g.addNode(msgNode, ['Message', roleLabel(fact.role)], {
    messageId: fact.messageId,
    role: fact.role,
    content: fact.content.slice(0, 2000),
    createdAt: fact.createdAt,
  })
  g.addEdge('HAS_MESSAGE', convNode, msgNode, { at: fact.createdAt })

  if (fact.precededBy) {
    const prevNode = `urn:noetica:message:${fact.precededBy}`
    g.addEdge('NEXT', prevNode, msgNode)
  }
  if (fact.modelRouted) {
    const modelNode = `urn:noetica:model:${fact.modelRouted}`
    g.addNode(modelNode, ['Model'], { modelId: fact.modelRouted })
    g.addEdge('GENERATED_BY', msgNode, modelNode)
  }
  if (fact.evidenceHash) {
    const evidenceNode = `urn:noetica:evidence:${fact.evidenceHash}`
    g.addNode(evidenceNode, ['Evidence'], { hash: fact.evidenceHash })
    g.addEdge('PRODUCED', msgNode, evidenceNode)
  }
  return msgNode
}

export interface MemoryFact {
  scopeId: string
  contentHash: string
  text: string
  sessionId?: string
  evidenceRefs?: string[]
}

export function ingestMemory(fact: MemoryFact): string {
  const g = getHellGraph()
  const scopeNode = `urn:noetica:memory-scope:${fact.scopeId}`
  const memNode = `urn:noetica:memory:${fact.contentHash}`

  g.addNode(scopeNode, ['MemoryScope'], { scopeId: fact.scopeId })
  g.addNode(memNode, ['MemoryEntry'], {
    contentHash: fact.contentHash,
    text: fact.text.slice(0, 1000),
  })
  g.addEdge('IN_SCOPE', memNode, scopeNode)

  for (const ref of fact.evidenceRefs ?? []) {
    const evidenceNode = `urn:noetica:evidence:${ref}`
    g.addNode(evidenceNode, ['Evidence'], { hash: ref })
    g.addEdge('GROUNDED_BY', memNode, evidenceNode)
  }
  return memNode
}

// ─── M1 Causal Triad indexing ──────────────────────────────────────────────────
//
// Each causal triad run becomes a certified knowledge node in the graph:
//   (SaeFeature) -[:HAS_TRIAD]-> (CausalTriad) -[:ABLATION_ARM]-> (TriadArm)
//                                               -[:POSITIVE_ARM]-> (TriadArm)
//                                               -[:NEGATIVE_ARM]-> (TriadArm)

export interface CausalTriadFact {
  featureId: number
  hook: string
  prompt: string
  schemaVersion: string
  ablation?: { completion: string; originalActivation?: number; residDeltaNorm?: number }
  positive?: { completion: string; originalActivation?: number; residDeltaNorm?: number }
  negative?: { completion: string; originalActivation?: number; residDeltaNorm?: number }
  sessionId?: string
  timestamp: string
}

export function ingestCausalTriad(fact: CausalTriadFact): string {
  const g = getHellGraph()
  const triadId = `${fact.featureId}:${fact.timestamp}`
  const triadNode = `urn:noetica:causal-triad:${triadId}`
  const featureNode = `urn:noetica:sae-feature:${fact.featureId}`

  g.addNode(featureNode, ['SaeFeature'], { featureId: String(fact.featureId) })
  g.addNode(triadNode, ['CausalTriad', 'M1Certification'], {
    featureId: String(fact.featureId),
    hook: fact.hook,
    prompt: fact.prompt.slice(0, 280),
    schemaVersion: fact.schemaVersion,
    timestamp: fact.timestamp,
  })
  g.addEdge('HAS_TRIAD', featureNode, triadNode, { at: fact.timestamp })

  for (const [armName, edge] of [
    ['ablation', 'ABLATION_ARM'],
    ['positive', 'POSITIVE_ARM'],
    ['negative', 'NEGATIVE_ARM'],
  ] as const) {
    const arm = fact[armName]
    if (!arm) continue
    const armNode = `urn:noetica:triad-arm:${triadId}:${armName}`
    g.addNode(armNode, ['TriadArm'], {
      arm: armName,
      completion: arm.completion.slice(0, 500),
      ...(arm.originalActivation !== undefined ? { originalActivation: arm.originalActivation } : {}),
      ...(arm.residDeltaNorm !== undefined ? { residDeltaNorm: arm.residDeltaNorm } : {}),
    })
    g.addEdge(edge, triadNode, armNode)
  }

  if (fact.sessionId) {
    const sessionNode = `urn:noetica:session:${fact.sessionId}`
    g.addNode(sessionNode, ['Session'], { sessionId: fact.sessionId })
    g.addEdge('IN_SESSION', triadNode, sessionNode)
  }

  return triadNode
}

function roleLabel(role: 'user' | 'assistant' | 'system'): string {
  return role === 'user' ? 'UserMessage' : role === 'assistant' ? 'AssistantMessage' : 'SystemMessage'
}
