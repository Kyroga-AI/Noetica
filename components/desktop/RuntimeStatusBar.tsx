import { defaultRuntimeStatus } from '@/lib/desktop/runtime-status'
import type { RuntimeStatus } from '@/lib/desktop/runtime-status'
import { StatusChip } from './StatusChip'

type RuntimeStatusBarProps = {
  status?: RuntimeStatus
}

function toneFor(value: string) {
  if (value === 'available' || value === 'configured') return 'ok' as const
  if (value === 'deferred') return 'deferred' as const
  if (value === 'missing' || value === 'error' || value === 'unavailable') return 'warn' as const
  return 'neutral' as const
}

function humanize(value: string) {
  return value.replaceAll('_', ' ')
}

export function RuntimeStatusBar({ status = defaultRuntimeStatus }: RuntimeStatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip label="Provider" value={humanize(status.provider)} tone={toneFor(status.provider)} />
      <StatusChip label="SourceOS" value={humanize(status.sourceos)} tone={toneFor(status.sourceos)} />
      <StatusChip label="Agent Machine" value={humanize(status.agentMachine)} tone={toneFor(status.agentMachine)} />
      <StatusChip label="Prophet Mesh" value={humanize(status.prophetMesh)} tone={toneFor(status.prophetMesh)} />
    </div>
  )
}
