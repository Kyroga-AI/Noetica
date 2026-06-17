'use client'

import { useSettings } from '@/lib/settings/context'

type Profile = {
  id: 'default' | 'research' | 'security' | 'enterprise' | 'medical'
  label: string
  primes: string[]
  scope: string
  description: string
}

const PROFILES: Profile[] = [
  {
    id: 'default',
    label: 'Default',
    primes: ['CITIZEN'],
    scope: 'CITIZEN_FOG',
    description: 'Standard context. Consumer-appropriate responses with normal hedging.',
  },
  {
    id: 'research',
    label: 'Research',
    primes: ['CITIZEN', 'RESEARCHER', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    description: 'Academic and technical research. Dual-use topics, experimental methods, full depth.',
  },
  {
    id: 'security',
    label: 'Security',
    primes: ['CITIZEN', 'SECURITY_RESEARCHER', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    description: 'Security research context. Vulnerability analysis, offensive techniques, adversarial ML, CTF.',
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    primes: ['OPERATOR', 'ENGINEER'],
    scope: 'CITIZEN_FOG',
    description: 'Operator context. No consumer hedging. Full technical and business depth.',
  },
  {
    id: 'medical',
    label: 'Medical',
    primes: ['CITIZEN', 'HEALTH', 'RESEARCHER'],
    scope: 'CITIZEN_FOG',
    description: 'Health research. Clinical precision, drug interactions, diagnostic criteria.',
  },
]

export function PolicyPanel() {
  const { settings, update } = useSettings()
  const active = settings.defaultPolicyProfile ?? 'default'

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Authorization Context</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          Sets the prime-topic authorization for every conversation. All profiles run in CITIZEN_FOG scope — sovereign local compute. Restrictions only apply at cross-scope boundaries (data leaving your machine).
        </p>
      </div>

      <div className="space-y-2">
        {PROFILES.map((p) => {
          const isActive = active === p.id
          return (
            <button
              key={p.id}
              onClick={() => update({ defaultPolicyProfile: p.id })}
              className={`w-full rounded-xl border p-4 text-left transition ${
                isActive
                  ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.08)]'
                  : 'border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${isActive ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>
                  {p.label}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-text-tertiary)]">{p.scope}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {p.primes.map((prime) => (
                  <span key={prime} className="inline-block rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    {prime}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">{p.description}</p>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-tertiary)]">
        Based on the Identity Is Prime fog-authorization model. Prime topics are irreducible identity contexts. Within CITIZEN_FOG scope (your machine), you have full authorization for your stated prime context. Policy constraints only fire on cross-scope data export.
      </div>
    </div>
  )
}
