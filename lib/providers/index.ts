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

export type ProviderStreamInput = ProviderCallInput
