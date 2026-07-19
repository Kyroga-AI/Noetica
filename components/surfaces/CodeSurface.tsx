'use client'

import { useEffect, useState } from 'react'
import type { ForgeProvider } from '@/lib/types/forge'
import { FORGE_META } from '@/lib/types/forge'
import { useConnectorAuth } from '@/lib/auth/context'
import { useSettings } from '@/lib/settings/context'
import { LocalGitImport } from '@/components/surfaces/LocalGitImport'

type ForgeFilter = ForgeProvider | 'all'
type CodeView = 'overview' | 'gitea_detail' | 'github_detail'

const nativeForges: ForgeProvider[] = ['gitea_sovereign', 'local_git']
const externalForges: ForgeProvider[] = ['git_ssh', 'github', 'gitlab', 'forgejo', 'other']

function TrustBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    native:    'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
    trusted:   'bg-[#dbeafe] text-[#1d4ed8]',
    external:  'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]',
    untrusted: 'bg-[#fef2f2] text-[#dc2626]',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${styles[tier] ?? styles.external}`}>
      {tier}
    </span>
  )
}

function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${ok === true ? 'bg-[var(--color-accent)]' : ok === false ? 'bg-[#ef4444]' : 'bg-[#94a3b8]'}`} />
  )
}

// ─── Gitea Sovereign detail ───────────────────────────────────────────────────

type GiteaRepo = {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  updated: string
  language: string | null
  stars_count: number
  open_issues_count: number
  default_branch: string
  html_url: string
}

function GiteaDetail({
  onBack,
  onOpenSettings,
  onNavigateToOperate,
}: {
  onBack: () => void
  onOpenSettings?: () => void
  onNavigateToOperate?: () => void
}) {
  const { settings } = useSettings()
  const [repoSearch, setRepoSearch] = useState('')
  const [apiReachable, setApiReachable] = useState<boolean | null>(null)
  const [apiLatency, setApiLatency] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [repos, setRepos] = useState<GiteaRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [reposError, setReposError] = useState('')

  async function fetchGiteaRepos(endpoint: string) {
    const base = endpoint.replace(/\/$/, '')
    const token = settings.giteaToken?.trim()
    const headers: Record<string, string> = token ? { Authorization: `token ${token}` } : {}
    const res = await fetch(`${base}/api/v1/repos/search?limit=50&sort=updated`, { headers, signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`Gitea API ${res.status}${res.status === 401 ? ' — add a token in Settings → Connections' : ''}`)
    const data = (await res.json()) as { data: GiteaRepo[] }
    return data.data ?? []
  }

  async function checkGiteaApi() {
    const endpoint = settings.giteaEndpoint.trim()
    if (!endpoint) return
    setChecking(true)
    const started = Date.now()
    try {
      const base = endpoint.replace(/\/$/, '')
      const res = await fetch(`${base}/api/v1/version`, { signal: AbortSignal.timeout(4000) })
      setApiReachable(res.ok)
      setApiLatency(Date.now() - started)
      if (res.ok) {
        setReposLoading(true)
        setReposError('')
        fetchGiteaRepos(endpoint)
          .then((r) => { setRepos(r); setReposError('') })
          .catch((e: unknown) => setReposError(e instanceof Error ? e.message : 'Failed to load repos'))
          .finally(() => setReposLoading(false))
      }
    } catch {
      setApiReachable(false)
      setApiLatency(Date.now() - started)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { void checkGiteaApi() }, [settings.giteaEndpoint, settings.giteaToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Suck a sovereign Gitea repo into the knowledge base (the backend supports gitea symmetrically with github).
  const [ingestState, setIngestState] = useState<Record<number, string>>({})
  async function ingestGitea(repo: GiteaRepo) {
    const [owner, name] = repo.full_name.split('/')
    setIngestState((s) => ({ ...s, [repo.id]: 'reading…' }))
    try {
      const amBase = (typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__) ? 'http://127.0.0.1:8080' : ''
      const res = await fetch(`${amBase}/api/repo/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'gitea', owner, repo: name, branch: repo.default_branch, token: settings.giteaToken, giteaBase: settings.giteaEndpoint }) })
      if (!res.ok || !res.body) throw new Error('ingest failed')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try { const ev = JSON.parse(line.slice(5)) as { total?: number; done?: number; ingested?: number; chunks?: number; error?: string }
            if (ev.error) setIngestState((s) => ({ ...s, [repo.id]: `error: ${ev.error}` }))
            else if (ev.ingested != null) setIngestState((s) => ({ ...s, [repo.id]: `✓ ${ev.ingested} files → KB` }))
            else if (ev.done != null) setIngestState((s) => ({ ...s, [repo.id]: `${ev.done}/${ev.total}…` }))
          } catch { /* skip */ }
        }
      }
    } catch { setIngestState((s) => ({ ...s, [repo.id]: 'ingest failed' })) }
  }

  const configured = Boolean(settings.giteaEndpoint.trim())
  const filteredRepos = repos.filter((r) =>
    !repoSearch || r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) || (r.description ?? '').toLowerCase().includes(repoSearch.toLowerCase())
  )
  const statusRows: { label: string; ok: boolean | null; detail: string }[] = [
    { label: 'API reachable', ok: configured ? apiReachable : null, detail: !configured ? 'Not configured' : checking ? 'Checking…' : apiReachable === true ? `OK · ${apiLatency}ms` : apiReachable === false ? 'Unreachable' : 'Unknown' },
    { label: 'SSH reachable',      ok: null,  detail: 'Not configured' },
    { label: 'Webhook receiver',   ok: null,  detail: 'Not configured' },
    { label: 'Mirror queue',       ok: null,  detail: '—' },
    { label: 'Last graph sync',    ok: null,  detail: '—' },
    { label: 'Repository count',   ok: repos.length > 0 ? true : null,  detail: repos.length > 0 ? `${repos.length} indexed` : '0 indexed' },
    { label: 'Failed syncs',       ok: null,  detail: '0' },
  ]
  const hookTypes = ['push', 'pull_request', 'issue', 'release', 'workflow / status']
  const graphRows: { label: string; value: string }[] = [
    { label: 'Graph ingestion',  value: 'disabled' },
    { label: 'Last indexed',     value: '—' },
    { label: 'Pending nodes',    value: '—' },
    { label: 'Failed edges',     value: '—' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
            title="Back"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-[var(--color-text-primary)]">Gitea Sovereign</span>
              <span className="rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[10px] font-semibold text-white">Default forge</span>
              <TrustBadge tier="native" />
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">Native authority — first-class source-control substrate</div>
          </div>
        </div>

        {/* Status */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Status</div>
          </div>
          <div className="divide-y divide-[#f1f5f9]">
            {statusRows.map(({ label, ok, detail }) => (
              <div key={label} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot ok={ok} />
                  <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
                </div>
                <span className="text-xs text-[var(--color-text-tertiary)]">{detail}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--color-border-secondary)] px-5 py-3">
            <div className="flex gap-2">
              <button
                onClick={() => onOpenSettings?.()}
                className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]"
              >
                Configure endpoint
              </button>
              <button
                onClick={() => void checkGiteaApi()}
                disabled={checking || !configured}
                className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)] disabled:opacity-50"
              >
                {checking ? 'Checking…' : 'Test connection'}
              </button>
            </div>
          </div>
        </div>

        {/* Repositories */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Repositories</div>
            <button className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add repository
            </button>
          </div>
          <div className="px-5 py-3">
            <input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search repositories…"
              className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-xs outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
            />
          </div>
          <div className="px-5 pb-5">
            {!configured ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-6 text-center">
                <div className="text-xs text-[var(--color-text-tertiary)]">No Gitea endpoint configured.</div>
                <div className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">Set your Gitea URL in <strong>Settings → Connections</strong> to enable repository indexing.</div>
              </div>
            ) : reposLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--color-background-secondary)]" />)}
              </div>
            ) : reposError ? (
              <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-xs text-[#dc2626]">{reposError}</div>
            ) : filteredRepos.length === 0 && repos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
                No repositories found at <code>{settings.giteaEndpoint}</code>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">No repos match your search.</div>
            ) : (
              <ul className="max-h-[340px] divide-y divide-[var(--color-border-secondary)] overflow-y-auto rounded-xl border border-[var(--color-border-secondary)]">
                {filteredRepos.map((repo) => (
                  <li key={repo.id} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-background-secondary)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">{repo.full_name}</span>
                        {repo.private && <span className="rounded-full border border-[var(--color-border-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-tertiary)]">private</span>}
                        {repo.language && <span className="text-[10px] text-[var(--color-text-tertiary)]">{repo.language}</span>}
                      </div>
                      {repo.description && <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">{repo.description}</div>}
                    </div>
                    {repo.stars_count > 0 && <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">★ {repo.stars_count}</span>}
                    {ingestState[repo.id] && <span className="shrink-0 max-w-[110px] truncate text-[9px] text-[var(--color-text-tertiary)]" title={ingestState[repo.id]}>{ingestState[repo.id]}</span>}
                    <button onClick={() => void ingestGitea(repo)} title="Suck this repo into the knowledge base as source-of-truth"
                      className="shrink-0 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-[10px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">⊕ Ingest to KB</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Hooks */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Webhook events</div>
          </div>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {hookTypes.map((h) => (
              <div key={h} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5">
                <StatusDot ok={null} />
                <span className="text-xs text-[var(--color-text-secondary)]">{h}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--color-border-secondary)] px-5 py-3">
            <button className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
              Configure webhook receiver
            </button>
          </div>
        </div>

        {/* Graph ingestion */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Graph ingestion</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Repositories are indexed into the Sociosphere graph for entity resolution and reasoning.</div>
          </div>
          <div className="divide-y divide-[#f1f5f9]">
            {graphRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">{value}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--color-border-secondary)] px-5 py-3">
            <div className="flex gap-2">
              <button className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
                Enable ingestion
              </button>
              <button
                onClick={() => onNavigateToOperate?.()}
                className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
              >
                View graph nodes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GitHub connector detail ──────────────────────────────────────────────────

type GithubRepo = {
  id: number
  name: string
  full_name: string
  description: string | null
  stargazers_count: number
  language: string | null
  updated_at: string
  private: boolean
  html_url: string
  clone_url: string
  open_issues_count: number
  default_branch: string
}

async function fetchGithubRepos(token: string): Promise<GithubRepo[]> {
  const res = await fetch(
    'https://api.github.com/user/repos?sort=updated&per_page=30&type=all',
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return res.json() as Promise<GithubRepo[]>
}

function fmtRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function GitHubDetail({ onBack }: { onBack: () => void }) {
  const { store, clearAuth } = useConnectorAuth()
  const { settings } = useSettings()
  const github = store.github
  const isConnected = github?.status === 'connected' && !!github.accessToken
  const [actionStatus, setActionStatus] = useState<Record<string, 'idle' | 'running' | 'done' | 'error'>>({})

  function setRepoAction(repoId: number, key: string, status: 'idle' | 'running' | 'done' | 'error') {
    setActionStatus((prev) => ({ ...prev, [`${repoId}:${key}`]: status }))
  }

  async function handleImport(repo: GithubRepo) {
    setRepoAction(repo.id, 'import', 'running')
    const endpoint = settings.giteaEndpoint.trim()
    if (!endpoint) {
      // No Gitea configured — flag the button (non-blocking) instead of an alert() popup.
      setRepoAction(repo.id, 'import', 'error')
      setTimeout(() => setRepoAction(repo.id, 'import', 'idle'), 3000)
      return
    }
    try {
      const base = endpoint.replace(/\/$/, '')
      const token = github?.accessToken ?? settings.githubPat
      const res = await fetch(`${base}/api/v1/repos/migrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clone_addr: repo.clone_url, repo_name: repo.name, private: repo.private, mirror: false, auth_token: token }),
      })
      setRepoAction(repo.id, 'import', res.ok ? 'done' : 'error')
    } catch {
      setRepoAction(repo.id, 'import', 'error')
    }
    setTimeout(() => setRepoAction(repo.id, 'import', 'idle'), 3000)
  }

  async function handleMirror(repo: GithubRepo) {
    setRepoAction(repo.id, 'mirror', 'running')
    const endpoint = settings.giteaEndpoint.trim()
    if (!endpoint) {
      setRepoAction(repo.id, 'mirror', 'error')
      setTimeout(() => setRepoAction(repo.id, 'mirror', 'idle'), 3000)
      return
    }
    try {
      const base = endpoint.replace(/\/$/, '')
      const token = github?.accessToken ?? settings.githubPat
      const res = await fetch(`${base}/api/v1/repos/migrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clone_addr: repo.clone_url, repo_name: repo.name, private: repo.private, mirror: true, mirror_interval: '8h0m0s', auth_token: token }),
      })
      setRepoAction(repo.id, 'mirror', res.ok ? 'done' : 'error')
    } catch {
      setRepoAction(repo.id, 'mirror', 'error')
    }
    setTimeout(() => setRepoAction(repo.id, 'mirror', 'idle'), 3000)
  }

  // Suck the repo into the knowledge base as source-of-truth: fetch its files via the GitHub API and ingest
  // each into RAG + the HellGraph (Repo→File→Document). Streams progress over SSE.
  const [ingestMsg, setIngestMsg] = useState<Record<number, string>>({})
  async function ingestRepo(repo: GithubRepo) {
    setRepoAction(repo.id, 'ingest', 'running')
    setIngestMsg((m) => ({ ...m, [repo.id]: 'reading tree…' }))
    try {
      const [owner, name] = repo.full_name.split('/')
      const amBase = (typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__) ? 'http://127.0.0.1:8080' : ''
      const res = await fetch(`${amBase}/api/repo/ingest`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github', owner, repo: name, branch: repo.default_branch, token: github?.accessToken ?? settings.githubPat }),
      })
      if (!res.ok || !res.body) throw new Error('ingest failed')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const ev = JSON.parse(line.slice(5)) as { total?: number; done?: number; chunks?: number; ingested?: number; error?: string }
            if (ev.error) { setIngestMsg((m) => ({ ...m, [repo.id]: `error: ${ev.error}` })); setRepoAction(repo.id, 'ingest', 'error') }
            else if (ev.ingested != null) setIngestMsg((m) => ({ ...m, [repo.id]: `✓ ${ev.ingested} files, ${ev.chunks} chunks → KB` }))
            else if (ev.done != null) setIngestMsg((m) => ({ ...m, [repo.id]: `${ev.done}/${ev.total} files…` }))
            else if (ev.total != null) setIngestMsg((m) => ({ ...m, [repo.id]: `${ev.total} files to ingest…` }))
          } catch { /* skip */ }
        }
      }
      setRepoAction(repo.id, 'ingest', 'done')
    } catch {
      setRepoAction(repo.id, 'ingest', 'error'); setIngestMsg((m) => ({ ...m, [repo.id]: 'ingest failed' }))
    }
  }


  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [repoSearch, setRepoSearch] = useState('')

  useEffect(() => {
    if (!isConnected || !github?.accessToken) { setRepos([]); return }
    setLoading(true)
    fetchGithubRepos(github.accessToken)
      .then((r) => { setRepos(r); setError('') })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [isConnected, github?.accessToken])

  const filtered = repos.filter((r) =>
    !repoSearch || r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) || (r.description ?? '').toLowerCase().includes(repoSearch.toLowerCase())
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
            title="Back"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-[var(--color-text-primary)]">GitHub Connector</span>
              <TrustBadge tier="external" />
              {isConnected && <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">Connected</span>}
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {isConnected && github?.userInfo?.login
                ? `Signed in as ${github.userInfo.login} · ${repos.length} repos`
                : 'Optional external connector — not source of truth'}
            </div>
          </div>
        </div>

        {/* Authority notice */}
        <div className="rounded-2xl border border-[#fde68a] bg-[var(--color-attention-bg)] px-5 py-4">
          <div className="text-xs font-semibold text-[var(--color-attention)]">External connector</div>
          <p className="mt-1 text-xs text-[#78350f]">
            GitHub is an optional import and mirror connector. It does not own repository identity or source graph truth — those belong to the native Gitea Sovereign substrate.
          </p>
        </div>

        {/* Connection status / connect prompt */}
        {!isConnected ? (
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Status</div>
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                <StatusDot ok={null} />
                Not connected
              </span>
            </div>
            <div className="px-5 py-4 text-xs text-[var(--color-text-secondary)]">
              Go to <strong>Settings → Connections</strong> to connect your GitHub account.
            </div>
          </div>
        ) : (
          /* Repo list */
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-5 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] shrink-0">Repositories</div>
              <input
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Filter repos…"
                className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-xs outline-none focus:border-[#bfdbfe]"
              />
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                {[1,2,3,4].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-[var(--color-background-secondary)]" />)}
              </div>
            ) : error ? (
              <div className="px-5 py-3 text-xs text-[#dc2626]">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-[var(--color-text-tertiary)]">No repos match.</div>
            ) : (
              <ul className="divide-y divide-[var(--color-border-secondary)] max-h-[420px] overflow-y-auto">
                {filtered.map((repo) => (
                  <li key={repo.id} className="flex items-start gap-3 px-5 py-3 transition hover:bg-[var(--color-background-secondary)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">{repo.full_name}</span>
                        {repo.private && <span className="rounded-full border border-[var(--color-border-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-tertiary)]">private</span>}
                        {repo.language && <span className="text-[10px] text-[var(--color-text-tertiary)]">{repo.language}</span>}
                      </div>
                      {repo.description && (
                        <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">{repo.description}</div>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                        <span>Updated {fmtRelative(repo.updated_at)}</span>
                        {repo.stargazers_count > 0 && <span>★ {repo.stargazers_count}</span>}
                        {repo.open_issues_count > 0 && <span>{repo.open_issues_count} issues</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {ingestMsg[repo.id] && <span className="text-[9px] text-[var(--color-text-tertiary)] max-w-[120px] truncate" title={ingestMsg[repo.id]}>{ingestMsg[repo.id]}</span>}
                      <button
                        onClick={() => void ingestRepo(repo)}
                        disabled={actionStatus[`${repo.id}:ingest`] === 'running'}
                        title="Pull this repo's files into the knowledge base as source-of-truth"
                        className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${actionStatus[`${repo.id}:ingest`] === 'done' ? 'border-[#bbf7d0] bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : actionStatus[`${repo.id}:ingest`] === 'error' ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]' : 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe]'}`}
                      >
                        {actionStatus[`${repo.id}:ingest`] === 'running' ? 'Ingesting…' : actionStatus[`${repo.id}:ingest`] === 'done' ? 'In KB ✓' : actionStatus[`${repo.id}:ingest`] === 'error' ? 'Failed' : '⊕ Ingest to KB'}
                      </button>
                      <button
                        onClick={() => void handleImport(repo)}
                        disabled={actionStatus[`${repo.id}:import`] === 'running'}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition ${actionStatus[`${repo.id}:import`] === 'done' ? 'border-[#bbf7d0] bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : actionStatus[`${repo.id}:import`] === 'error' ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:border-[#bfdbfe] hover:text-[#1d4ed8]'}`}
                      >
                        {actionStatus[`${repo.id}:import`] === 'running' ? '…' : actionStatus[`${repo.id}:import`] === 'done' ? 'Imported' : actionStatus[`${repo.id}:import`] === 'error' ? 'Failed' : 'Import'}
                      </button>
                      <button
                        onClick={() => void handleMirror(repo)}
                        disabled={actionStatus[`${repo.id}:mirror`] === 'running'}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition ${actionStatus[`${repo.id}:mirror`] === 'done' ? 'border-[#bbf7d0] bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : actionStatus[`${repo.id}:mirror`] === 'error' ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:border-[#bfdbfe] hover:text-[#1d4ed8]'}`}
                      >
                        {actionStatus[`${repo.id}:mirror`] === 'running' ? '…' : actionStatus[`${repo.id}:mirror`] === 'done' ? 'Mirroring' : actionStatus[`${repo.id}:mirror`] === 'error' ? 'Failed' : 'Mirror'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] mb-3">Actions</div>
          <div className="flex flex-wrap gap-2">
            {(['Configure hooks', 'Mirror to native forge'] as const).map((a) => (
              <button key={a} disabled={!isConnected} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40">
                {a}
              </button>
            ))}
            {isConnected && (
              <button onClick={() => clearAuth('github')} className="rounded-xl border border-[#fecaca] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[#dc2626] transition hover:bg-[#fef2f2]">
                Disconnect
              </button>
            )}
          </div>
          {!isConnected && <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">Connect GitHub in Settings → Connections to enable these actions.</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function ForgeCard({
  provider,
  isDefault,
  onOpen,
}: {
  provider: ForgeProvider
  isDefault?: boolean
  onOpen?: () => void
}) {
  const meta = FORGE_META[provider]
  return (
    <div className={`flex items-center justify-between rounded-xl border p-3.5 ${isDefault ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{meta.label}</span>
          {isDefault && <span className="rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[10px] font-semibold text-white">Default</span>}
          <TrustBadge tier={meta.trustTier} />
        </div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{meta.authority}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        {onOpen && (
          <button onClick={onOpen} className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
            Open
          </button>
        )}
        <button className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)]">
          {meta.trustTier === 'native' ? 'Configure' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

function SourceOverview({
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  onOpenGitea,
  onOpenGitHub,
  onAddLocal,
}: {
  filter: ForgeFilter
  setFilter: (f: ForgeFilter) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  onOpenGitea: () => void
  onOpenGitHub: () => void
  onAddLocal: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
        <div className="border-b border-[var(--color-border-secondary)] px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Source Control</div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repositories…"
            className="mt-2 w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs outline-none focus:border-[#1d4ed8]"
          />
        </div>
        <div className="border-b border-[var(--color-border-secondary)] px-3 py-2 space-y-0.5">
          {(['all', ...nativeForges, ...externalForges] as ForgeFilter[]).map((p) => {
            const label = p === 'all' ? 'All sources' : FORGE_META[p].label
            const isNative = p !== 'all' && FORGE_META[p].trustTier === 'native'
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  filter === p ? 'bg-[#dbeafe] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {isNative && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] shrink-0" />}
                {label}
              </button>
            )
          })}
        </div>
        <div className="p-3">
          <button onClick={onAddLocal} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bfdbfe] py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
            + Add local repo
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-6 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Native sources</div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Gitea Sovereign and local Git are the default authority. Third-party forges are optional connectors.</p>
          <div className="mt-3 space-y-2">
            <ForgeCard provider="gitea_sovereign" isDefault onOpen={onOpenGitea} />
            <ForgeCard provider="local_git" onOpen={onAddLocal} />
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">Optional external connectors</div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Mirror, import, or hook into external forges. These are not source of truth.</p>
          <div className="mt-3 space-y-2">
            <ForgeCard provider="github" onOpen={onOpenGitHub} />
            {(['gitlab', 'forgejo', 'git_ssh', 'other'] as ForgeProvider[]).map((p) => (
              <ForgeCard key={p} provider={p} />
            ))}
          </div>
        </div>

        <div className="border-t border-[var(--color-border-secondary)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Repository inventory</div>
            <button onClick={onAddLocal} className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add local repo
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
            No repositories indexed. Configure Gitea Sovereign or add a local Git path to begin.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function CodeSurface({
  onOpenSettings,
  onNavigateToOperate,
}: {
  onOpenSettings?: () => void
  onNavigateToOperate?: () => void
}) {
  const [view, setView] = useState<CodeView>('overview')
  const [filter, setFilter] = useState<ForgeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showLocalImport, setShowLocalImport] = useState(false)

  if (view === 'gitea_detail') return <GiteaDetail onBack={() => setView('overview')} onOpenSettings={onOpenSettings} onNavigateToOperate={onNavigateToOperate} />
  if (view === 'github_detail') return <GitHubDetail onBack={() => setView('overview')} />

  return (
    <>
      <SourceOverview
        filter={filter}
        setFilter={setFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenGitea={() => setView('gitea_detail')}
        onOpenGitHub={() => setView('github_detail')}
        onAddLocal={() => setShowLocalImport(true)}
      />
      {showLocalImport && <LocalGitImport onClose={() => setShowLocalImport(false)} />}
    </>
  )
}
