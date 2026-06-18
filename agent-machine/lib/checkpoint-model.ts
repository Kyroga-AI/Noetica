/**
 * Run checkpointing — capture enough state to resume a model run after it is
 * stopped (or the process restarts), or to add context and continue. Persisted in
 * HellGraph so it survives restarts. Answers: "run a model, stop it, then restart
 * / add context and pick up where it left off."
 *
 * Pure resume-reconstruction logic is unit-tested; persistence wraps HellGraph.
 */

import { getGraph } from './graph.js'

export interface CheckpointMessage { role: string; content: string }

export interface RunCheckpoint {
  id: string
  run_id: string
  session_id: string
  status: 'interrupted' | 'complete'
  model: string
  provider: string
  task?: string
  /** The conversation that was sent up to this run. */
  messages: CheckpointMessage[]
  /** Assistant content streamed before interruption. */
  partial_content: string
  /** Reasoning streamed before interruption. */
  partial_thinking: string
  created_at: string
}

// ─── Pure resume logic (unit-tested) ───────────────────────────────────────────

/**
 * Build the message array to resume an interrupted run. The partial assistant
 * output is replayed as an assistant turn, then a continue instruction is added
 * (optionally with newly-supplied context) so the model picks up coherently
 * instead of restarting from scratch.
 */
export function buildResumeMessages(
  cp: RunCheckpoint,
  addedContext?: string,
): CheckpointMessage[] {
  const out: CheckpointMessage[] = [...cp.messages]
  if (cp.partial_content.trim()) {
    out.push({ role: 'assistant', content: cp.partial_content })
    out.push({
      role: 'user',
      content: `Continue your previous response from exactly where it stopped — do not repeat what you already wrote.${addedContext ? `\n\nAdditional context to incorporate:\n${addedContext}` : ''}`,
    })
  } else if (addedContext) {
    out.push({ role: 'user', content: `Additional context:\n${addedContext}` })
  }
  return out
}

// ─── Persistence (HellGraph) ───────────────────────────────────────────────────

const CP_LABELS = ['RunCheckpoint', 'GaiaEntity']

export function saveCheckpoint(cp: RunCheckpoint): void {
  getGraph().addNode(cp.id, CP_LABELS, {
    run_id: cp.run_id,
    session_id: cp.session_id,
    status: cp.status,
    model: cp.model,
    provider: cp.provider,
    task: cp.task ?? '',
    messages: JSON.stringify(cp.messages),
    partial_content: cp.partial_content,
    partial_thinking: cp.partial_thinking,
    created_at: cp.created_at,
    kind: 'run_checkpoint',
  })
}

function project(props: Record<string, unknown>, id: string): RunCheckpoint {
  const parse = <T>(v: unknown, fb: T): T => { try { return JSON.parse(String(v ?? '')) as T } catch { return fb } }
  return {
    id,
    run_id: String(props['run_id'] ?? ''),
    session_id: String(props['session_id'] ?? ''),
    status: (String(props['status'] ?? 'interrupted') as RunCheckpoint['status']),
    model: String(props['model'] ?? ''),
    provider: String(props['provider'] ?? ''),
    task: String(props['task'] ?? '') || undefined,
    messages: parse<CheckpointMessage[]>(props['messages'], []),
    partial_content: String(props['partial_content'] ?? ''),
    partial_thinking: String(props['partial_thinking'] ?? ''),
    created_at: String(props['created_at'] ?? ''),
  }
}

export function listCheckpoints(sessionId?: string): RunCheckpoint[] {
  return getGraph().allNodes()
    .filter((n) => n.labels.includes('RunCheckpoint'))
    .map((n) => project(n.properties, n.id))
    .filter((c) => !sessionId || c.session_id === sessionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getCheckpoint(id: string): RunCheckpoint | null {
  const n = getGraph().getNode(id)
  return n && n.labels.includes('RunCheckpoint') ? project(n.properties, n.id) : null
}
