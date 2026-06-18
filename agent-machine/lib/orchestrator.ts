/**
 * orchestrator — the chat-first "quarterback" concierge.
 *
 * The front door of every turn is a fast, always-responsive concierge. It is:
 *   • self-aware  — answers about itself from the self-model (instant, no worker)
 *   • conversational — handles greetings / small-talk inline
 *   • a dispatcher — for heavy work (reasoning, research, code) it acknowledges
 *     immediately ("let me research this for you…"), kicks off a worker job, and
 *     passes the worker's answer back through
 *   • capacity-aware — heavy jobs run through a CapacityGate sized to the host
 *     (one at a time on small/low-memory boxes) so the machine never overcommits
 *     its (GPU-shared) memory and stalls. Extra jobs queue with a visible position.
 *
 * This keeps the user always talking to something responsive while the expensive
 * models are farmed out, serialized, and relayed.
 */
import { isLowMemoryHost } from './ollama.js'
import { isSelfQuery } from './self-model.js'

export type Capability = 'reasoning' | 'research' | 'code' | 'general'

export interface TurnPlan {
  /** 'direct' = concierge answers now; 'dispatch' = ack now, run a worker, relay. */
  mode: 'direct' | 'dispatch'
  capability: Capability
  /** Conversational acknowledgement streamed immediately on dispatch. */
  ack?: string
  reason: string
}

const GREETING_RE = /^\s*(hi|hey|hello|yo|sup|good (morning|afternoon|evening)|how are you|thanks?|thank you|ok(ay)?|cool|nice|got it|bye)\b/i
const CODE_RE = /\b(code|function|bug|stack ?trace|compile|refactor|implement|regex|api|typescript|python|rust|sql)\b/i
const RESEARCH_RE = /\b(research|find out|look up|sources?|cite|latest|who|what|when|where|why|how much|compare|search)\b/i
const REASONING_RE = /\b(prove|derive|solve|calculate|why does|explain how|step by step|reason|analy[sz]e|theorem|equation|integral|probabilit)/i

/** Acknowledgement phrasing per capability — instant, no model call. */
function ackFor(capability: Capability): string {
  switch (capability) {
    case 'research': return 'Let me research this for you — pulling it together now.'
    case 'reasoning': return "Good one — let me work through that carefully."
    case 'code': return 'On it — let me put that together.'
    default: return 'Let me look into that.'
  }
}

/**
 * Decide how the concierge handles this turn. Small-talk, self-questions, and
 * short simple asks are answered inline by the concierge (fast). Anything that
 * benefits from a heavier model is dispatched with an immediate acknowledgement.
 */
export function planTurn(message: string): TurnPlan {
  const m = message.trim()
  const words = m.split(/\s+/).filter(Boolean).length

  // Self-aware: the concierge answers from its self-model, no worker needed.
  if (isSelfQuery(m)) return { mode: 'direct', capability: 'general', reason: 'self-model question — concierge answers from self-knowledge' }

  // Small-talk / pleasantries → concierge handles inline.
  if (GREETING_RE.test(m) || words <= 4) return { mode: 'direct', capability: 'general', reason: 'small-talk / trivial — concierge handles inline' }

  // Heavy capabilities → dispatch with an acknowledgement.
  if (REASONING_RE.test(m)) return { mode: 'dispatch', capability: 'reasoning', ack: ackFor('reasoning'), reason: 'reasoning/math — dispatch to reasoning worker' }
  if (CODE_RE.test(m)) return { mode: 'dispatch', capability: 'code', ack: ackFor('code'), reason: 'code task — dispatch to code worker' }
  if (RESEARCH_RE.test(m)) return { mode: 'dispatch', capability: 'research', ack: ackFor('research'), reason: 'research/lookup — dispatch to research worker' }

  // Default: a normal question the concierge can answer directly.
  return { mode: 'direct', capability: 'general', reason: 'general question — concierge answers directly' }
}

// ─── Capacity-aware dispatch ────────────────────────────────────────────────

export interface GateStatus { capacity: number; active: number; queued: number }

/**
 * A concurrency gate with a FIFO queue. On low-memory hosts capacity is 1 so
 * heavy model jobs run strictly one-at-a-time (the box can hold one resident
 * model without the GPU-shared-memory OOM); capable hosts allow more.
 */
export class CapacityGate {
  private active = 0
  private readonly waiters: Array<() => void> = []
  constructor(public readonly capacity: number) {}

  get status(): GateStatus { return { capacity: this.capacity, active: this.active, queued: this.waiters.length } }

  /** 0 = runs immediately; n>0 = there are n jobs ahead in the queue. */
  get nextQueuePosition(): number { return this.active < this.capacity ? 0 : this.waiters.length + 1 }

  private async acquire(): Promise<void> {
    if (this.active < this.capacity) { this.active++; return }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active++
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next) next()
  }

  /** Run `fn` under the gate, queueing if at capacity. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try { return await fn() } finally { this.release() }
  }

  /** Acquire a slot and return a release function — for imperative call sites
   *  (e.g. a streaming generator) that can't be wrapped in a single callback.
   *  The returned release is idempotent. */
  async acquireLease(): Promise<() => void> {
    await this.acquire()
    let released = false
    return () => { if (!released) { released = true; this.release() } }
  }
}

/** Host-sized capacity: one heavy job on low-memory boxes, more on capable ones.
 *  Override with NOETICA_DISPATCH_CONCURRENCY. */
export function dispatchConcurrency(): number {
  const env = Number(process.env['NOETICA_DISPATCH_CONCURRENCY'])
  if (env > 0) return env
  return isLowMemoryHost() ? 1 : 3
}

/** Process-wide dispatch gate (one per agent-machine). */
export const dispatchGate = new CapacityGate(dispatchConcurrency())
