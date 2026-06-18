/**
 * Goal / plan state — the orchestration layer Noetica lacked. A first-class Goal
 * persists in HellGraph so it survives across turns, sessions, and restarts, and
 * is injected into chat context so the model always knows the active objective and
 * what information is still missing (slot-filling). This is what lets the system
 * pursue a multi-turn objective instead of treating every turn as stateless.
 *
 * Pure logic (detection, slot-filling, context building) is dependency-free and
 * unit-tested; persistence helpers use the HellGraph store.
 */

import { getGraph } from './graph.js'

export interface GoalSlot { name: string; description?: string; filled: boolean; value?: string }
export interface GoalSubtask { title: string; done: boolean }
export interface Goal {
  id: string
  session_id: string
  objective: string
  status: 'active' | 'completed' | 'abandoned'
  subtasks: GoalSubtask[]
  slots: GoalSlot[]
  created_at: string
  updated_at: string
}

// ─── Pure logic (unit-tested) ──────────────────────────────────────────────────

// Heuristic goal-intent detection. Conservative: only fires on explicit
// goal-setting phrasing so we don't mistake every message for a new objective.
const GOAL_RE = /\b(?:my goal is to|i want to|i'?d like to|i would like to|help me|i'?m trying to|i am trying to|i need to|can you help me)\s+(.+)/i

/**
 * Neutralise prompt-injection in free text that will be placed into the system
 * prompt (goal objective, slot values). Collapses newlines (so injected content
 * can't start a new "instruction" block), strips role/markdown markers, drops
 * common override phrases, and caps length. Defence-in-depth — the objective is
 * the user's own, but it crosses from data into instruction context.
 */
export function sanitizeGoalText(text: string, max = 200): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')                                   // no line breaks → no fake instruction blocks
    .replace(/```+/g, ' ')                                        // no fenced blocks
    .replace(/^\s*#{1,6}\s*/g, '')                                // no markdown headings
    .replace(/\b(system|assistant|developer)\s*:/gi, '$1 ')       // defang role markers
    .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)\b/gi, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max)
}

export function detectGoalIntent(text: string): { objective: string } | null {
  const m = text.match(GOAL_RE)
  if (!m || !m[1]) return null
  const objective = sanitizeGoalText(m[1].trim().replace(/[.?!]+$/, ''))
  if (objective.length < 4) return null
  return { objective }
}

// Mark a slot filled when its name appears in the supplied text.
export function slotFill(slots: GoalSlot[], text: string): GoalSlot[] {
  const lower = text.toLowerCase()
  return slots.map((s) =>
    s.filled ? s : (lower.includes(s.name.toLowerCase()) ? { ...s, filled: true } : s),
  )
}

export interface GoalProgress { subtasksDone: number; subtasksTotal: number; openSlots: string[] }

export function goalProgress(goal: Goal): GoalProgress {
  return {
    subtasksDone: goal.subtasks.filter((s) => s.done).length,
    subtasksTotal: goal.subtasks.length,
    openSlots: goal.slots.filter((s) => !s.filled).map((s) => s.name),
  }
}

// Context block injected into the system prompt for the active goal.
export function buildGoalContext(goal: Goal): string {
  const p = goalProgress(goal)
  const lines = [`\n\n---\n**Active goal**: ${sanitizeGoalText(goal.objective)}`]
  if (goal.subtasks.length > 0) {
    lines.push(`Plan (${p.subtasksDone}/${p.subtasksTotal} done): ` +
      goal.subtasks.map((s) => `${s.done ? '✓' : '○'} ${s.title}`).join('; '))
  }
  if (p.openSlots.length > 0) {
    lines.push(`Still needed: ${p.openSlots.join(', ')}. If the user has not provided these, ask for the missing items before finalizing.`)
  }
  return lines.join('\n')
}

// ─── Persistence (HellGraph) ───────────────────────────────────────────────────

const GOAL_LABELS = ['Goal', 'GaiaEntity']

export function saveGoal(g: Goal): void {
  getGraph().addNode(g.id, GOAL_LABELS, {
    session_id: g.session_id,
    objective: g.objective,
    status: g.status,
    subtasks: JSON.stringify(g.subtasks),
    slots: JSON.stringify(g.slots),
    created_at: g.created_at,
    updated_at: g.updated_at,
    kind: 'goal',
  })
}

function projectGoal(props: Record<string, unknown>, id: string): Goal {
  const parse = <T>(v: unknown, fallback: T): T => {
    try { return JSON.parse(String(v ?? '')) as T } catch { return fallback }
  }
  return {
    id,
    session_id: String(props['session_id'] ?? ''),
    objective: String(props['objective'] ?? ''),
    status: (String(props['status'] ?? 'active') as Goal['status']),
    subtasks: parse<GoalSubtask[]>(props['subtasks'], []),
    slots: parse<GoalSlot[]>(props['slots'], []),
    created_at: String(props['created_at'] ?? ''),
    updated_at: String(props['updated_at'] ?? ''),
  }
}

export function listGoals(sessionId?: string): Goal[] {
  const nodes = getGraph().allNodes().filter((n) => n.labels.includes('Goal'))
  return nodes
    .map((n) => projectGoal(n.properties, n.id))
    .filter((g) => !sessionId || g.session_id === sessionId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getActiveGoal(sessionId: string): Goal | null {
  return listGoals(sessionId).find((g) => g.status === 'active') ?? null
}
