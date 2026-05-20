export type ProviderCallInput = {
  model: string
  messages: Array<{ role: string; content: string }>
}

export type ProviderCallResult = {
  content: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  latency_ms: number
}
