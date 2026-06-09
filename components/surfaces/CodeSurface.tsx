'use client'

import { useState } from 'react'
import type { ForgeProvider } from '@/lib/types/forge'
import { FORGE_META } from '@/lib/types/forge'

type ForgeFilter = ForgeProvider | 'all'

const nativeForges: ForgeProvider[] = ['gitea_sovereign', 'local_git']
const externalForges: ForgeProvider[] = ['git_ssh', 'github', 'gitlab', 'forgejo', 'other']

function TrustBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    native:    'bg-[#dcfce7] text-[#16a34a]',
    trusted:   'bg-[#dbeafe] text-[#1d4ed8]',
    external:  'bg-[#f1f5f9] text-[#64748b]',
    untrusted: 'bg-[#fef2f2] text-[#dc2626]',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${styles[tier] ?? styles.external}`}>
      {tier}
    </span>
  )
}

function ForgeCard({ provider, isDefault }: { provider: ForgeProvider; isDefault?: boolean }) {
  const meta = FORGE_META[provider]
  return (
    <div className={`flex items-center justify-between rounded-xl border p-3 ${isDefault ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[#e2e8f0] bg-white'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#0f172a]">{meta.label}</span>
          {isDefault && <span className="rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[10px] font-semibold text-white">Default</span>}
          <TrustBadge tier={meta.trustTier} />
        </div>
        <div className="mt-0.5 text-xs text-[#64748b]">{meta.authority}</div>
      </div>
      <button className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1 text-xs font-medium text-[#334155] transition hover:bg-white">
        {provider === 'gitea_sovereign' || provider === 'local_git' ? 'Configure' : 'Connect'}
      </button>
    </div>
  )
}

export function CodeSurface() {
  const [filter, setFilter] = useState<ForgeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Source sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#d7dee8] bg-[#f8fafc]">
        <div className="border-b border-[#d7dee8] px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Source Control</div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repositories…"
            className="mt-2 w-full rounded-xl border border-[#bfdbfe] bg-white px-3 py-1.5 text-xs outline-none focus:border-[#1d4ed8]"
          />
        </div>

        {/* Provider filter */}
        <div className="border-b border-[#d7dee8] px-3 py-2 space-y-0.5">
          {(['all', ...nativeForges, ...externalForges] as ForgeFilter[]).map((p) => {
            const label = p === 'all' ? 'All sources' : FORGE_META[p].label
            const isNative = p !== 'all' && FORGE_META[p].trustTier === 'native'
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  filter === p ? 'bg-[#dbeafe] font-semibold text-[#0f172a]' : 'text-[#64748b] hover:bg-white hover:text-[#0f172a]'
                }`}
              >
                {isNative && <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shrink-0" />}
                {label}
              </button>
            )
          })}
        </div>

        {/* Add source */}
        <div className="p-3">
          <button className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bfdbfe] py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
            + Add source
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Native section */}
        <div className="border-b border-[#d7dee8] bg-white px-6 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Native sources</div>
          <p className="mt-0.5 text-xs text-[#64748b]">Gitea Sovereign and local Git are the default authority. Third-party forges are optional connectors.</p>
          <div className="mt-3 space-y-2">
            <ForgeCard provider="gitea_sovereign" isDefault />
            <ForgeCard provider="local_git" />
          </div>
        </div>

        {/* External connectors */}
        <div className="px-6 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#94a3b8]">Optional external connectors</div>
          <p className="mt-0.5 text-xs text-[#64748b]">Mirror, import, or hook into external forges. These are not source of truth.</p>
          <div className="mt-3 space-y-2">
            {externalForges.map((p) => <ForgeCard key={p} provider={p} />)}
          </div>
        </div>

        {/* Repository inventory */}
        <div className="border-t border-[#d7dee8] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Repository inventory</div>
            <button className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add repository
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#94a3b8]">
            No repositories indexed. Configure Gitea Sovereign or add a local Git path to begin.
          </div>
        </div>
      </div>
    </div>
  )
}
