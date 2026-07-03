/**
 * agent-workflow.ts — the twin as PM-agent (multi-agent orchestration, aligned to the Codex/Anthropic
 * "orchestrating multi-agent workflows" pattern). The PM breaks a task list into living-KB ARTIFACTS
 * (REQUIREMENTS / AGENT_TASKS / TEST_PLAN / DESIGN …) and gates every handoff on "the required artifact
 * must exist first" — the same fail-closed discipline as agentplane's cross-wall gate, at the Noetica level.
 *
 * Artifacts live in AgentMemory (the living-KB), so they're trust-scoped by the skin and consolidated by
 * autoDream. This is the twin's orchestration/lifecycle organ; specialist roles are the sub-agents/labs.
 * (Distinct from orchestrator.ts, which is the single-turn chat concierge/dispatch gate.)
 */
import type { AgentMemory } from './agent-memory.js'
import type { TrustNamespace } from './isolation-policy.js'

export type Role = 'pm' | 'designer' | 'frontend' | 'backend' | 'tester'

/** Each downstream role's handoff is gated on these artifacts existing first (artifacts-before-handoff). */
export const PIPELINE: Record<Exclude<Role, 'pm'>, string[]> = {
  designer: ['REQUIREMENTS'],
  frontend: ['REQUIREMENTS', 'DESIGN'],
  backend: ['REQUIREMENTS'],
  tester: ['REQUIREMENTS', 'TEST_PLAN'],
}

export interface HandoffResult { role: Role; admitted: boolean; missing: string[] }

export class AgentWorkflow {
  constructor(private mem: AgentMemory, private namespace: TrustNamespace = 'workspace') {}

  /** A role produces an artifact into the living-KB. Returns false if the skin denied it. */
  async produce(name: string, content: string, labels?: string[]): Promise<boolean> {
    const r = await this.mem.ingest({ name, content, namespace: this.namespace, labels })
    return r.admitted
  }

  /** Gate a handoff: admitted only if every required artifact exists (fail-closed). */
  async handoff(to: Exclude<Role, 'pm'>): Promise<HandoffResult> {
    const missing: string[] = []
    for (const a of PIPELINE[to]) if (!(await this.mem.has(this.namespace, a))) missing.push(a)
    return { role: to, admitted: missing.length === 0, missing }
  }

  /** PM decomposes a task list into the base artifacts (REQUIREMENTS + AGENT_TASKS). */
  async plan(tasks: string[]): Promise<string[]> {
    await this.produce('REQUIREMENTS', `# Requirements\n\n${tasks.map((t) => `- ${t}`).join('\n')}`)
    await this.produce('AGENT_TASKS', `# Agent tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}`)
    return ['REQUIREMENTS', 'AGENT_TASKS']
  }
}
