'use client'

import type { ActiveSurface } from '@/lib/types/surface'

/**
 * COMMAND CENTERS — the organizing spine for the left panel.
 *
 * LIVE — this registry drives <Sidebar> and <CommandCenterRail>. It models the
 * two-axis cockpit lesson borrowed from SocioProphet client-vue
 * (src/config/{cockpitNav,routeRegistry,domainRoutes}.ts) and Will's 2019
 * reference (willdvlpr-socioprophet .../components/Top.js):
 *
 *   DOMAIN axis      = which command center you're in  (Tier 1 — leftmost rail)
 *   CAPABILITY axis  = that center's tools/surfaces     (Tier 2 — labeled panel)
 *   CENTER           = the active surface
 *
 * We borrow the *mechanism* (data-driven registry + navTier + maturity so
 * nothing is a dead link), NOT their analyst taxonomy (News/Law/Economy/Markets).
 * Noetica is an operator/builder product, so our domains are the command centers
 * Michael named: Cloud/DevSecOps, AI & Model Ops, Data & DataOps, Analytics —
 * plus the core Workspace and cross-cutting Govern.
 */

/**
 * INFRA ALIGNMENT — the Workstation → Scale-Up → Cloud tiers bind to canonical
 * SocioProphet repos (the "truth hierarchy") and CONSUME the scale-up wrapper's
 * capability rather than reinventing cluster provisioning. Conform, don't fork.
 * Ref: github.com/SocioProphet/hyperswarm-agent-composable-cluster-scaleup
 */
export const INFRA_LINKAGES = {
  integration_target: 'SocioProphet/prophet-platform',
  workspace_governance: 'SocioProphet/sociosphere',
  protocol_canonical: 'SocioProphet/tritrpc',
  storage_standards: 'SocioProphet/socioprophet-standards-storage',
  ontology_canonical: 'SocioProphet/ontogenesis',
} as const

/**
 * The cluster scale-up capability the Cloud center's Scale-Up surface binds to.
 * Mirrors capd/hyperswarm.cluster-scaleup.capd.json — pinned (not vendored),
 * reproducible, supply-chain-forward. Local Porter (kind/k3s, n=1) is what this
 * wrapper scales up; they compose, we don't duplicate the provisioning logic.
 */
export const SCALEUP_CAPABILITY = {
  id: 'caps.infra.cluster-scaleup.hyperswarm@0.1.0',
  kind: 'infra.wrapper',
  repo: 'SocioProphet/hyperswarm-agent-composable-cluster-scaleup',
  upstreams: ['kubespray@v2.29.1', 'krew@v0.4.5', 'fybrik@v1.3.3'],
  policy: 'pin-not-vendor',
} as const

export type CommandCenterId =
  | 'workspace'   // chat-first collaboration & authoring — the "work"
  | 'workstation' // Local-first dev — Gitea repos, Porter deploys, local GitOps (THE foundation)
  | 'data'        // Data & DataOps — corpus, canon, ingestion, knowledge graph
  | 'ai'          // AI & Model Ops — studio, eval, tuning, boards, agents
  | 'cloud'       // Cloud & DevSecOps — LATER: off-machine, only after local DevSecOps exists
  | 'analytics'   // Analytics — dashboards, benchmarks, telemetry
  | 'govern'      // Govern — policy, alignment, evidence (cross-cutting)

/**
 * Where a surface appears. Borrowed from client-vue's NavTier
 * ('top' | 'left-rail' | 'tab-only' | 'hidden').
 *   primary   — shown in the command-center panel by default
 *   secondary — shown, but below the fold / in a "more" section
 *   tab       — folds into another surface as a tab (not its own panel row)
 *   hidden    — registered (route resolves) but not listed
 */
export type NavTier = 'primary' | 'secondary' | 'tab' | 'hidden'

/**
 * Build state. Borrowed from client-vue's L0–L5 maturity + status.
 *   live    — real, wired to a backend
 *   beta    — works, rough edges
 *   soon    — scaffolded surface, mock/"coming soon" panel (no dead link)
 *   planned — named gap, not yet a surface
 */
export type Maturity = 'live' | 'beta' | 'soon' | 'planned'

export interface CommandCenter {
  id: CommandCenterId
  /** rail label (Tier 1) */
  label: string
  /** one-line "what this center is for" — shown as the panel subtitle */
  blurb: string
}

export interface NavSurface {
  /** existing ActiveSurface id, or a string id for a not-yet-built gap */
  id: ActiveSurface | string
  label: string
  center: CommandCenterId
  tier: NavTier
  maturity: Maturity
  /** true if `id` is NOT yet a real ActiveSurface (a gap to build) */
  gap?: boolean
  /** if this surface folds into another as a tab, the host surface id */
  foldsInto?: ActiveSurface
}

export const COMMAND_CENTERS: CommandCenter[] = [
  { id: 'workspace',   label: 'Workspace', blurb: 'Chat, canvas, notes & rooms — where the work happens' },
  { id: 'workstation', label: 'Workstation', blurb: 'Local-first dev — Gitea repos, Porter deploys, local GitOps' },
  { id: 'data',        label: 'Data',      blurb: 'Corpus, canon, ingestion & the knowledge graph' },
  { id: 'ai',          label: 'AI · Models', blurb: 'Studio, evaluation, tuning, boards & agents' },
  { id: 'cloud',       label: 'Cloud · DevSecOps', blurb: 'Off-machine — comes AFTER local DevSecOps is real' },
  { id: 'analytics',   label: 'Analytics', blurb: 'Dashboards, benchmarks & telemetry' },
  { id: 'govern',      label: 'Govern',    blurb: 'Policy, alignment & evidence — across every center' },
]

/**
 * The registry. Existing surfaces are mapped to a home command center; named
 * gaps (gap:true, maturity:'planned') mark what each center still needs so we
 * can scaffold "coming soon" panels rather than leave empty columns.
 *
 * Ambiguous placements are flagged inline — these are the calls to settle
 * against Michael's screens.
 */
export const NAV_SURFACES: NavSurface[] = [
  // ── Workspace ──────────────────────────────────────────────────────────
  { id: 'chat',       label: 'Chat',        center: 'workspace', tier: 'primary',   maturity: 'live' },
  { id: 'canvas',     label: 'Canvas',      center: 'workspace', tier: 'primary',   maturity: 'live' },
  { id: 'notes',      label: 'Notes',       center: 'workspace', tier: 'primary',   maturity: 'live' },
  { id: 'cowork',     label: 'Collaborate', center: 'workspace', tier: 'primary',   maturity: 'live' },
  { id: 'workrooms',  label: 'Workrooms',   center: 'workspace', tier: 'primary',   maturity: 'live' },
  { id: 'jitsi',      label: 'Video',       center: 'workspace', tier: 'tab',       maturity: 'live', foldsInto: 'workrooms' },
  { id: 'calendar',   label: 'Calendar',    center: 'workspace', tier: 'secondary', maturity: 'beta' },
  { id: 'docs',       label: 'Documents',   center: 'workspace', tier: 'secondary', maturity: 'beta' }, // ? office suite — could be Data
  { id: 'projects',   label: 'Projects',    center: 'workspace', tier: 'secondary', maturity: 'live' }, // ? PM — could be its own Build center

  // ── Workstation — local-first dev, OS layer (Gitea → continuum PaaS → prophet-cli → scale-up) ──
  { id: 'code',       label: 'Source',      center: 'workstation', tier: 'primary',   maturity: 'live' }, // Gitea Sovereign + local repos; language intel via synapseiq (tree-sitter/LSP)
  { id: 'deploy',     label: 'Deploy',      center: 'workstation', tier: 'primary',   maturity: 'beta' }, // sourceos-continuum / Porter local PaaS (kind/k3s) — LIVE surface
  { id: 'services',   label: 'Services',    center: 'workstation', tier: 'primary',   maturity: 'beta' }, // DevSpaces (Nocalhost BaseSpace/MeshSpace ↔ trust namespaces) — LIVE surface
  { id: 'pipelines',  label: 'Pipelines',   center: 'workstation', tier: 'secondary', maturity: 'beta' }, // local GitOps (Argo CD, PR-driven) — LIVE surface
  { id: 'terminal',   label: 'Terminal',    center: 'workstation', tier: 'secondary', maturity: 'beta' }, // prophet-cli / sourceosctl operator console — LIVE surface

  // ── Data & DataOps — search (local lampstand vs platform sherlock), enrichment, graph ──
  { id: 'academy',    label: 'Academy',     center: 'data', tier: 'primary',   maturity: 'beta' }, // the Alexandrian learning surface: mastery path + SRS practice + AI tutor
  { id: 'guardian',   label: 'Guardian',    center: 'data', tier: 'secondary', maturity: 'beta' }, // parent/admin cockpit over the learner — progress, due, mastered; rosters + coach hand-off next
  { id: 'library',    label: 'Library',     center: 'data', tier: 'primary',   maturity: 'live' },
  { id: 'artifacts',  label: 'Artifacts',   center: 'data', tier: 'primary',   maturity: 'live' },
  { id: 'workspace',  label: 'Project Files', center: 'data', tier: 'secondary', maturity: 'live' },
  { id: 'search',     label: 'Search',      center: 'data', tier: 'primary',   maturity: 'beta' }, // local=lampstand (desktop index) · platform=sherlock-search (evidence) — LIVE surface
  { id: 'kg',         label: 'Knowledge Graph', center: 'data', tier: 'primary', maturity: 'beta' }, // hellgraph (on-device + as-a-service) — LIVE full-screen graph
  { id: 'enrich',     label: 'Enrichment',  center: 'data', tier: 'primary',   maturity: 'planned', gap: true }, // synapseiq semantic-enrichment fabric
  { id: 'canon',      label: 'Canon · Corpus',  center: 'data', tier: 'secondary', maturity: 'planned', gap: true },
  { id: 'ingest',     label: 'Ingestion',   center: 'data', tier: 'secondary', maturity: 'planned', gap: true },
  { id: 'connectors', label: 'Connectors',  center: 'data', tier: 'secondary', maturity: 'planned', gap: true },

  // ── AI & Model Ops = SociOS opt-in COLLECTIVE-INTELLIGENCE tuning layer (tune/update/A-B) ──
  { id: 'studio',     label: 'Studio',      center: 'ai', tier: 'primary',   maturity: 'live' },
  { id: 'evaluate',   label: 'Evaluate',    center: 'ai', tier: 'primary',   maturity: 'live' },
  { id: 'tune',       label: 'Tune & Train', center: 'ai', tier: 'primary',  maturity: 'live' },
  { id: 'labs',       label: 'Labs',        center: 'ai', tier: 'primary',   maturity: 'beta' }, // SociOS modality labs (Apple-aligned: on-device base + per-lab LoRA adapters + server) — LIVE surface
  { id: 'boards',     label: 'A/B Boards',  center: 'ai', tier: 'primary',   maturity: 'planned', gap: true }, // A/B testing + frontier/MMLU boards
  { id: 'rag',        label: 'RAG Inspector', center: 'ai', tier: 'tab',     maturity: 'live', foldsInto: 'studio' },
  { id: 'lab',        label: 'Capabilities', center: 'ai', tier: 'tab',      maturity: 'live', foldsInto: 'studio' },
  { id: 'agents',     label: 'Agents',      center: 'ai', tier: 'secondary', maturity: 'beta' },
  { id: 'dispatch',   label: 'Dispatch',    center: 'ai', tier: 'primary',   maturity: 'beta' }, // launch + watch standalone background agent runs
  { id: 'routines',   label: 'Routines',    center: 'ai', tier: 'primary',   maturity: 'beta' }, // scheduled recurring agent runs
  { id: 'actions',    label: 'Actions',     center: 'ai', tier: 'secondary', maturity: 'beta' }, // typed action catalog (Bet C v1)
  { id: 'registry',   label: 'Model Registry', center: 'ai', tier: 'secondary', maturity: 'planned', gap: true }, // lattice-forge RuntimeAssets

  // ── Cloud · DevSecOps — Scale-Up → off-machine (only AFTER local DevSecOps) ──
  { id: 'cluster',    label: 'Scale-Up',     center: 'cloud', tier: 'primary',   maturity: 'planned', gap: true }, // caps.infra.cluster-scaleup.hyperswarm (pinned)
  { id: 'security',   label: 'Security',     center: 'cloud', tier: 'primary',   maturity: 'planned', gap: true }, // DevSecOps posture — GATES the jump to cloud
  { id: 'deploys',    label: 'Deployments',  center: 'cloud', tier: 'primary',   maturity: 'planned', gap: true }, // cloud-tier CI/CD, GKE/ArgoCD
  { id: 'broker',     label: 'Cloud Broker', center: 'cloud', tier: 'primary',   maturity: 'live' },
  { id: 'operate',    label: 'Operate',      center: 'cloud', tier: 'secondary', maturity: 'live' },
  { id: 'computer',   label: 'Computer Use', center: 'cloud', tier: 'tab',       maturity: 'beta', foldsInto: 'operate' },
  { id: 'platform',   label: 'Platform',     center: 'cloud', tier: 'secondary', maturity: 'soon' },
  { id: 'marketplace', label: 'Marketplace', center: 'cloud', tier: 'secondary', maturity: 'soon' },
  { id: 'secrets',    label: 'Secrets',      center: 'cloud', tier: 'secondary', maturity: 'planned', gap: true },

  // ── Analytics ──────────────────────────────────────────────────────────
  { id: 'analytics',    label: 'Dashboards',   center: 'analytics', tier: 'primary', maturity: 'planned', gap: true },
  { id: 'intelligence', label: 'Signals · demo', center: 'analytics', tier: 'secondary', maturity: 'beta' }, // IntelligenceSurface — HARDWIRED to the GYG/IFM Investors demo dataset; labeled + demoted so it isn't a generic primary feature (was collapsed-rail-only; do NOT promote without an org/demo gate)
  { id: 'portfolio',    label: 'Portfolio · demo', center: 'analytics', tier: 'secondary', maturity: 'beta' }, // PortfolioSurface — same GYG/IFM demo dataset; labeled + demoted for the same reason
  { id: 'geo',          label: 'Geo',          center: 'analytics', tier: 'secondary', maturity: 'beta' },
  { id: 'benchmark',    label: 'Benchmarks',   center: 'ai', tier: 'tab', maturity: 'live', foldsInto: 'evaluate' }, // BenchmarkDashboard ships live INSIDE EvaluateSurface — not a standalone (was a fake "coming soon" row)
  { id: 'telemetry',    label: 'Telemetry',    center: 'analytics', tier: 'secondary', maturity: 'planned', gap: true },

  // ── Govern (cross-cutting) ─────────────────────────────────────────────
  { id: 'govern',     label: 'Govern',      center: 'govern', tier: 'primary', maturity: 'live' },
  { id: 'alignment',  label: 'Alignment',   center: 'govern', tier: 'primary', maturity: 'beta' },
  { id: 'holographme', label: 'HolographMe', center: 'govern', tier: 'secondary', maturity: 'beta' },
]

/** All surfaces for a given command center, in registry order. */
export function surfacesFor(center: CommandCenterId): NavSurface[] {
  return NAV_SURFACES.filter((s) => s.center === center)
}
