import type { ChatMessage } from '@/lib/types/message'

export type ProviderCallInput = {
  model: string
  messages: ChatMessage[]
}

export type ProviderCallResult = {
  content: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  latency_ms: number
}

// Tool definitions sent to the model
export type ProviderTool = {
  name: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: Record<string, any>
  /** Set for MCP tools — used by client to route execution */
  serverId?: string
}

// A tool_use block returned by the model
export type ToolUseBlock = {
  id: string
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>
  serverId?: string
}

export type ProviderStreamInput = ProviderCallInput & {
  thinking_budget?: number
  apiKey?: string
  tools?: ProviderTool[]
  /** System prompt override — prepended before conversation */
  systemPrompt?: string
}
