import type { GovernanceTrace } from '@/lib/types/governance'

type GovernanceTrailProps = {
  trace: GovernanceTrace
}

export function GovernanceTrail({ trace }: GovernanceTrailProps) {
  const routeEvidence = trace.provider_route_evidence

  return (
    <details className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer font-semibold text-[#1d4ed8]">Governance trail</summary>
      <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
        <dt className="text-[var(--color-text-tertiary)]">run</dt>
        <dd className="break-all font-mono">{trace.run_id}</dd>
        <dt className="text-[var(--color-text-tertiary)]">model</dt>
        <dd>{trace.model_routed}</dd>
        <dt className="text-[var(--color-text-tertiary)]">override</dt>
        <dd>{trace.model_overridden === undefined ? 'n/a' : trace.model_overridden ? 'yes' : 'no'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">provider</dt>
        <dd>{trace.provider}</dd>
        <dt className="text-[var(--color-text-tertiary)]">policy</dt>
        <dd>{trace.policy_admitted ? 'admitted' : 'blocked'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">policy ref</dt>
        <dd className="break-all font-mono">{trace.policy_ref ?? 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">memory</dt>
        <dd>{trace.memory_written ? 'written' : 'not written'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">memory scope</dt>
        <dd className="break-all font-mono">{trace.memory_scope_ref ?? trace.memory_scope ?? 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">grants</dt>
        <dd>{trace.grant_refs ? `requested=${trace.grant_refs.requested.length} resolved=${trace.grant_refs.resolved.length} missing=${trace.grant_refs.missing.length}` : 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">request hash</dt>
        <dd className="break-all font-mono">{trace.request_hash ?? 'pending'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">evidence hash</dt>
        <dd className="break-all font-mono">{trace.evidence_hash ?? 'pending'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">route evidence</dt>
        <dd>{routeEvidence ? `${routeEvidence.kind} / ${routeEvidence.status}` : 'pending'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">prompt egress</dt>
        <dd>{routeEvidence?.promptEgressDefault ?? 'pending'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">side effects</dt>
        <dd>
          {routeEvidence
            ? `contacted=${Boolean(routeEvidence.sideEffects?.contactedExternalProvider)} sentPrompt=${Boolean(routeEvidence.sideEffects?.sentPrompt)}`
            : 'pending'}
        </dd>
        <dt className="text-[var(--color-text-tertiary)]">agentplane</dt>
        <dd className="break-all font-mono">{trace.agentplane_run_id ?? 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">evidence</dt>
        <dd className="break-all font-mono">{trace.evidence_ref ?? 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">replay</dt>
        <dd className="break-all font-mono">{trace.replay_ref ?? 'none'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">status</dt>
        <dd>{trace.sourceos_status ?? 'n/a'}</dd>
        <dt className="text-[var(--color-text-tertiary)]">latency</dt>
        <dd>{trace.latency_ms} ms</dd>
      </dl>
    </details>
  )
}
