/**
 * repo-ingest.ts — "sign into Gitea/GitHub → select repos → suck them in → use as source of truth".
 *
 * Fetches a repository's file tree + text/code file contents over the FORGE API (no local clone needed),
 * then pipes each file through the existing ingestDocument() sink (chunk → embed → HellGraph vector + Document
 * atom → ontology grounding → blob-store provenance) and stitches a Repo→File graph so the repo becomes
 * queryable knowledge. Gitea is the sovereign authority; GitHub is an external connector (per lib/types/forge).
 */
export type ForgeKind = 'github' | 'gitea'

export interface RepoIngestRequest {
  provider: ForgeKind
  owner: string
  repo: string
  branch?: string
  token?: string
  giteaBase?: string            // e.g. https://gitea.local — required for gitea
  paths?: string[]              // optional explicit file allow-list; otherwise the whole tree (filtered)
  maxFiles?: number
  maxFileBytes?: number
}

export interface RepoFile { path: string; content: string; bytes: number }

// Text/code we ingest. Everything else (images, binaries, archives) is skipped.
const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'rb', 'php', 'swift', 'm', 'sh', 'bash', 'zsh', 'sql', 'md', 'mdx', 'txt', 'rst', 'json', 'jsonc',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'html', 'css', 'scss', 'less', 'vue', 'svelte', 'astro',
  'graphql', 'proto', 'dockerfile', 'tf', 'lua', 'r', 'jl', 'ex', 'exs', 'clj', 'hs', 'ml',
])
// Directories / files that are noise — never ingest.
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|\.next|coverage|__pycache__|\.venv|venv)(\/|$)/i
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|\.min\.(js|css)$|\.map$)/i

function isIngestable(path: string, size: number, maxBytes: number): boolean {
  if (SKIP_DIR.test(path) || SKIP_FILE.test(path)) return false
  if (size > maxBytes) return false
  const base = path.split('/').pop() ?? ''
  if (base.toLowerCase() === 'dockerfile' || base.toLowerCase() === 'makefile') return true
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return TEXT_EXT.has(ext)
}

const ghHeaders = (token?: string) => ({ Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': 'noetica' })
const giteaHeaders = (token?: string) => ({ Accept: 'application/json', ...(token ? { Authorization: `token ${token}` } : {}) })

/** List ingestable file paths (+ sizes) for a repo via the forge tree API. */
export async function fetchRepoTree(req: RepoIngestRequest): Promise<Array<{ path: string; size: number }>> {
  const branch = req.branch || 'main'
  const maxBytes = req.maxFileBytes ?? 256 * 1024
  let tree: Array<{ path: string; type: string; size?: number }> = []
  if (req.provider === 'github') {
    const url = `https://api.github.com/repos/${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    const r = await fetch(url, { headers: ghHeaders(req.token), signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`github tree ${r.status}`)
    tree = ((await r.json()) as { tree?: typeof tree }).tree ?? []
  } else {
    const base = (req.giteaBase ?? '').replace(/\/$/, '')
    if (!base) throw new Error('gitea base url required')
    const url = `${base}/api/v1/repos/${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=true&per_page=99999`
    const r = await fetch(url, { headers: giteaHeaders(req.token), signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`gitea tree ${r.status}`)
    tree = ((await r.json()) as { tree?: typeof tree }).tree ?? []
  }
  const allow = req.paths ? new Set(req.paths) : null
  return tree
    .filter((t) => t.type === 'blob' && (allow ? allow.has(t.path) : isIngestable(t.path, t.size ?? 0, maxBytes)))
    .map((t) => ({ path: t.path, size: t.size ?? 0 }))
    .slice(0, req.maxFiles ?? 2000)
}

/** Fetch one file's decoded UTF-8 content via the forge contents API. */
export async function fetchRepoFile(req: RepoIngestRequest, path: string): Promise<string | null> {
  const branch = req.branch || 'main'
  try {
    if (req.provider === 'github') {
      const url = `https://api.github.com/repos/${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
      const r = await fetch(url, { headers: ghHeaders(req.token), signal: AbortSignal.timeout(15_000) })
      if (!r.ok) return null
      const j = (await r.json()) as { content?: string; encoding?: string }
      return j.content && j.encoding === 'base64' ? Buffer.from(j.content, 'base64').toString('utf8') : null
    }
    const base = (req.giteaBase ?? '').replace(/\/$/, '')
    const url = `${base}/api/v1/repos/${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
    const r = await fetch(url, { headers: giteaHeaders(req.token), signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const j = (await r.json()) as { content?: string; encoding?: string }
    return j.content && j.encoding === 'base64' ? Buffer.from(j.content, 'base64').toString('utf8') : null
  } catch { return null }
}
