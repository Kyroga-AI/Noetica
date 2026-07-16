'use client'

import AutonomyPanel from '@/components/governance/AutonomyPanel'
import { EvidenceRailPanel } from '@/components/rail/panels/EvidenceRailPanel'
import { SourceOSRailPanel } from '@/components/rail/panels/SourceOSRailPanel'
import type { GovernanceTrace } from '@/lib/types/governance'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pt-4 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--ink3)' }}>{children}</div>
}

// Slide-in drawer (340px), opened via the right icon strip's shield button. Anchored to the outer
// app-body flex container (a sibling of Sidebar/section/RightIconStrip in AppShell.tsx, NOT nested
// inside the scrollable center column) so it always docks fully off-screen when closed regardless of
// whether the Knowledge panel is open or collapsed — see the prototype's explicit warning about this.
export function GovernanceDrawer({
  open,
  onClose,
  mode,
  lastGovernance,
}: {
  open: boolean
  onClose: () => void
  mode: 'standalone' | 'sourceos'
  lastGovernance?: GovernanceTrace
}) {
  const isSourceos = mode === 'sourceos'

  return (
    <div
      className="absolute right-0 top-0 z-40 flex h-full w-[340px] flex-col overflow-y-auto border-l"
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--line)',
        boxShadow: '-12px 0 30px rgba(20,20,20,0.1)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
      }}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b px-4 py-3.5" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[16px] font-extrabold" style={{ color: 'var(--ink)' }}>Trust &amp; governance</span>
        <button onClick={onClose} aria-label="Close" className="flex h-6 w-6 items-center justify-center rounded-md transition hover:opacity-70">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden style={{ color: 'var(--ink2)' }}>
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Connection */}
      <SectionLabel>Connection</SectionLabel>
      <p className="px-4 pt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--ink2)' }}>
        {isSourceos
          ? 'SourceOS — requests are submitted for model routing, policy admission, and a signed evidence trail.'
          : 'Standalone — calling providers directly with your local keys. SourceOS routing, memory, and policy are unavailable in this mode.'}
      </p>

      {/* Model steering — reuse the real steering-tier + autonomy ladder semantics, don't re-derive
          them here (AGENTS.md: never conflate steering tiers with a boolean). */}
      <SectionLabel>Model steering</SectionLabel>
      <div className="px-3 pt-1.5">
        <AutonomyPanel />
      </div>

      {/* Memory */}
      <SectionLabel>Memory</SectionLabel>
      <div className="mx-4 mt-1.5 flex items-center justify-between rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>
          {lastGovernance?.memory_written
            ? `Written to scope: ${lastGovernance.memory_scope ?? 'unknown'}`
            : 'Recall & write-back are stubbed in this build — not yet submitted.'}
        </span>
        {!lastGovernance?.memory_written && (
          <span className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--pending-soft)', color: 'var(--pending-fg)', border: '1px solid var(--pending-line)' }}>
            Not live
          </span>
        )}
      </div>

      {/* Policy admission */}
      <SectionLabel>Policy admission</SectionLabel>
      <div className="mx-4 mt-1.5 flex items-center justify-between rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>
          {isSourceos ? 'Requests are checked against policy before they run.' : 'No policy engine is attached in standalone mode.'}
        </span>
        <span
          className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={isSourceos
            ? { background: 'var(--verified-soft)', color: 'var(--verified-fg)', border: '1px solid var(--verified-line)' }
            : { background: 'var(--paper-sunk-2)', color: 'var(--ink3)', border: '1px solid var(--line)' }}
        >
          {isSourceos ? 'Admitted' : 'Unavailable'}
        </span>
      </div>

      {/* Evidence trail — reuse EvidenceRailPanel's real data source */}
      <SectionLabel>Evidence trail</SectionLabel>
      <div className="mt-1">
        <EvidenceRailPanel governance={lastGovernance} />
      </div>

      {/* SourceOS status — reuse SourceOSRailPanel's live polling */}
      <SectionLabel>SourceOS status</SectionLabel>
      <div className="mt-1 pb-4">
        <SourceOSRailPanel />
      </div>
    </div>
  )
}
