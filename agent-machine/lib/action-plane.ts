/**
 * action-plane — a typed, declarative ACTION layer over the knowledge graph (the "kinetic ontology", P5.15+).
 *
 * Palantir's Ontology is half nouns (objects/links) and half VERBS — typed Actions that mutate the governed graph
 * under a rule set, invoked by apps + agents, recorded for audit. Noetica had exactly ONE hardcoded action
 * (stewardship write-back). This generalizes it: ActionTypes declare their params + the capability they need, an
 * executor validates + applies them through the graph, and every invocation is auditable. scope-d / containment
 * gate WHICH actions an actor may run via the `capability` tag; the executor stays decoupled from both.
 */
export type ActionCapability = 'read' | 'write' | 'admin'

export interface ActionParamSpec { type: 'string' | 'string[]'; required?: boolean; description?: string }

export interface ActionResult { ok: boolean; summary: string; changed?: string[]; error?: string }

export interface ActionContext {
  graph: { getNode: (id: string) => { properties?: Record<string, unknown> } | undefined; setNodeProperty: (id: string, k: string, v: string) => void }
  resolveEntity: (ref: string) => Promise<string | null>   // display-label OR node-id → canonical node id
  now: string
  audit?: (rec: { action: string; params: Record<string, unknown>; result: ActionResult }) => void
}

export interface ActionType {
  name: string
  description: string
  capability: ActionCapability
  params: Record<string, ActionParamSpec>
  apply: (params: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>
}

const REGISTRY = new Map<string, ActionType>()

export function registerAction(a: ActionType): void { REGISTRY.set(a.name, a) }
export function getAction(name: string): ActionType | undefined { return REGISTRY.get(name) }
export function listActions(): Array<{ name: string; description: string; capability: ActionCapability; params: ActionType['params'] }> {
  return [...REGISTRY.values()].map((a) => ({ name: a.name, description: a.description, capability: a.capability, params: a.params }))
}

/**
 * Execute a registered action. Validates required params, runs it, audits the result. `allow` is the optional
 * capability gate (from containment/purpose-binding): if provided, the action's capability must be in the set.
 */
export async function executeAction(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
  allow?: ReadonlySet<ActionCapability>,
): Promise<ActionResult> {
  const a = REGISTRY.get(name)
  if (!a) return { ok: false, summary: '', error: `unknown action: ${name}` }
  if (allow && !allow.has(a.capability)) return { ok: false, summary: '', error: `action "${name}" needs ${a.capability} capability, which is not granted` }
  for (const [k, spec] of Object.entries(a.params)) {
    if (spec.required && (params[k] == null || params[k] === '')) return { ok: false, summary: '', error: `missing required param: ${k}` }
  }
  try {
    const r = await a.apply(params, ctx)
    ctx.audit?.({ action: name, params, result: r })
    return r
  } catch (e) {
    const r: ActionResult = { ok: false, summary: '', error: e instanceof Error ? e.message : 'action failed' }
    ctx.audit?.({ action: name, params, result: r })
    return r
  }
}

// ─── Built-in action: steward_entity (the former hardcoded write-back, now a registered ActionType) ──────────
registerAction({
  name: 'steward_entity',
  description: 'Record a stewardship decision on a graph entity: assign keeper/successor, set an explicit ontogenesis phase, acknowledge abandonment signals, or add a note. The ontology census then honors it.',
  capability: 'write',
  params: {
    entity: { type: 'string', required: true, description: 'Entity display label or node id' },
    keeper: { type: 'string', description: 'Who now stewards this entity' },
    successor: { type: 'string', description: 'Designated successor' },
    phaseOverride: { type: 'string', description: 'Explicit ontogenesis phase (overrides the derived one)' },
    resolveSignals: { type: 'string[]', description: 'Abandonment signals to acknowledge' },
    note: { type: 'string', description: 'A stewardship note' },
  },
  apply: async (params, ctx) => {
    const nodeId = await ctx.resolveEntity(String(params['entity'] ?? ''))
    if (!nodeId) return { ok: false, summary: '', error: `entity "${String(params['entity'] ?? '')}" not found` }
    const { applyStewardship, GAIA_ONTOLOGY } = await import('./gaia-ontology.js')
    const validPhases = GAIA_ONTOLOGY.ontogenesisPhases as readonly string[]
    const validSignals = GAIA_ONTOLOGY.abandonmentSignals as readonly string[]
    const phaseRaw = typeof params['phaseOverride'] === 'string' ? params['phaseOverride'] : ''
    const phaseOverride = phaseRaw && validPhases.includes(phaseRaw) ? (phaseRaw as never) : undefined
    const sigsRaw = Array.isArray(params['resolveSignals']) ? (params['resolveSignals'] as unknown[]).map(String) : []
    const resolveSignals = sigsRaw.filter((x) => validSignals.includes(x)) as never[]
    const state = applyStewardship(ctx.graph, nodeId, {
      keeper: typeof params['keeper'] === 'string' ? params['keeper'] : undefined,
      successor: typeof params['successor'] === 'string' ? params['successor'] : undefined,
      phaseOverride,
      resolveSignals,
      note: typeof params['note'] === 'string' ? params['note'] : undefined,
    }, ctx.now)
    return { ok: true, summary: `stewardship recorded for "${String(params['entity'])}"`, changed: [nodeId] }
  },
})
