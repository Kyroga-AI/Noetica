'use client'

import { useState } from 'react'
import type { ForgeProvider } from '@/lib/types/forge'
import { FORGE_META } from '@/lib/types/forge'

type ForgeFilter = ForgeProvider | 'all'
type CodeView = 'overview' | 'gitea_detail' | 'github_detail'

const nativeForges: ForgeProvider[] = ['gitea_sovereign', 'local_git']
const externalForges: ForgeProvider[] = ['git_ssh', 'github', 'gitlab', 'forgejo', 'other']

function TrustBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    native:    'bg-[#dcfce7] text-[#16a34a]',
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
    <span className={`inline-block h-2 w-2 rounded-full ${ok === true ? 'bg-[#22c55e]' : ok === false ? 'bg-[#ef4444]' : 'bg-[#94a3b8]'}`} />
  )
}

// ─── Gitea Sovereign detail ───────────────────────────────────────────────────

function GiteaDetail({ onBack }: { onBack: () => void }) {
  const [repoSearch, setRepoSearch] = useState('')
  const statusRows: { label: string; ok: boolean | null; detail: string }[] = [
    { label: 'API reachable',      ok: null,  detail: 'Not configured' },
    { label: 'SSH reachable',      ok: null,  detail: 'Not configured' },
    { label: 'Webhook receiver',   ok: null,  detail: 'Not configured' },
    { label: 'Mirror queue',       ok: null,  detail: '—' },
    { label: 'Last graph sync',    ok: null,  detail: '—' },
    { label: 'Repository count',   ok: null,  detail: '0 indexed' },
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
              <button className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
                Configure endpoint
              </button>
              <button className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
                Test connection
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
            <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
              No repositories indexed. Configure Gitea endpoint to begin.
            </div>
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
              <button className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
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

function GitHubDetail({ onBack }: { onBack: () => void }) {
  const capabilities = [
    'Import repositories into workspace',
    'Register webhooks for push / PR / issue events',
    'Pull PR, issue, and Actions metadata',
    'Link GitHub repos to projects and workrooms',
    'Mirror selected repositories to Gitea Sovereign',
    'Sync read-only or bidirectional based on explicit grant',
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
              <span className="text-lg font-semibold text-[var(--color-text-primary)]">GitHub Connector</span>
              <TrustBadge tier="external" />
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">Optional external connector — not source of truth</div>
          </div>
        </div>

        {/* Authority notice */}
        <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-5 py-4">
          <div className="text-xs font-semibold text-[#92400e]">External connector</div>
          <p className="mt-1 text-xs text-[#78350f]">
            Noetica uses the native SourceOS / Gitea Sovereign source substrate by default. GitHub is an optional import and mirror connector. It does not own repository identity, source graph truth, or repository health authority.
          </p>
        </div>

        {/* Status */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Status</div>
            <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
              <StatusDot ok={null} />
              Not connected
            </span>
          </div>
          <div className="px-5 py-4">
            <button className="rounded-xl bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e293b]">
              Add GitHub as external source
            </button>
          </div>
        </div>

        {/* Capabilities */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Connector capabilities</div>
          </div>
          <ul className="divide-y divide-[#f1f5f9]">
            {capabilities.map((c) => (
              <li key={c} className="flex items-center gap-2.5 px-5 py-2.5 text-xs text-[var(--color-text-secondary)]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions (disabled until connected) */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] mb-3">Actions</div>
          <div className="flex flex-wrap gap-2">
            {['Import repositories', 'Configure hooks', 'Mirror to native forge', 'Disconnect'].map((a) => (
              <button key={a} disabled className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] cursor-not-allowed">
                {a}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">Connect GitHub to enable these actions.</p>
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
}: {
  filter: ForgeFilter
  setFilter: (f: ForgeFilter) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  onOpenGitea: () => void
  onOpenGitHub: () => void
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
                {isNative && <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shrink-0" />}
                {label}
              </button>
            )
          })}
        </div>
        <div className="p-3">
          <button className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bfdbfe] py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
            + Add source
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
            <ForgeCard provider="local_git" />
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
            <button className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add repository
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

export function CodeSurface() {
  const [view, setView] = useState<CodeView>('overview')
  const [filter, setFilter] = useState<ForgeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  if (view === 'gitea_detail') return <GiteaDetail onBack={() => setView('overview')} />
  if (view === 'github_detail') return <GitHubDetail onBack={() => setView('overview')} />

  return (
    <SourceOverview
      filter={filter}
      setFilter={setFilter}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      onOpenGitea={() => setView('gitea_detail')}
      onOpenGitHub={() => setView('github_detail')}
    />
  )
}
