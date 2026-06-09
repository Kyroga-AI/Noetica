import type { GovernanceTrace } from '@/lib/types/governance'
import type { SteeringResult } from '@/lib/types/steering'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  workspace_mode?: string
  governance?: GovernanceTrace
  steering_result?: SteeringResult
}
