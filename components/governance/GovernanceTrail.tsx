import type { GovernanceTrace } from '@/lib/types/governance'

type GovernanceTrailProps = {
  trace: GovernanceTrace
}

const REPLAY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  exact:        { label: 'exact · verified',   color: 'var(--color-accent)', bg: 'var(--color-accent-bg)' },
  approximate:  { label: 'approximate',         color: 'var(--color-attention)', bg: 'var(--color-attention-bg)' },
  generative:   { label: 'generative',          color: '#6b7280', bg: '#f3f4f6' },
}

export function GovernanceTrail({ trace }: GovernanceTrailProps) {
  const routeEvidence = trace.provider_route_evidence
  const replayMeta = trace.replay_class ? (REPLAY_BADGE[trace.replay_class] ?? REPLAY_BADGE.generative) : undefined

  return (
    <details className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer font-semibold text-[#1d4ed8]">Governance trail</summary>

      {/* Answer provenance — the moat signals, shown first */}
      {(trace.method || trace.decidable !== undefined || trace.replay_class) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trace.method && (
            <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">
              {trace.method}
            </span>
          )}
          {trace.decidable && (
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
              decidable
            </span>
          )}
          {replayMeta && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: replayMeta.bg, color: replayMeta.color }}>
              {replayMeta.label}
            </span>
          )}
          {trace.grounded && (
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
              grounded
            </span>
          )}
        </div>
      )}

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
        {trace.input_tokens != null && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">tokens</dt>
            <dd>{trace.input_tokens} in / {trace.output_tokens ?? 0} out</dd>
            <dt className="text-[var(--color-text-tertiary)]">cost</dt>
            <dd>
              {(trace.provider === 'ollama' || trace.provider === 'noetica' || trace.provider === 'local')
                ? 'free (local)'
                : `~$${((trace.input_tokens * 2.5 + (trace.output_tokens ?? 0) * 10) / 1_000_000).toFixed(4)}`}
            </dd>
          </>
        )}
        {trace.model_route_reason && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">route reason</dt>
            <dd title={trace.model_route_reason}>{trace.model_route_reason.slice(0, 80)}{trace.model_route_reason.length > 80 ? '…' : ''}</dd>
          </>
        )}
        {trace.credential && (
          <>
            <dt className="text-[var(--color-text-tertiary)]">C2PA / Art.50</dt>
            <dd className="break-all font-mono text-[10px]" title={`digest: ${trace.credential.digest}`}>
              <span className="rounded bg-[#eff6ff] px-1 py-0.5 text-[#1d4ed8]">AI-generated</span>
              {' '}
              <span className="text-[var(--color-text-tertiary)]">{trace.credential.digest.slice(0, 16)}…</span>
            </dd>
          </>
        )}
      </dl>
    </details>
  )
}
