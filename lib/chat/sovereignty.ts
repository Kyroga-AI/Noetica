// The sovereignty signal has THREE tiers, not two. Where a turn ran determines the real trust story:
//   device — nothing left this machine (best).
//   mesh   — left this device, but to YOUR prophet-mesh (SocioProphet-controlled, under the scope-d
//            gate). Off-device, but sovereign — NOT the same as handing data to a vendor.
//   cloud  — left to a third party (Anthropic, OpenAI, …). The one "your data went outside" signal.
// Colour encodes the tier: device = accent (blue/good), mesh = muted grey (calm, not alarm),
// cloud = attention (pink, notice this). Used by the message footer, the Answer inspector, and the
// topbar health pill so they never disagree.

export type SovereigntyTier = 'device' | 'mesh' | 'cloud'

export function providerTier(provider?: string | null): SovereigntyTier {
  const p = (provider ?? '').toLowerCase().trim()
  if (p === '' || p === 'ollama' || p === 'noetica' || p === 'local' || p === 'on-device') return 'device'
  if (p === 'prophet-mesh' || p === 'mesh' || p.includes('prophet')) return 'mesh'
  return 'cloud'
}

export const TIER_META: Record<SovereigntyTier, { dot: string; text: string; label: string }> = {
  device: { dot: 'var(--color-accent)',         text: 'var(--color-accent)',          label: 'on-device' },
  mesh:   { dot: 'var(--color-text-secondary)', text: 'var(--color-text-secondary)',  label: 'sovereign mesh' },
  cloud:  { dot: 'var(--color-attention)',      text: 'var(--color-attention)',       label: 'off-device' },
}
