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

const SECURITY_ATTESTATION_STATEMENT =
  'I attest that I am an authorized security professional and will use this lane solely for ' +
  'lawful, authorized security research — vulnerability analysis, exploit development, reverse ' +
  'engineering, adversarial ML, and CTF work — within scope and with permission. I understand ' +
  'this arms an uncensored local model on my own hardware, that all activity is recorded in the ' +
  'local Govern audit, and that the CBRN/CSAM/explosives content floor remains enforced.'

export function PolicyPanel() {
  const { settings, update } = useSettings()
  const active = settings.defaultPolicyProfile ?? 'default'
  const attested = settings.securityAttestation?.accepted === true

  function acceptAttestation() {
    update({
      securityAttestation: {
        accepted: true,
        statement: SECURITY_ATTESTATION_STATEMENT,
        acceptedAt: new Date().toISOString(),
      },
    })
  }

  function revokeAttestation() {
    update({ securityAttestation: { accepted: false, statement: '', acceptedAt: '' } })
  }

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
                <span className="text-[11px] font-mono text-[var(--color-text-tertiary)]">{p.scope}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {p.primes.map((prime) => (
                  <span key={prime} className="inline-block rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {prime}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">{p.description}</p>
            </button>
          )
        })}
      </div>

      {active === 'security' && (
        <div className={`rounded-xl border p-4 ${attested ? 'border-[var(--color-accent)] bg-[rgba(21,128,61,0.06)]' : 'border-[var(--color-attention)] bg-[rgba(180,83,9,0.06)]'}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              Security lane — operator self-attestation
            </span>
            <span className={`text-[11px] font-mono font-semibold ${attested ? 'text-[var(--color-accent)]' : 'text-[var(--color-attention)]'}`}>
              {attested ? 'Armed' : 'Disarmed'}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
            The uncensored security lane (WhiteRabbitNeo → Foundation-Sec → dolphin, by request lean)
            arms only when you attest. Local-first: it runs on your hardware, you attest, the mesh records it.
            Until then, the Security profile routes to the standard local model.
          </p>
          <p className="mt-2 rounded-lg bg-[var(--color-background-secondary)] p-2.5 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
            {SECURITY_ATTESTATION_STATEMENT}
          </p>
          {attested ? (
            <>
              <div className="mt-3 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 text-[11px] text-[var(--color-text-secondary)]">
                <div className="flex items-center justify-between">
                  <span>Obliterate chats after</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={1440}
                      value={settings.securityEphemeralMinutes ?? 15}
                      onChange={(e) => update({ securityEphemeralMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })}
                      className="w-14 rounded border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-1.5 py-0.5 text-right text-xs"
                    />
                    <span>min</span>
                  </span>
                </div>
                <p className="mt-1.5 text-[var(--color-text-tertiary)]">
                  While armed, chats are ephemeral — removed from disk after this idle window (0 = off).
                  No memory is written; audit entries are content-redacted. Tor auto-enables on bearbrowser.
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-[var(--color-text-tertiary)]">
                  Attested {settings.securityAttestation?.acceptedAt?.slice(0, 10)}
                </span>
                <button
                  onClick={revokeAttestation}
                  className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-border-primary)]"
                >
                  Revoke &amp; obliterate
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={acceptAttestation}
              className="mt-3 w-full rounded-lg bg-[var(--color-attention)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-attention)]"
            >
              I attest — arm the security lane
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-tertiary)]">
        Based on the Identity Is Prime fog-authorization model. Prime topics are irreducible identity contexts. Within CITIZEN_FOG scope (your machine), you have full authorization for your stated prime context. Policy constraints only fire on cross-scope data export.
      </div>
    </div>
  )
}
