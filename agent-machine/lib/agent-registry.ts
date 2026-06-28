/**
 * agent-registry.ts — the no-code agent builder's store. Users define custom sub-agents (label, system prompt,
 * allowed tools, turn budget, model tier) that become dispatchable exactly like the built-in roles. Persisted
 * to ~/.noetica/agents.json, ENCRYPTED at rest (system prompts can carry sensitive instructions). A CustomAgent
 * is shape-compatible with sub-agent.AgentRole, so the dispatch path resolves either with one fallback.
 */
import * as path from 'node:path'
import * as os from 'node:os'
import { readJson, writeJson } from './at-rest.js'

export interface CustomAgent {
  id: string
  label: string
  description: string
  systemPrompt: string
  tools: string[]
  maxTurns: number
  model?: 'coder' | 'general'
  custom: true
  createdAt: number
}

const STORE = (): string => path.join(os.homedir(), '.noetica', 'agents.json')
const slug = (s: string): string => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'

export function listCustomAgents(): CustomAgent[] {
  return (readJson<CustomAgent[]>(STORE()) ?? []).filter((a): a is CustomAgent => !!a && typeof a.id === 'string')
}

export function getCustomAgent(id: string | undefined): CustomAgent | null {
  if (!id) return null
  const want = slug(id)
  return listCustomAgents().find((a) => a.id === want) ?? null
}

/** Validate + persist a custom agent (clamps maxTurns, caps lengths, slugs the id). Upsert by id. */
export function saveCustomAgent(input: Partial<CustomAgent>): CustomAgent {
  const id = slug(String(input.id || input.label || 'agent'))
  const agent: CustomAgent = {
    id,
    custom: true,
    label: String(input.label || id).slice(0, 60),
    description: String(input.description || '').slice(0, 300),
    systemPrompt: String(input.systemPrompt || '').slice(0, 4000),
    // Tool names are validated at dispatch (filtered against BUILTIN_TOOLS), so we only de-dupe + cap here.
    tools: Array.isArray(input.tools) ? [...new Set(input.tools.map(String))].slice(0, 24) : [],
    maxTurns: Math.max(1, Math.min(12, Math.floor(Number(input.maxTurns)) || 4)),
    model: input.model === 'coder' ? 'coder' : 'general',
    createdAt: Date.now(),
  }
  const next = listCustomAgents().filter((a) => a.id !== id)
  next.push(agent)
  writeJson(STORE(), next.slice(-100))
  return agent
}

export function deleteCustomAgent(id: string): boolean {
  const want = slug(id)
  const all = listCustomAgents()
  const next = all.filter((a) => a.id !== want)
  if (next.length === all.length) return false
  writeJson(STORE(), next)
  return true
}
