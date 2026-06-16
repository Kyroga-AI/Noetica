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
}
