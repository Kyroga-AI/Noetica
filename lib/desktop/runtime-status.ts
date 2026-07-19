export type RuntimeStatus = {
  provider: 'missing' | 'configured' | 'disabled' | 'deferred'
  sourceos: 'disabled' | 'pending' | 'available' | 'unavailable'
  agentMachine: 'not_detected' | 'bootstrap_only' | 'available' | 'error'
  prophetMesh: 'deferred' | 'available'
}

export const defaultRuntimeStatus: RuntimeStatus = {
  provider: 'disabled',
  sourceos: 'disabled',
  agentMachine: 'not_detected',
  prophetMesh: 'deferred'
}

export function runtimeStatusLabel(key: keyof RuntimeStatus, value: RuntimeStatus[keyof RuntimeStatus]) {
  const labels: Record<string, string> = {
    provider: 'Provider',
    sourceos: 'SourceOS',
    agentMachine: 'Agent Machine',
    prophetMesh: 'Prophet Mesh',
    missing: 'Missing',
    configured: 'Configured',
    disabled: 'Disabled',
    deferred: 'Deferred',
    pending: 'Pending',
    available: 'Available',
    unavailable: 'Unavailable',
    not_detected: 'Not detected',
    bootstrap_only: 'Bootstrap only',
    error: 'Error'
  }

  return `${labels[key] ?? key}: ${labels[value] ?? value}`
}
