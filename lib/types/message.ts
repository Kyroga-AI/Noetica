import type { GovernanceTrace } from '@/lib/types/governance'
import type { SteeringResult } from '@/lib/types/steering'
import type { PendingAttachment } from '@/lib/types/attachment'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ToolCallRecord {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultRecord {
  id: string
  name: string
  result: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  workspace_mode?: string
  thinking?: string
  fanout_model?: string
  governance?: GovernanceTrace
  steering_result?: SteeringResult
  attachments?: PendingAttachment[]
  /** Tool calls the model requested during this turn */
  tool_calls?: ToolCallRecord[]
  /** Results returned to the model for each tool call */
  tool_results?: ToolResultRecord[]
  /** True when the user cancelled generation mid-stream */
  stopped?: boolean
  /** Neurosymbolic retrieval trace — why this answer was grounded the way it was */
  retrieval_trace?: RetrievalTrace
}

export interface RetrievalTrace {
  /** Retrieval patterns that contributed context (e.g. beliefs, atoms, graph) */
  patterns: string[]
  /** Per-pattern execution: which ran, how long, how many hits */
  timings: Array<{ pattern: string; durationMs: number; hits: number }>
  /** Top attention-ranked sources (atoms/edges) with their scores */
  sources: Array<{ id: string; label: string; score: number }>
  /** Estimated tokens of injected context */
  token_estimate: number
  /** How many belief snapshots were injected from the world model */
  beliefs_injected: number
}
