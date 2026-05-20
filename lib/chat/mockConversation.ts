import type { ChatMessage } from '@/lib/types/message'

export const initialMessages: ChatMessage[] = [
  {
    id: 'system-boot-note',
    role: 'assistant',
    content:
      'Noetica M1 scaffold is online. Select standalone or SourceOS mode, choose a model, and inspect the governance trail on every response.',
    created_at: new Date(0).toISOString(),
    governance: {
      run_id: 'boot',
      model_routed: 'none',
      provider: 'noetica-ui',
      policy_admitted: true,
      memory_written: false,
      evidence_ref: 'none',
      latency_ms: 0
    }
  }
]
