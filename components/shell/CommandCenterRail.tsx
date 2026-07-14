'use client'

import { COMMAND_CENTERS, type CommandCenterId } from './commandCenters'

/**
 * TIER 1 of the two-tier cockpit — the domain switcher.
 *
 * A thin icon+label rail on the left edge. Picking a command center repaints the
 * Tier-2 <Sidebar> panel into that center's surfaces. This is the break from the
 * flat "Claude panel" model: the left panel is now a domain, not a page list.
 * (Mechanism borrowed from SocioProphet client-vue's DOMAIN axis.)
 */

function CenterIcon({ id }: { id: CommandCenterId }) {
  const common = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const
  switch (id) {
    case 'workspace':
      return (
        <svg {...common}><path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H7l-4 3V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      )
    case 'data':
      return (
        <svg {...common}><ellipse cx="10" cy="4.5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4 4.5v6c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-6M4 10.5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" stroke="currentColor" strokeWidth="1.5"/></svg>
      )
    case 'ai':
      return (
        <svg {...common}><rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 3v2M11.5 3v2M8.5 15v2M11.5 15v2M3 8.5h2M3 11.5h2M15 8.5h2M15 11.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      )
    case 'cloud':
      return (
        <svg {...common}><path d="M6 15a3.5 3.5 0 0 1-.5-6.96A4.5 4.5 0 0 1 14 7.2 3.4 3.4 0 0 1 14 15H6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      )
    case 'analytics':
      return (
        <svg {...common}><path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><rect x="4" y="10" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.5"/><rect x="8.5" y="6" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.5"/><rect x="13" y="3" width="3" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.5"/></svg>
      )
    case 'govern':
      return (
        <svg {...common}><path d="M10 2.5 3.5 5.5v4c0 3.6 2.8 6.4 6.5 7.5 3.7-1.1 6.5-3.9 6.5-7.5v-4L10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 9.8l2 2 4-4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )
  }
}

export function CommandCenterRail({
  activeCenter,
  onCenterChange,
}: {
  activeCenter: CommandCenterId
  onCenterChange: (id: CommandCenterId) => void
}) {
  return (
    <nav
      aria-label="Command centers"
      className="titlebar-inset hidden w-16 shrink-0 flex-col items-stretch gap-0.5 border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] px-1.5 py-2 lg:flex"
    >
      {COMMAND_CENTERS.map((c) => {
        const isActive = activeCenter === c.id
        return (
          <button
            key={c.id}
            onClick={() => onCenterChange(c.id)}
            title={c.blurb}
            aria-current={isActive ? 'page' : undefined}
            className={`group flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition ${
              isActive
                ? 'bg-[#dbeafe] text-[#1d4ed8]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <CenterIcon id={c.id} />
            <span className={`text-[8.5px] font-medium leading-tight tracking-tight ${isActive ? 'text-[#1d4ed8]' : ''}`}>
              {c.label.split(' · ')[0]}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
