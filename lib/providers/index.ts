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
  input_schema: Record<string, unknown>
  /** Set for MCP tools — used by client to route execution */
  serverId?: string
}

// A tool_use block returned by the model
export type ToolUseBlock = {
  id: string
  name: string
  input: Record<string, unknown>
  serverId?: string
}

export type ProviderStreamInput = ProviderCallInput & {
  thinking_budget?: number
  temperature?: number
  max_tokens?: number
  top_p?: number
  apiKey?: string
  tools?: ProviderTool[]
  /** System prompt override — prepended before conversation */
  systemPrompt?: string
  /** Override the provider API base URL — supports local proxies and OpenAI-compatible endpoints */
  baseUrl?: string
}
