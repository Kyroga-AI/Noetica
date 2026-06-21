/**
 * self-model — the agent's grounded knowledge of its own construction.
 *
 * Asked "how do you work?" the agent should answer from fact, not guesses. This
 * module ingests the repositories that actually build Noetica into two places:
 *
 *   1. RAG: each repo's identity (README, architecture, manifest, structure) is
 *      chunked + embedded via the doc-store, so self-questions retrieve grounded
 *      passages with citations.
 *   2. Structure: a `Self` root atom + a `Repo` atom per repository, linked by
 *      CONSUMES / PART_OF / SOURCES_FROM edges — a self-model the agent can
 *      traverse to explain the architecture, not just recite text.
 *
 * Repos are read from NOETICA_DEV_ROOT (default ~/dev). For a shipped app where
 * the source repos aren't on disk, ingestion falls back to a baked snapshot at
 * ~/.noetica/self-model.json (written by writeSnapshot at build time).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getHellGraph } from '@socioprophet/hellgraph'
import { ingestDocument } from './doc-store.js'

export type RepoKind = 'app' | 'engine' | 'governance' | 'platform' | 'intake'
export interface RepoSpec {
  name: string
  dir: string // directory name under the dev root
  kind: RepoKind
  role: string // authoritative one-line role (curated from each repo's own README)
  consumes?: string[] // names of repos this one depends on / consumes
  partOf?: string // umbrella platform
  sourcesFrom?: string[] // governed source repos it pulls corpora from
}

/** The construction graph. Roles are taken from each repo's own README so the
 *  self-model is grounded, not invented. */
export const CONSTRUCTION_REPOS: RepoSpec[] = [
  {
    name: 'noetica', dir: 'Noetica', kind: 'app',
    role: 'The governed local-first chat surface (this application) for the SocioProphet/SourceOS stack — Tauri shell + agent-machine backend.',
    consumes: ['hellgraph', 'graphbrain-contract'], partOf: 'prophet-platform',
  },
  {
    name: 'hellgraph', dir: 'hellgraph', kind: 'engine',
    role: 'Local-first OpenCog-compatible AtomSpace metagraph engine: typed atoms, PLN, ECAN attention, pattern matcher, SPARQL/Gremlin, SHACL, Atomese, StorageNode federation. Noetica\'s reasoning + memory substrate.',
  },
  {
    name: 'graphbrain-contract', dir: 'graphbrain-contract', kind: 'engine',
    role: 'The latent/collective-intelligence engine: Graphbrain-style symbolic semantics, governed neural evolution, runtime memory, and latent operators (LSA/LSI/LDA 22-basis). Serves both the platform layer and Noetica.',
    consumes: ['evidence-intake-kernel'],
  },
  {
    name: 'alexandrian-academy', dir: 'alexandrian-academy', kind: 'governance',
    role: 'Policy-governed curriculum platform: evidence-based learning objects with provenance and append-only governance (Sandbox→Canon). The governed source layer for domain corpora.',
  },
  {
    name: 'evidence-intake-kernel', dir: 'evidence-intake-kernel', kind: 'intake',
    role: 'Evidence intake, classification, and cataloging kernel: ingests corpora, classifies into taxonomy, and builds the artifact-catalog the latent engine consumes; syncs to Drive.',
    sourcesFrom: ['alexandrian-academy'],
  },
  {
    name: 'prophet-platform', dir: 'prophet-platform', kind: 'platform',
    role: 'The runtime and deployment hub (thin platform monorepo) for the SocioProphet platform: deployable services — API, gateway, web portal, search/index, execution.',
  },
]

const DEV_ROOT = process.env['NOETICA_DEV_ROOT'] ?? path.join(os.homedir(), 'dev')
const SNAPSHOT_PATH = path.join(os.homedir(), '.noetica', 'self-model.json')

function readFirst(dir: string, candidates: string[], max = 2400): string {
  for (const c of candidates) {
    const p = path.join(dir, c)
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').slice(0, max) } catch { /* skip */ }
  }
  return ''
}

/** Build the grounded identity text for one repo from its own files. */
export function extractRepoIdentity(repo: RepoSpec): string {
  const dir = path.join(DEV_ROOT, repo.dir)
  const readme = readFirst(dir, ['README.md', 'readme.md', 'docs/architecture.md', 'docs/ARCHITECTURE.md'])
  let manifest = ''
  try {
    const pj = path.join(dir, 'package.json')
    if (fs.existsSync(pj)) {
      const d = JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: string; description?: string; dependencies?: Record<string, string> }
      manifest = `package: ${d.name ?? ''}\n${d.description ?? ''}\nkey deps: ${Object.keys(d.dependencies ?? {}).slice(0, 12).join(', ')}`
    }
  } catch { /* skip */ }
  let structure = ''
  try { structure = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).slice(0, 30).join(', ') } catch { /* skip */ }

  return [
    `# ${repo.name} (${repo.kind})`,
    `Role: ${repo.role}`,
    repo.consumes?.length ? `Consumes: ${repo.consumes.join(', ')}` : '',
    repo.sourcesFrom?.length ? `Sources corpora from: ${repo.sourcesFrom.join(', ')}` : '',
    repo.partOf ? `Part of: ${repo.partOf}` : '',
    manifest ? `\n## Manifest\n${manifest}` : '',
    structure ? `\n## Top-level structure\n${structure}` : '',
    readme ? `\n## README / architecture\n${readme}` : '',
  ].filter(Boolean).join('\n')
}

export interface SelfModelSummary {
  repos: { name: string; kind: RepoKind; role: string; present: boolean }[]
  edges: { from: string; rel: string; to: string }[]
}

/** Structured self-model for prompt grounding + the /api/self/construction route. */
export function selfModelSummary(): SelfModelSummary {
  const edges: SelfModelSummary['edges'] = []
  for (const r of CONSTRUCTION_REPOS) {
    for (const c of r.consumes ?? []) edges.push({ from: r.name, rel: 'CONSUMES', to: c })
    for (const s of r.sourcesFrom ?? []) edges.push({ from: r.name, rel: 'SOURCES_FROM', to: s })
    if (r.partOf) edges.push({ from: r.name, rel: 'PART_OF', to: r.partOf })
  }
  return {
    repos: CONSTRUCTION_REPOS.map((r) => ({
      name: r.name, kind: r.kind, role: r.role,
      present: fs.existsSync(path.join(DEV_ROOT, r.dir)),
    })),
    edges,
  }
}

/** Heuristic: is the user asking about the agent itself / its construction? */
export function isSelfQuery(q: string): boolean {
  const selfish = /\b(your(self)?|you('re| are)?|how (do|are) (you|yu)|your (construction|architecture|design|code|repos?|stack|self|model|mesh)|who built you|what are you( made of)?|do you know yourself)\b/i.test(q)
  // Comparison questions ("how do you stack up to claude", "compare to gpt", "vs openai")
  // are self-queries too — the agent must understand its architecture RELATIVE to providers.
  const comparing = /\b(compare|compared|stack(ed)? ?up|versus|vs\.?|better|worse|different|how you stack|how (do|are) (you|yu))\b/i.test(q)
    && /\b(claude|gpt|chatgpt|openai|gemini|grok|llama|deepseek|mistral|anthropic|cloud|provider|competition|competitor|them|others?)\b/i.test(q)
  return selfish || comparing
}

/** A compact grounding block to inject into the system prompt for self-queries. */
export function selfGroundingBlock(): string {
  const s = selfModelSummary()
  const lines = s.repos.map((r) => `- ${r.name} [${r.kind}]: ${r.role}`)
  const rel = s.edges.map((e) => `- ${e.from} ${e.rel} ${e.to}`)
  return [
    'You are Noetica, a governed local-first neurosymbolic AI workstation. You are built from these repositories (this is your verified self-model):',
    ...lines,
    'Architecture relations:',
    ...rel,
    '',
    'HOW YOU COMPARE TO CLOUD ASSISTANTS (Claude, GPT, Gemini) — answer comparison questions from this, be specific and honest, never vague or evasive:',
    '- You are LOCAL-FIRST and SOVEREIGN: you run on the user’s own device, work offline, and their data never leaves the machine unless they explicitly opt in. Claude/GPT/Gemini are cloud services — more capable raw models, but the data leaves the device and there is no sovereignty or audit.',
    '- Raw model power: your local models (qwen2.5-coder, qwen3-coder-30b) are strong but BELOW the frontier. On real coding (SWE-bench Verified) local sits ~52% one-shot vs Claude Sonnet 4.6 at 79.6% and Opus 4.8 at 88.6%. Never claim parity on raw capability — you are honest that the frontier cloud models are more powerful per-shot.',
    '- Your edge is NOT a bigger brain — it is the SYSTEM around it: a verify-repair loop (generate → run the tests → repair, so a small local model beats a big one one-shot on recoverable tasks because code is verifiable); your OWN local embedder (a Rust fastembed sidecar, not the LLM); the HellGraph/AtomSpace neurosymbolic apparatus (PLN truth values, ECAN attention budgeting, a contradiction ledger, and a quality corpus that compounds — every solved task makes the next cheaper); fully governed, auditable execution (Govern); and a tiered prophet-mesh (local → sovereign-host → open-weight providers → frontier) so the user can escalate to frontier-class OPEN weights they host themselves when they choose.',
    '- The one-liner: a cloud assistant is a more powerful brain you RENT and send your data to; you are a sovereign system the user OWNS that gets more out of a smaller brain through structure, verification, memory, and governance. You out-LOOP rather than out-model.',
  ].join('\n')
}

export interface IngestSelfResult { reposIngested: number; chunksEmbedded: number; atoms: number; present: string[]; missing: string[] }

/**
 * Ingest the construction repos into RAG (doc-store) + the HellGraph self-model.
 * Idempotent per repo content. Writes a snapshot for shipped builds.
 */
export async function ingestSelfModel(): Promise<IngestSelfResult> {
  const g = getHellGraph()
  const now = new Date().toISOString()
  const selfId = 'self:noetica'
  if (!g.getNode(selfId)) g.addNode(selfId, ['Self'], { created_at: now })

  const present: string[] = []
  const missing: string[] = []
  let chunksEmbedded = 0
  let atoms = 0
  const snapshot: Record<string, string> = {}

  for (const repo of CONSTRUCTION_REPOS) {
    const dir = path.join(DEV_ROOT, repo.dir)
    const onDisk = fs.existsSync(dir)
    // Identity text: live from disk, else from the baked snapshot.
    let text = onDisk ? extractRepoIdentity(repo) : ''
    if (!text) {
      try { const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<string, string>; text = snap[repo.name] ?? '' } catch { /* none */ }
    }
    if (!text) { missing.push(repo.name); continue }
    present.push(repo.name)
    snapshot[repo.name] = text

    // RAG: chunk + embed for grounded retrieval.
    const res = await ingestDocument(`self/${repo.name}.md`, text)
    chunksEmbedded += res.embedded ?? 0

    // Structure: Repo atom + edge to Self.
    const repoId = `repo:${repo.name}`
    if (!g.getNode(repoId)) { g.addNode(repoId, ['Repo'], { name: repo.name, kind: repo.kind, role: repo.role, created_at: now }); atoms++ }
    g.addEdge('PART_OF_SELF', repoId, selfId, { at: now })
  }
  // Relations between repos.
  for (const e of selfModelSummary().edges) {
    const from = `repo:${e.from}`
    if (g.getNode(from)) g.addEdge(e.rel, from, `repo:${e.to}`, { at: now })
  }

  // Persist snapshot for shipped builds (best-effort).
  try { fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true }); fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2)) } catch { /* non-fatal */ }

  return { reposIngested: present.length, chunksEmbedded, atoms, present, missing }
}
