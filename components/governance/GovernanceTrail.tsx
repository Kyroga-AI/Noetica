import type { GovernanceTrace } from '@/lib/types/governance'

type GovernanceTrailProps = {
  trace: GovernanceTrace
}

export function GovernanceTrail({ trace }: GovernanceTrailProps) {
  return (
    <details className="mt-3 rounded-xl border border-blue-100 bg-white/80 p-3 text-xs text-slate-700">
      <summary className="cursor-pointer font-semibold text-blue-700">Governance trail</summary>
      <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
        <dt className="text-slate-500">run</dt>
        <dd className="break-all font-mono">{trace.run_id}</dd>
        <dt className="text-slate-500">model</dt>
        <dd>{trace.model_routed}</dd>
        <dt className="text-slate-500">provider</dt>
        <dd>{trace.provider}</dd>
        <dt className="text-slate-500">policy</dt>
        <dd>{trace.policy_admitted ? 'admitted' : 'blocked'}</dd>
        <dt className="text-slate-500">memory</dt>
        <dd>{trace.memory_written ? 'written' : 'not written'}</dd>
        <dt className="text-slate-500">request hash</dt>
        <dd className="break-all font-mono">{trace.request_hash ?? 'pending'}</dd>
        <dt className="text-slate-500">evidence hash</dt>
        <dd className="break-all font-mono">{trace.evidence_hash ?? 'pending'}</dd>
        <dt className="text-slate-500">evidence</dt>
        <dd className="break-all font-mono">{trace.evidence_ref ?? 'none'}</dd>
        <dt className="text-slate-500">latency</dt>
        <dd>{trace.latency_ms} ms</dd>
      </dl>
    </details>
  )
}
