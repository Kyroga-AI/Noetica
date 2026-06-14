import type { GovernanceTrace } from '@/lib/types/governance'

type Props = { governance?: GovernanceTrace }

function truncate(s: string, n = 20) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function EvidenceRailPanel({ governance }: Props) {
  const fields: { label: string; value: string | undefined }[] = [
    { label: 'Request hash',  value: governance?.request_hash },
    { label: 'Evidence ref',  value: governance?.evidence_ref },
    { label: 'Replay ref',    value: governance?.replay_ref },
    { label: 'Policy ref',    value: governance?.policy_ref },
    { label: 'Evidence hash', value: governance?.evidence_hash },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Evidence</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Request hashes, replay refs, provenance</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {fields.map(({ label, value }) => (
          <div key={label}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{label}</div>
            <div
              className="mt-1 font-mono text-xs text-[var(--color-text-secondary)] break-all"
              title={value}
            >
              {value ? truncate(value, 28) : '—'}
            </div>
          </div>
        ))}
        {governance && (
          <div className="pt-1 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Admitted</div>
            <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              governance.policy_admitted
                ? 'bg-[#dcfce7] text-[#16a34a]'
                : 'bg-[#fef2f2] text-[#dc2626]'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${governance.policy_admitted ? 'bg-[#16a34a]' : 'bg-[#dc2626]'}`} />
              {governance.policy_admitted ? 'Policy admitted' : 'Policy rejected'}
            </div>
          </div>
        )}
        <button className="mt-2 w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
          Export evidence bundle
        </button>
      </div>
    </div>
  )
}
