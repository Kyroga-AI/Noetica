/**
 * repoRead.ts — browser/Tauri-safe read-only repo tool.
 *
 * Lets the model "check out" a GitHub or Gitea repository and read its files
 * without a local clone. This is the client-side sibling of
 * agent-machine/lib/repo-ingest.ts (fetchRepoTree/fetchRepoFile) — reimplemented
 * with browser-safe primitives (atob instead of Buffer) so it runs in the static
 * desktop bundle. GitHub's REST API sends permissive CORS headers, so these
 * fetches work directly from the Tauri client.
 *
 * ReAct usage pattern:
 *   turn 1 → read_repo { owner, repo }                    → returns the file tree
 *   turn 2 → read_repo { owner, repo, paths: [...] }      → returns those files' contents
 *
 * GitHub auth: in the desktop app we shell out to the user's local `gh` CLI
 * (same path Claude Code takes) so no in-app PAT is needed. In the browser we
 * fall back to a direct REST fetch, optionally with a configured PAT.
 */
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

export type ForgeKind = 'github' | 'gitea'

export interface RepoReadInput {
  owner: string
  repo: string
  branch?: string
  provider?: ForgeKind
  paths?: string[]
}

export interface RepoReadTokens {
  githubPat?: string
  giteaBase?: string
  giteaToken?: string
}

const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'rb', 'php', 'swift', 'm', 'sh', 'bash', 'zsh', 'sql', 'md', 'mdx', 'txt', 'rst', 'json', 'jsonc',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'html', 'css', 'scss', 'less', 'vue', 'svelte', 'astro',
  'graphql', 'proto', 'dockerfile', 'tf', 'lua', 'r', 'jl', 'ex', 'exs', 'clj', 'hs', 'ml',
])
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|\.next|coverage|__pycache__|\.venv|venv)(\/|$)/i
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|\.min\.(js|css)$|\.map$)/i

const MAX_TREE_ENTRIES = 400
const MAX_FILES_PER_CALL = 12
const MAX_FILE_BYTES = 256 * 1024

function isTextPath(path: string): boolean {
  if (SKIP_DIR.test(path) || SKIP_FILE.test(path)) return false
  const base = path.split('/').pop() ?? ''
  const lower = base.toLowerCase()
  // Common extensionless text files worth reading.
  if (['dockerfile', 'makefile', 'readme', 'license', 'notice', 'authors', 'changelog'].includes(lower)) return true
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return TEXT_EXT.has(ext)
}

// Browser-safe base64 → UTF-8. GitHub returns base64 with embedded newlines.
function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\n/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

const ghHeaders = (token?: string) => ({
  Accept: 'application/vnd.github+json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

type GhResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

// GitHub GET that prefers the local `gh` CLI (user's existing auth, no in-app
// PAT) in the desktop app, and falls back to a direct REST fetch in the browser.
async function githubGet<T>(endpoint: string, token?: string): Promise<GhResult<T>> {
  if (isTauri()) {
    try {
      const raw = await invokeTauri<string>('gh_api', { endpoint })
      if (raw == null) throw new Error('gh bridge unavailable')
      return { ok: true, data: JSON.parse(raw) as T }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, status: /404/.test(msg) ? 404 : 0, error: msg }
    }
  }
  const r = await fetch(`https://api.github.com/${endpoint}`, { headers: ghHeaders(token), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) return { ok: false, status: r.status, error: `github ${r.status}` }
  return { ok: true, data: (await r.json()) as T }
}
const giteaHeaders = (token?: string) => ({
  Accept: 'application/json',
  ...(token ? { Authorization: `token ${token}` } : {}),
})

// Resolve the repo's default branch when the caller didn't pin one, so we don't
// 404 on repos that use "master" (or anything else) instead of "main".
async function resolveDefaultBranch(input: RepoReadInput, tokens: RepoReadTokens): Promise<string> {
  if (input.branch) return input.branch
  const provider = input.provider ?? 'github'
  try {
    if (provider === 'github') {
      const res = await githubGet<{ default_branch?: string }>(`repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`, tokens.githubPat)
      if (res.ok) return res.data.default_branch || 'main'
    } else {
      const base = (tokens.giteaBase ?? '').replace(/\/$/, '')
      if (base) {
        const url = `${base}/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`
        const r = await fetch(url, { headers: giteaHeaders(tokens.giteaToken), signal: AbortSignal.timeout(15_000) })
        if (r.ok) return ((await r.json()) as { default_branch?: string }).default_branch || 'main'
      }
    }
  } catch { /* fall through to 'main' */ }
  return 'main'
}

async function fetchTree(input: RepoReadInput, tokens: RepoReadTokens): Promise<Array<{ path: string; size: number }>> {
  const branch = input.branch || 'main'
  const provider = input.provider ?? 'github'
  let tree: Array<{ path: string; type: string; size?: number }> = []
  if (provider === 'github') {
    const res = await githubGet<{ tree?: typeof tree }>(`repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, tokens.githubPat)
    if (!res.ok) {
      const hint = res.status === 404
        ? (isTauri() ? ' (repo not found — check the name, or run `gh auth login` for private repos)' : ' (repo not found or private — set a GitHub PAT in Settings → Connections)')
        : ''
      throw new Error(`github tree ${res.status || res.error}${hint}`)
    }
    tree = res.data.tree ?? []
  } else {
    const base = (tokens.giteaBase ?? '').replace(/\/$/, '')
    if (!base) throw new Error('gitea endpoint required — set it in Settings → Connections')
    const url = `${base}/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=true&per_page=99999`
    const r = await fetch(url, { headers: giteaHeaders(tokens.giteaToken), signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`gitea tree ${r.status}`)
    tree = ((await r.json()) as { tree?: typeof tree }).tree ?? []
  }
  return tree
    .filter((t) => t.type === 'blob' && isTextPath(t.path))
    .map((t) => ({ path: t.path, size: t.size ?? 0 }))
}

async function fetchFile(input: RepoReadInput, tokens: RepoReadTokens, path: string): Promise<string | null> {
  const branch = input.branch || 'main'
  const provider = input.provider ?? 'github'
  const encPath = path.split('/').map(encodeURIComponent).join('/')
  try {
    if (provider === 'github') {
      const res = await githubGet<{ content?: string; encoding?: string }>(`repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encPath}?ref=${encodeURIComponent(branch)}`, tokens.githubPat)
      if (!res.ok) return null
      return res.data.content && res.data.encoding === 'base64' ? decodeBase64Utf8(res.data.content) : null
    }
    const base = (tokens.giteaBase ?? '').replace(/\/$/, '')
    const url = `${base}/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encPath}?ref=${encodeURIComponent(branch)}`
    const r = await fetch(url, { headers: giteaHeaders(tokens.giteaToken), signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const j = (await r.json()) as { content?: string; encoding?: string }
    return j.content && j.encoding === 'base64' ? decodeBase64Utf8(j.content) : null
  } catch {
    return null
  }
}

/**
 * Execute a read_repo tool call. With no `paths`, returns the filtered file tree
 * so the model can pick what to read next. With `paths`, returns those files'
 * contents (capped for context safety).
 */
export async function readRepo(input: RepoReadInput, tokens: RepoReadTokens): Promise<string> {
  if (!input.owner || !input.repo) return 'Error: owner and repo are required.'
  // Pin the branch once (resolving the repo default when unspecified) so tree and
  // file reads in this call agree, and the ref label reflects what was actually read.
  const branch = await resolveDefaultBranch(input, tokens)
  input = { ...input, branch }
  const ref = `${input.provider ?? 'github'}:${input.owner}/${input.repo}@${branch}`

  if (input.paths?.length) {
    const wanted = input.paths.slice(0, MAX_FILES_PER_CALL)
    const files = await Promise.all(
      wanted.map(async (p) => ({ path: p, content: await fetchFile(input, tokens, p) }))
    )
    const blocks = files.map(({ path, content }) => {
      if (content === null) return `### ${path}\n(could not read — not found, binary, or unauthorized)`
      const clipped = content.length > MAX_FILE_BYTES
        ? content.slice(0, MAX_FILE_BYTES) + `\n… [truncated at ${MAX_FILE_BYTES} bytes]`
        : content
      return `### ${path}\n\`\`\`\n${clipped}\n\`\`\``
    })
    const omitted = (input.paths.length - wanted.length)
    const footer = omitted > 0 ? `\n\n(${omitted} more path(s) omitted — request them in a follow-up call, max ${MAX_FILES_PER_CALL} per call.)` : ''
    return `Files from ${ref}:\n\n${blocks.join('\n\n')}${footer}`
  }

  const tree = await fetchTree(input, tokens)
  if (tree.length === 0) return `Repository ${ref} has no readable text/code files (or the branch is empty).`
  const shown = tree.slice(0, MAX_TREE_ENTRIES)
  const listing = shown.map((t) => `- ${t.path} (${t.size} bytes)`).join('\n')
  const footer = tree.length > shown.length
    ? `\n\n(${tree.length - shown.length} more files not shown.)`
    : ''
  return `File tree for ${ref} (${tree.length} readable files):\n${listing}${footer}\n\nCall read_repo again with a "paths" array to read specific files.`
}
