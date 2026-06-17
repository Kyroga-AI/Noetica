'use client'

// Fire-and-forget: emits a GAIA observation to agent-machine after each
// ComputerUse session completes. Non-blocking — never throws to caller.

import { amUrl } from '@/lib/tauri/bridge'

export interface ComputerUseObservationInput {
  session_id: string
  goal: string
  app_context: string
  step_summary: string
  succeeded: boolean
  attention_tags?: string[]
  anthropic_key?: string
  openai_key?: string
}

export function emitGaiaObservation(input: ComputerUseObservationInput): void {
  const payload = {
    session_id:    input.session_id,
    captured_at:   new Date().toISOString(),
    goal:          input.goal,
    app_context:   input.app_context,
    step_summary:  input.step_summary,
    succeeded:     input.succeeded,
    attention_tags: input.attention_tags ?? deriveAttentionTags(input.goal, input.app_context),
    anthropic_key: input.anthropic_key,
    openai_key:    input.openai_key,
  }

  fetch(amUrl('/api/gaia/observe'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* observation is best-effort */ })
}

function deriveAttentionTags(goal: string, appContext: string): string[] {
  const tags: string[] = []
  const combined = `${goal} ${appContext}`.toLowerCase()
  if (combined.includes('code') || combined.includes('editor') || combined.includes('terminal')) tags.push('coding')
  if (combined.includes('email') || combined.includes('mail')) tags.push('communication')
  if (combined.includes('slack') || combined.includes('message')) tags.push('communication', 'async')
  if (combined.includes('browser') || combined.includes('safari') || combined.includes('chrome')) tags.push('research')
  if (combined.includes('file') || combined.includes('finder') || combined.includes('document')) tags.push('file-management')
  if (combined.includes('write') || combined.includes('draft') || combined.includes('notes')) tags.push('writing')
  if (combined.includes('meeting') || combined.includes('zoom') || combined.includes('calendar')) tags.push('meeting')
  return [...new Set(tags)]
}
