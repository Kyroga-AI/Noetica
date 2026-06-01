import type { NoeticaServiceCapabilityStatus, NoeticaServiceStatus } from '@/lib/contracts/noeticaService'

export type RemediationItem = {
  key: string
  label: string
  status: NoeticaServiceCapabilityStatus
  summary: string
  command?: string
  owner: 'noetica-ui' | 'noetica-cli' | 'local-service' | 'sourceos' | 'agent-machine' | 'model-router'
}

export function buildRuntimeRemediations(status: NoeticaServiceStatus): RemediationItem[] {
  const items: RemediationItem[] = []

  pushIfActionable(items, {
    key: 'provider',
    label: 'Provider',
    status: status.provider,
    owner: 'noetica-cli',
    summaryByStatus: {
      ready: 'Provider route is available for the current fallback runtime.',
      not_configured: 'Configure provider routes before expecting live model responses.',
      disabled: 'Provider routing is disabled in the current configuration.',
      deferred: 'Provider routing is deferred to the service/model-router boundary.',
      error: 'Provider status could not be validated.'
    },
    commandByStatus: {
      not_configured: 'noetica configure',
      disabled: 'noetica doctor --json',
      error: 'noetica doctor --json'
    }
  })

  pushIfActionable(items, {
    key: 'sourceos',
    label: 'SourceOS route',
    status: status.sourceos_route,
    owner: 'sourceos',
    summaryByStatus: {
      ready: 'SourceOS route is available.',
      not_configured: 'SourceOS route is not configured yet.',
      disabled: 'SourceOS route is disabled for this desktop session.',
      deferred: 'SourceOS integration is deferred until the route handshake tranche.',
      error: 'SourceOS route status could not be validated.'
    },
    commandByStatus: {
      not_configured: 'noetica doctor --json',
      disabled: 'noetica doctor --json',
      deferred: 'track Phase 2 SourceOS route integration',
      error: 'noetica doctor --json'
    }
  })

  pushIfActionable(items, {
    key: 'agent-machine',
    label: 'Agent Machine',
    status: status.agent_machine,
    owner: 'agent-machine',
    summaryByStatus: {
      ready: 'Agent Machine is available.',
      not_configured: 'Agent Machine is not configured yet.',
      disabled: 'Agent Machine is disabled for this desktop session.',
      deferred: 'Agent Machine readiness is deferred until the handshake tranche.',
      error: 'Agent Machine status could not be validated.'
    },
    commandByStatus: {
      not_configured: 'noetica doctor --json',
      disabled: 'noetica doctor --json',
      deferred: 'track Phase 2 Agent Machine readiness handshake',
      error: 'noetica doctor --json'
    }
  })

  pushIfActionable(items, {
    key: 'mesh',
    label: 'Prophet Mesh',
    status: status.prophet_mesh,
    owner: 'model-router',
    summaryByStatus: {
      ready: 'Prophet Mesh is available.',
      not_configured: 'Prophet Mesh is not configured yet.',
      disabled: 'Prophet Mesh is disabled for this desktop session.',
      deferred: 'Prophet Mesh remains deferred for this phase.',
      error: 'Prophet Mesh status could not be validated.'
    },
    commandByStatus: {
      not_configured: 'noetica doctor --json',
      disabled: 'noetica doctor --json',
      deferred: 'track model-router / Prophet Mesh tranche',
      error: 'noetica doctor --json'
    }
  })

  if (status.endpoint_kind === 'browser-fallback') {
    items.unshift({
      key: 'runtime-boundary',
      label: 'Runtime boundary',
      status: 'deferred',
      owner: 'local-service',
      summary: 'Runtime execution is still using browser/dev fallback routes. A local service boundary is the next runtime hardening step.',
      command: 'noetica service status'
    })
  }

  return items
}

function pushIfActionable(
  items: RemediationItem[],
  input: {
    key: string
    label: string
    status: NoeticaServiceCapabilityStatus
    owner: RemediationItem['owner']
    summaryByStatus: Record<NoeticaServiceCapabilityStatus, string>
    commandByStatus?: Partial<Record<NoeticaServiceCapabilityStatus, string>>
  }
) {
  if (input.status === 'ready') return

  items.push({
    key: input.key,
    label: input.label,
    status: input.status,
    owner: input.owner,
    summary: input.summaryByStatus[input.status],
    command: input.commandByStatus?.[input.status]
  })
}
