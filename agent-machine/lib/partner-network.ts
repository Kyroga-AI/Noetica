/**
 * partner-network.ts — sovereign partner identity + capability registry for the Noetica mesh.
 *
 * A partner is any operator who has published one or more capabilities (swarm templates, MCP skills,
 * Flatpak apps, or sovereign AI personas) to the mesh. Partners are identified by their did:key from
 * sovereign-broker — their root never leaves their edge; only their public credential is shared.
 *
 * Local partners are stored in HellGraph (same as registry entries — survives restart, compounds).
 * Federation: each partner's meshEndpoint exposes /api/atomspace/sync so cross-partner discovery
 * works via the existing storage-node federation layer.
 */
import { getGraph } from './graph.js'

export type CapabilityKind = 'swarm-template' | 'mcp-skill' | 'app' | 'persona'

export interface PartnerCapability {
  kind: CapabilityKind
  id: string      // registry entry id or marketplace app id
  title: string
  description: string
}

export interface PartnerProfile {
  id: string                      // did:key pseudonym from sovereign-broker (scoped to 'partner-network')
  name: string
  bio: string
  avatar?: string                 // data URI or omitted
  meshEndpoint?: string           // https://mesh.their-org.internal — federation point
  holographHandle?: string        // their subject_id in GAIA twin registry (for HolographMe card)
  capabilities: PartnerCapability[]
  tier: 'community' | 'verified' | 'sovereign'  // community = self-registered; verified = vouched; sovereign = full mesh node
  joinedAt: string                // ISO
  lastSeenAt?: string
}

const NODE_LABEL = 'PartnerProfile'

let _cache: PartnerProfile[] | null = null

function invalidate() { _cache = null }

export function listPartners(): PartnerProfile[] {
  if (_cache) return _cache
  const g = getGraph()
  const out: PartnerProfile[] = []
  for (const n of g.allNodes()) {
    if (!(n.labels ?? []).includes(NODE_LABEL)) continue
    const raw = (n.properties as Record<string, unknown>)?.['profile']
    if (typeof raw === 'string') { try { out.push(JSON.parse(raw) as PartnerProfile) } catch { /* skip */ } }
  }
  _cache = out.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
  return _cache
}

export function getPartner(id: string): PartnerProfile | null {
  return listPartners().find((p) => p.id === id) ?? null
}

export function registerPartner(profile: PartnerProfile): void {
  if (!profile.id || !profile.name) return
  invalidate()
  const g = getGraph()
  g.addNode(`partner:${profile.id}`, [NODE_LABEL], {
    profile: JSON.stringify(profile),
    name: profile.name,
    tier: profile.tier,
    joined_at: profile.joinedAt,
  })
}

export function updatePartnerLastSeen(id: string): void {
  const g = getGraph()
  const node = g.allNodes().find((n) => n.id === `partner:${id}`)
  if (!node) return
  const raw = (node.properties as Record<string, unknown>)?.['profile']
  if (typeof raw !== 'string') return
  try {
    const p = JSON.parse(raw) as PartnerProfile
    p.lastSeenAt = new Date().toISOString()
    ;(node.properties as Record<string, unknown>)['profile'] = JSON.stringify(p)
    invalidate()
  } catch { /* skip */ }
}

/** Seed the network with illustrative partner entries (fixture-backed — real partners register via POST). */
export function seedFixturePartners(): void {
  if (listPartners().length > 0) return
  const fixtures: PartnerProfile[] = [
    {
      id: 'did:key:zQ3shExampleSovereignMesh1',
      name: 'Sovereign Ops Co.',
      bio: 'Enterprise swarm operators — GraphRAG pipelines, compliance workflows, and sovereign data rooms.',
      tier: 'sovereign',
      capabilities: [
        { kind: 'swarm-template', id: 'template.swarm.compliance-qa', title: 'Compliance Q/A swarm', description: 'Multi-agent attestation pipeline over regulatory docs.' },
        { kind: 'mcp-skill',     id: 'skill.graphrag.deep-search',   title: 'GraphRAG deep search', description: 'HippoRAG-class retrieval with graph traversal.' },
      ],
      joinedAt: '2026-05-01T00:00:00Z',
    },
    {
      id: 'did:key:zQ3shExampleSecurityPartner2',
      name: 'Arsenal Security Lab',
      bio: 'Red-team + purple-team swarm templates wired to SCOPE-D EngagementPolicy.',
      tier: 'verified',
      capabilities: [
        { kind: 'swarm-template', id: 'template.swarm.red-team',    title: 'Red-team sweep', description: 'Automated adversarial sweep against policy targets.' },
        { kind: 'persona',         id: 'persona.sentinel.guardian', title: 'Guardian sentinel', description: 'Governance-sentinel persona with SCOPE-D gate.' },
      ],
      joinedAt: '2026-05-15T00:00:00Z',
    },
    {
      id: 'did:key:zQ3shExampleDataPartner3',
      name: 'PDOR Knowledge Commons',
      bio: 'Curated sovereign datasets + PDOR-governed data onboarding for mesh training.',
      tier: 'community',
      capabilities: [
        { kind: 'app', id: 'ai.noetica.DataRoom', title: 'Sovereign Data Room', description: 'Flatpak-sandboxed data room with governance gate.' },
      ],
      joinedAt: '2026-06-01T00:00:00Z',
    },
  ]
  for (const f of fixtures) registerPartner(f)
}

/** Swarm workflow templates surfaced in the Workflows tab (registry-backed, mirrors OpenAI Agent Builder cards). */
export const SWARM_TEMPLATES = [
  { id: 'swarm.data-enrichment',    title: 'Data enrichment',          description: 'Pull together graph-RAG context to answer operator questions.',        icon: '⬡', domains: ['analytics', 'ops'] },
  { id: 'swarm.planning',           title: 'Planning assistant',        description: 'Multi-step plan-mode swarm: decompose → verify → execute.',            icon: '⬡', domains: ['ops', 'general'] },
  { id: 'swarm.compliance-qa',      title: 'Compliance Q/A',           description: 'Attestation pipeline — regime stamp + control evidence + report.',      icon: '⬡', domains: ['compliance', 'legal'] },
  { id: 'swarm.doc-compare',        title: 'Document comparison',       description: 'Diff + entailment across uploaded docs — contradictions surfaced.',     icon: '⬡', domains: ['analytics', 'legal'] },
  { id: 'swarm.customer-intel',     title: 'Customer intelligence',     description: 'Entity extraction + sentiment + graph traversal over conversation.',    icon: '⬡', domains: ['sales', 'ops'] },
  { id: 'swarm.knowledge-base',     title: 'Internal knowledge base',   description: 'Index, retrieve, and synthesize from a sovereign doc collection.',      icon: '⬡', domains: ['ops', 'general'] },
  { id: 'swarm.red-team',           title: 'Red-team sweep',            description: 'Arsenal adversarial sweep gated on SCOPE-D EngagementPolicy.',         icon: '⬡', domains: ['security'] },
  { id: 'swarm.audio-overview',     title: 'Research audio overview',   description: 'GraphRAG deep-dive → two-host dialogue script → voiced playback.',      icon: '⬡', domains: ['research', 'general'] },
]
