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
  sovereign: { label: 'Sovereign', bg: 'bg-[#dcfce7]',                           text: 'text-[#15803d]' },
}

const KIND_ICON: Record<PartnerCapability['kind'], string> = {
  'swarm-template': '⬡',
  'mcp-skill':      '⚡',
  'app':            '□',
  'persona':        '◎',
}

const DOMAIN_COLOR: Record<string, string> = {
  security:    'bg-[#fee2e2] text-[#dc2626]',
  compliance:  'bg-[#fef3c7] text-[#d97706]',
  analytics:   'bg-[#dbeafe] text-[#2563eb]',
  research:    'bg-[#ede9fe] text-[#7c3aed]',
  finance:     'bg-[#dcfce7] text-[#16a34a]',
  general:     'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]',
}

function domainChip(d: string) {
  const cls = DOMAIN_COLOR[d] ?? DOMAIN_COLOR['general']
  return <span key={d} className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{d}</span>
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
        <span className="rounded-md bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">Template</span>
      </div>
    </button>
  )
}

function PartnerCard({ p }: { p: PartnerProfile }) {
  const tier = TIER_STYLE[p.tier]
  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{p.name}</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{p.bio}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tier.bg} ${tier.text}`}>{tier.label}</span>
      </div>

      {p.capabilities.length > 0 && (
        <div className="mt-3 space-y-1">
          {p.capabilities.slice(0, 3).map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-background-primary)] px-2.5 py-1.5">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{KIND_ICON[c.kind]}</span>
              <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{c.title}</span>
              <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{c.kind.replace('-', ' ')}</span>
            </div>
          ))}
          {p.capabilities.length > 3 && (
            <div className="px-2.5 text-[10px] text-[var(--color-text-tertiary)]">+{p.capabilities.length - 3} more</div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
        {p.meshEndpoint && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
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
    resource: 'bg-[#dcfce7] text-[#15803d]',
  }
  return (
    <div className="space-y-3">
      {COMMUNITY_EVENTS.map((ev) => (
        <div key={ev.id} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${KIND_BADGE[ev.kind] ?? KIND_BADGE['resource']}`}>{ev.kind}</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(ev.date)}</span>
              </div>
              <div className="mt-1 text-[13px] font-semibold text-[var(--color-text-primary)]">{ev.title}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{ev.description}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
            <span>by {ev.host}</span>
            {ev.attendees > 0 && <span>{ev.attendees} attending</span>}
            <div className="flex flex-wrap gap-1 ml-auto">
              {ev.tags.map((t) => <span key={t} className="rounded-md bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[10px]">#{t}</span>)}
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

// ── Main surface ──────────────────────────────────────────────────────────────

type Tab = 'workflows' | 'skills' | 'partners' | 'apps' | 'community'

const TABS: { id: Tab; label: string }[] = [
  { id: 'workflows',  label: 'Workflows' },
  { id: 'skills',     label: 'Skills' },
  { id: 'partners',   label: 'Partners' },
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

  function handleDeploy(t: SwarmTemplate) {
    setDeployMsg(`Deploying "${t.title}" — open Agent Builder to configure and launch.`)
    setTimeout(() => setDeployMsg(''), 4000)
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
              <span className="text-[10px] text-[var(--color-text-tertiary)]">{filteredTemplates.length} templates</span>
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
                {filteredPartners.map((p) => <PartnerCard key={p.id} p={p} />)}
              </div>
            )}
          </div>
        )}

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
