'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

/**
 * MarketplaceSurface — Noetica Partner Network + Swarm Marketplace.
 *
 * Five tabs:
 *   Workflows  — swarm template cards; operators deploy these on their mesh
 *   Skills     — MCP tools + registry connectors
 *   Partners   — sovereign partner profiles with HolographMe integration
 *   Apps       — Flatpak/AppImage/OCI packages (Linux-first sovereign app store)
 *   Community  — Minds-federated knowledge sessions, events, discussions
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface SwarmTemplate {
  id: string; title: string; description: string; icon: string; domains: string[]
}

interface PartnerCapability {
  kind: 'swarm-template' | 'mcp-skill' | 'app' | 'persona'
  id: string; title: string; description: string
}

interface PartnerProfile {
  id: string; name: string; bio: string; avatar?: string
  meshEndpoint?: string; holographHandle?: string
  capabilities: PartnerCapability[]
  tier: 'community' | 'verified' | 'sovereign'
  joinedAt: string; lastSeenAt?: string
}

interface RegistryEntry {
  id: string; kind: string; title: string; description: string; domains: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_STYLE: Record<PartnerProfile['tier'], { label: string; bg: string; text: string }> = {
  community: { label: 'Community', bg: 'bg-[var(--color-background-tertiary)]', text: 'text-[var(--color-text-tertiary)]' },
  verified:  { label: 'Verified',  bg: 'bg-[#ede9fe]',                           text: 'text-[#6d28d9]' },
  sovereign: { label: 'Sovereign', bg: 'bg-[var(--color-accent-bg)]',                           text: 'text-[var(--color-accent)]' },
}

const KIND_ICON: Record<PartnerCapability['kind'], string> = {
  'swarm-template': '⬡',
  'mcp-skill':      '⌁',
  'app':            '□',
  'persona':        '◎',
}

const DOMAIN_COLOR: Record<string, string> = {
  security:    'bg-[#fee2e2] text-[#dc2626]',
  compliance:  'bg-[#fef3c7] text-[var(--color-attention)]',
  analytics:   'bg-[#dbeafe] text-[#2563eb]',
  research:    'bg-[#ede9fe] text-[#7c3aed]',
  finance:     'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
  general:     'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]',
}

function domainChip(d: string) {
  const cls = DOMAIN_COLOR[d] ?? DOMAIN_COLOR['general']
  return <span key={d} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{d}</span>
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TemplateCard({ t, onDeploy }: { t: SwarmTemplate; onDeploy: (t: SwarmTemplate) => void }) {
  return (
    <button
      type="button"
      onClick={() => onDeploy(t)}
      className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 text-left transition hover:border-[var(--color-border-primary)] hover:bg-[var(--color-background-tertiary)]"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-lg text-[var(--color-text-secondary)]">{t.icon}</div>
      <div>
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t.title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">{t.description}</div>
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        {t.domains.slice(0, 3).map(domainChip)}
        <span className="rounded-md bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">Template</span>
      </div>
    </button>
  )
}

function PartnerCard({ p, onVouched }: { p: PartnerProfile; onVouched?: () => void }) {
  const tier = TIER_STYLE[p.tier]
  const [vouching, setVouching] = useState(false)
  const [vouchFrom, setVouchFrom] = useState('')
  const [vouchMsg, setVouchMsg] = useState('')

  async function submitVouch() {
    try {
      const r = await fetch(amUrl('/api/partner/vouch'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: vouchFrom.trim(), for: p.id, tier: 'verified' }),
        signal: AbortSignal.timeout(8000),
      })
      const d = await r.json() as { ok?: boolean; error?: string }
      if (!r.ok) throw new Error(d.error ?? `vouch ${r.status}`)
      setVouchMsg('Attested — tier upgraded to verified.')
      setVouching(false)
      onVouched?.()
    } catch (e) { setVouchMsg(e instanceof Error ? e.message : 'vouch failed') }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{p.name}</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{p.bio}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tier.bg} ${tier.text}`}>{tier.label}</span>
      </div>

      {p.capabilities.length > 0 && (
        <div className="mt-3 space-y-1">
          {p.capabilities.slice(0, 3).map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-background-primary)] px-2.5 py-1.5">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{KIND_ICON[c.kind]}</span>
              <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{c.title}</span>
              <span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">{c.kind.replace('-', ' ')}</span>
            </div>
          ))}
          {p.capabilities.length > 3 && (
            <div className="px-2.5 text-[11px] text-[var(--color-text-tertiary)]">+{p.capabilities.length - 3} more</div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
        {p.meshEndpoint && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            mesh node
          </span>
        )}
        <span>joined {timeAgo(p.joinedAt)}</span>
        {p.holographHandle && (
          <button type="button" className="ml-auto text-[#7c3aed] hover:underline">
            HolographMe ↗
          </button>
        )}
      </div>

      {/* Attestation — vouching flow for community operators */}
      {p.tier === 'community' && (
        <div className="mt-3 border-t border-[var(--color-border-tertiary)] pt-3">
          {!vouching && !vouchMsg && (
            <button type="button" onClick={() => setVouching(true)}
              className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[#7c3aed] transition">
              + Attest for tier upgrade
            </button>
          )}
          {vouching && (
            <div className="flex items-center gap-1">
              <input value={vouchFrom} onChange={(e) => setVouchFrom(e.target.value)}
                placeholder="Your operator id"
                className="flex-1 rounded-lg border border-[var(--color-border-tertiary)] bg-transparent px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
              <button type="button" onClick={() => void submitVouch()} disabled={!vouchFrom.trim()}
                className="rounded-lg bg-[#7c3aed] px-2 py-1 text-[11px] text-white disabled:opacity-40">Attest</button>
              <button type="button" onClick={() => { setVouching(false); setVouchFrom('') }}
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] px-1">×</button>
            </div>
          )}
          {vouchMsg && <div className="text-[11px] text-[var(--color-accent)]">{vouchMsg}</div>}
        </div>
      )}
    </div>
  )
}

function SkillCard({ e }: { e: RegistryEntry }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
      <div className="text-[12px] font-semibold text-[var(--color-text-primary)]">{e.title}</div>
      <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{e.description}</div>
      <div className="mt-2 flex flex-wrap gap-1">{e.domains.slice(0, 3).map(domainChip)}</div>
    </div>
  )
}

// ── Community feed (Minds-inspired, fixture-seeded until federation lands) ────

const COMMUNITY_EVENTS = [
  {
    id: 'ev1', kind: 'session', title: 'Swarm ergonomics: 100-agent mesh at scale',
    host: 'Sovereign Ops Co.', date: '2026-07-10T17:00:00Z', attendees: 42,
    description: 'Live walkthrough of a 100-agent GraphRAG pipeline — blackboard coordination, ECAN attention, latency profiling.',
    tags: ['swarm', 'mesh', 'graphrag'],
  },
  {
    id: 'ev2', kind: 'discussion', title: 'Compliance workflows: from attestation to sovereign evidence chain',
    host: 'PDOR Knowledge Commons', date: '2026-07-08T00:00:00Z', attendees: 18,
    description: 'How to wire SCOPE-D EngagementPolicy into a regulatory Q/A swarm and produce court-ready evidence receipts.',
    tags: ['compliance', 'scope-d', 'evidence'],
  },
  {
    id: 'ev3', kind: 'session', title: 'HolographMe deep dive — sovereign identity on the mesh',
    host: 'Arsenal Security Lab', date: '2026-07-05T00:00:00Z', attendees: 31,
    description: 'Building a did:key credential, publishing your HolographMe profile, and federating across mesh nodes.',
    tags: ['identity', 'holographme', 'federation'],
  },
  {
    id: 'ev4', kind: 'resource', title: 'PDOR data-onboarding guide: brain-eligibility gating',
    host: 'PDOR Knowledge Commons', date: '2026-07-01T00:00:00Z', attendees: 0,
    description: 'Step-by-step: register a dataset, classify license tier, run the brain-eligibility gate, get your PDOR receipt.',
    tags: ['data', 'governance', 'pdor'],
  },
]

function CommunityFeed() {
  const KIND_BADGE: Record<string, string> = {
    session: 'bg-[#ede9fe] text-[#6d28d9]',
    discussion: 'bg-[#dbeafe] text-[#2563eb]',
    resource: 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
  }
  return (
    <div className="space-y-3">
      {COMMUNITY_EVENTS.map((ev) => (
        <div key={ev.id} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${KIND_BADGE[ev.kind] ?? KIND_BADGE['resource']}`}>{ev.kind}</span>
                <span className="text-[11px] text-[var(--color-text-tertiary)]">{timeAgo(ev.date)}</span>
              </div>
              <div className="mt-1 text-[13px] font-semibold text-[var(--color-text-primary)]">{ev.title}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{ev.description}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
            <span>by {ev.host}</span>
            {ev.attendees > 0 && <span>{ev.attendees} attending</span>}
            <div className="flex flex-wrap gap-1 ml-auto">
              {ev.tags.map((t) => <span key={t} className="rounded-md bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[11px]">#{t}</span>)}
            </div>
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-dashed border-[var(--color-border-tertiary)] px-4 py-3 text-center text-[11px] text-[var(--color-text-tertiary)]">
        Federation with sovereign Minds hub — coming when meshEndpoint is configured
      </div>
    </div>
  )
}

// ── Operator onboarding wizard ────────────────────────────────────────────────

const OP_STEPS = ['Identity', 'Capabilities', 'Mesh', 'Publish'] as const
type OpStep = (typeof OP_STEPS)[number]

type CapKind = 'swarm-template' | 'mcp-skill' | 'app' | 'persona'
interface DraftCap { kind: CapKind; title: string; description: string }

function OperatorWizard() {
  const [step, setStep] = useState<OpStep>('Identity')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [tier, setTier] = useState<'community' | 'verified' | 'sovereign'>('community')
  const [caps, setCaps] = useState<DraftCap[]>([{ kind: 'swarm-template', title: '', description: '' }])
  const [meshEndpoint, setMeshEndpoint] = useState('')
  const [holographHandle, setHolographHandle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const stepIdx = OP_STEPS.indexOf(step)
  const canNext = step === 'Identity' ? name.trim().length > 0
    : step === 'Capabilities' ? caps.some((c) => c.title.trim())
    : true

  function addCap() { if (caps.length < 5) setCaps((cs) => [...cs, { kind: 'swarm-template', title: '', description: '' }]) }
  function removeCap(i: number) { setCaps((cs) => cs.filter((_, j) => j !== i)) }
  function updateCap(i: number, field: keyof DraftCap, value: string) {
    setCaps((cs) => cs.map((c, j) => j === i ? { ...c, [field]: value } : c))
  }

  async function publish() {
    setSubmitting(true); setErr('')
    const validCaps = caps.filter((c) => c.title.trim())
    // Generate a self-sovereign did:key identifier anchored to this registration
    const randBytes = new Uint8Array(16)
    crypto.getRandomValues(randBytes)
    const did = `did:key:z${Array.from(randBytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
    try {
      const r = await fetch(amUrl('/api/partner/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: did, name, bio, tier, meshEndpoint: meshEndpoint || undefined, holographHandle: holographHandle || undefined, capabilities: validCaps.map((c) => ({ ...c, id: `${c.kind}-${c.title.toLowerCase().replace(/\s+/g, '-')}` })) }),
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? `register ${r.status}`) }
      setDone(true)
    } catch (e) { setErr(e instanceof Error ? e.message : 'registration failed') }
    finally { setSubmitting(false) }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mb-3 text-4xl">✦</div>
        <div className="text-base font-semibold text-[var(--color-text-primary)]">You&apos;re on the mesh</div>
        <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">Your operator profile is live. Other mesh nodes can now discover your capabilities, and the Partner Network will reflect your registration shortly.</p>
        <button onClick={() => { setDone(false); setStep('Identity'); setName(''); setBio(''); setCaps([{ kind: 'swarm-template', title: '', description: '' }]); setMeshEndpoint(''); setHolographHandle('') }}
          className="mt-5 rounded-xl border border-[var(--color-border-secondary)] px-4 py-2 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
          Register another profile
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg py-6">
      {/* Step progress */}
      <div className="mb-6 flex items-center gap-0">
        {OP_STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition ${
              i < stepIdx ? 'bg-[#7c3aed] text-white' : i === stepIdx ? 'bg-[#7c3aed] text-white ring-4 ring-[#ede9fe]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'
            }`}>{i < stepIdx ? '✓' : i + 1}</div>
            <div className={`flex-1 text-center text-[11px] font-medium ${i === stepIdx ? 'text-[#7c3aed]' : 'text-[var(--color-text-tertiary)]'}`}>{i < OP_STEPS.length - 1 ? <span className="mx-1 hidden sm:inline">{s}</span> : null}</div>
            {i < OP_STEPS.length - 1 && <div className={`h-px flex-1 ${i < stepIdx ? 'bg-[#7c3aed]' : 'bg-[var(--color-border-tertiary)]'}`} />}
          </div>
        ))}
      </div>
      <div className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">{step}</div>

      {/* Step 1 — Identity */}
      {step === 'Identity' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Your operator identity is self-sovereign — anchored to your device, not an account. Other mesh nodes will see this profile.</p>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or org" className="mt-1 block w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">Bio</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What you do, what you build…" rows={3} className="mt-1 block w-full resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
          </label>
          <div>
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">Tier</span>
            <div className="mt-1.5 flex gap-2">
              {(['community', 'verified', 'sovereign'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTier(t)} className={`rounded-full border px-3 py-1 text-[11px] capitalize transition ${tier === t ? 'border-[#7c3aed] bg-[#ede9fe] font-semibold text-[#7c3aed]' : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'}`}>{t}</button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{tier === 'community' ? 'Self-declared; no verification required.' : tier === 'verified' ? 'Attested by at least one existing verified/sovereign operator.' : 'Attested + SCOPE-D-signed engagement policy on file.'}</p>
          </div>
        </div>
      )}

      {/* Step 2 — Capabilities */}
      {step === 'Capabilities' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--color-text-tertiary)]">What are you publishing to the mesh? Add swarm templates, MCP skills, apps, or persona definitions.</p>
          {caps.map((c, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select value={c.kind} onChange={(e) => updateCap(i, 'kind', e.target.value)} className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none">
                  <option value="swarm-template">⬡ Swarm template</option>
                  <option value="mcp-skill">MCP skill</option>
                  <option value="app">□ App</option>
                  <option value="persona">◎ Persona</option>
                </select>
                {caps.length > 1 && <button type="button" onClick={() => removeCap(i)} className="ml-auto text-[var(--color-text-tertiary)] hover:text-[#dc2626] text-xs">×</button>}
              </div>
              <input value={c.title} onChange={(e) => updateCap(i, 'title', e.target.value)} placeholder="Title" className="block w-full rounded-lg border border-[var(--color-border-tertiary)] bg-transparent px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
              <input value={c.description} onChange={(e) => updateCap(i, 'description', e.target.value)} placeholder="Brief description" className="block w-full rounded-lg border border-[var(--color-border-tertiary)] bg-transparent px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
            </div>
          ))}
          {caps.length < 5 && <button type="button" onClick={addCap} className="rounded-lg border border-dashed border-[var(--color-border-secondary)] px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)] hover:border-[#7c3aed] hover:text-[#7c3aed] transition">+ Add capability</button>}
        </div>
      )}

      {/* Step 3 — Mesh */}
      {step === 'Mesh' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Optional — set a mesh endpoint so other Noetica nodes can federate with you. Leave blank to register locally only.</p>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">Mesh endpoint</span>
            <input value={meshEndpoint} onChange={(e) => setMeshEndpoint(e.target.value)} placeholder="https://my-node.example.com" className="mt-1 block w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">HolographMe handle <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span></span>
            <input value={holographHandle} onChange={(e) => setHolographHandle(e.target.value)} placeholder="@handle" className="mt-1 block w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
          </label>
        </div>
      )}

      {/* Step 4 — Publish */}
      {step === 'Publish' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Review your operator profile before publishing to the mesh.</p>
          <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 space-y-2">
            <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${TIER_STYLE[tier].bg} ${TIER_STYLE[tier].text}`}>{tier}</span><span className="text-sm font-semibold text-[var(--color-text-primary)]">{name}</span></div>
            {bio && <div className="text-[11px] text-[var(--color-text-secondary)]">{bio}</div>}
            {caps.filter((c) => c.title.trim()).map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]"><span>{KIND_ICON[c.kind]}</span>{c.title}</div>
            ))}
            {meshEndpoint && <div className="text-[11px] text-[var(--color-text-tertiary)]">endpoint: {meshEndpoint}</div>}
          </div>
          {err && <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11px] text-[#dc2626]">{err}</div>}
          <button type="button" onClick={() => void publish()} disabled={submitting}
            className="w-full rounded-xl bg-[#7c3aed] px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-50">
            {submitting ? 'Publishing…' : 'Publish to mesh'}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={() => setStep(OP_STEPS[stepIdx - 1]!)} disabled={stepIdx === 0}
          className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] disabled:opacity-30 transition">
          ← Back
        </button>
        {stepIdx < OP_STEPS.length - 1 && (
          <button type="button" onClick={() => setStep(OP_STEPS[stepIdx + 1]!)} disabled={!canNext}
            className="rounded-xl bg-[#7c3aed] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-40 transition">
            Continue →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main surface ──────────────────────────────────────────────────────────────

type Tab = 'workflows' | 'skills' | 'partners' | 'operator' | 'apps' | 'community'

const TABS: { id: Tab; label: string }[] = [
  { id: 'workflows',  label: 'Workflows' },
  { id: 'skills',     label: 'Skills' },
  { id: 'partners',   label: 'Partners' },
  { id: 'operator',   label: 'Become an Operator' },
  { id: 'apps',       label: 'Apps' },
  { id: 'community',  label: 'Community' },
]

export function MarketplaceSurface() {
  const [tab, setTab] = useState<Tab>('workflows')
  const [templates, setTemplates] = useState<SwarmTemplate[]>([])
  const [partners, setPartners] = useState<PartnerProfile[]>([])
  const [skills, setSkills] = useState<RegistryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deployMsg, setDeployMsg] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [partnerRes, skillsRes] = await Promise.all([
          fetch(amUrl('/api/partner/list'), { signal: AbortSignal.timeout(5000) }),
          fetch(amUrl('/api/marketplace/apps'), { signal: AbortSignal.timeout(5000) }),
        ])
        if (partnerRes.ok) {
          const d = await partnerRes.json() as { partners?: PartnerProfile[]; templates?: SwarmTemplate[] }
          if (d.partners) setPartners(d.partners)
          if (d.templates) setTemplates(d.templates)
        }
        if (skillsRes.ok) {
          const d = await skillsRes.json() as { entries?: RegistryEntry[] }
          if (d.entries) setSkills(d.entries)
        }
      } catch { /* backend may be offline */ }
      finally { setLoading(false) }
    })()
  }, [])

  function refreshPartners() {
    void fetch(amUrl('/api/partner/list'), { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { partners?: PartnerProfile[] } | null) => { if (d?.partners) setPartners(d.partners) })
      .catch(() => { /* silent */ })
  }

  function handleDeploy(t: SwarmTemplate) {
    // Honest: this is a template, not a live deploy. Point the user to where it's actually configured
    // + launched (AI → Agents) rather than claiming a deployment is underway.
    setDeployMsg(`"${t.title}" is a workflow template — configure and launch it in Agent Builder (AI → Agents).`)
    setTimeout(() => setDeployMsg(''), 5000)
  }

  const filteredTemplates = templates.filter((t) =>
    !search || `${t.title} ${t.description} ${t.domains.join(' ')}`.toLowerCase().includes(search.toLowerCase())
  )
  const filteredPartners = partners.filter((p) =>
    !search || `${p.name} ${p.bio}`.toLowerCase().includes(search.toLowerCase())
  )
  const filteredSkills = skills.filter((e) =>
    !search || `${e.title} ${e.description}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--color-border-tertiary)] px-6 pt-5 pb-0">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">Partner Network</div>
            <p className="mt-0.5 max-w-2xl text-xs text-[var(--color-text-secondary)]">
              Swarm workflow templates, sovereign skills, and partner operators — publish capabilities to the mesh or deploy what others have built.
            </p>
          </div>
          <button
            type="button"
            className="mb-1 shrink-0 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-tertiary)] transition"
          >
            + Publish
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-t-lg px-3 py-1.5 text-[12px] font-medium transition border-b-2 ${
                tab === t.id
                  ? 'border-[#7c3aed] text-[#7c3aed]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-6 py-2">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden>
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === 'community' ? 'Search sessions and discussions…' : 'Search…'}
          className="flex-1 border-0 bg-transparent text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
      </div>

      {/* Deploy flash */}
      {deployMsg && (
        <div className="mx-6 mt-3 rounded-xl border border-[#c4b5fd] bg-[#ede9fe] px-3 py-2 text-[12px] text-[#6d28d9]">{deployMsg}</div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border-tertiary)] border-t-[#7c3aed]" />
            Loading…
          </div>
        )}

        {/* Workflows */}
        {!loading && tab === 'workflows' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                Deploy a swarm workflow template — configure it in Agent Builder, then launch on your mesh.
              </p>
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{filteredTemplates.length} templates</span>
            </div>
            {filteredTemplates.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">No templates match &ldquo;{search}&rdquo;</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.map((t) => <TemplateCard key={t.id} t={t} onDeploy={handleDeploy} />)}
              </div>
            )}
          </div>
        )}

        {/* Skills */}
        {!loading && tab === 'skills' && (
          <div>
            <p className="mb-4 text-[11px] text-[var(--color-text-tertiary)]">Registry-backed skills, chart specs, and MCP connectors available to every agent on your mesh.</p>
            {filteredSkills.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">{search ? `No skills match "${search}"` : 'No skills in registry — add entries via /api/registry/register.'}</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSkills.map((e) => <SkillCard key={e.id} e={e} />)}
              </div>
            )}
          </div>
        )}

        {/* Partners */}
        {!loading && tab === 'partners' && (
          <div>
            <p className="mb-4 text-[11px] text-[var(--color-text-tertiary)]">Sovereign operators publishing capabilities to the mesh. Each partner&apos;s identity is anchored to a did:key credential held at their edge.</p>
            {filteredPartners.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">{search ? `No partners match “${search}”` : 'No partners registered yet.'}</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredPartners.map((p) => <PartnerCard key={p.id} p={p} onVouched={refreshPartners} />)}
              </div>
            )}
          </div>
        )}

        {/* Operator onboarding */}
        {tab === 'operator' && <OperatorWizard />}

        {/* Apps */}
        {!loading && tab === 'apps' && (
          <div className="space-y-4">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Linux-first, sovereign app store — Flatpak/AppImage/OCI packages governed by SCOPE-D at install time. Sandbox permissions are assessed before any install.</p>
            <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] px-6 py-10 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-background-secondary)] text-lg">□</div>
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">App catalog coming soon</div>
              <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Partners publish Flatpak manifests; the sovereign OSTree remote serves verified packages with scope-d-audited sandbox permissions.</p>
            </div>
          </div>
        )}

        {/* Community */}
        {tab === 'community' && <CommunityFeed />}
      </div>
    </div>
  )
}
