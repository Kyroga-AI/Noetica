'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { models } from '@/config/models'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import { useMemory } from '@/lib/memory/useMemory'

export type AgentSlotId = 'context' | 'mail' | 'calendar' | 'tasks' | 'graph' | 'lattice' | 'feed' | 'risk'

const SLOTS: { id: AgentSlotId; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'context',
    label: 'Context',
    description: 'Active files, memory, and artifacts in scope for the current workspace.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2l5.5 3L8 8 2.5 5 8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <path d="M2.5 8L8 11l5.5-3M2.5 11L8 14l5.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'mail',
    label: 'Mail',
    description: 'Your mail agent monitors, triages, and drafts on your behalf.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2 5.5l6 4 6-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Your calendar agent manages scheduling, conflicts, and reminders.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Your queue agent fields updates, triages incoming requests, and flags based on your criteria.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M5.5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    id: 'graph',
    label: 'Graph',
    description: 'Semantic hypergraph of concepts across selected conversations. Click nodes to explore.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="3" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="13" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M8 6l-3.5 4.5M8 6l3.5 4.5M5 12h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'lattice',
    label: 'Profit Lattice',
    description: 'Revenue and margin lattice across agent workstreams. Tracks value generated per session.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 13l3-4 3 2 3-5 3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="13" cy="8" r="1.5" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'risk',
    label: 'Risk',
    description: 'Live risk aversion readout. Tracks steering pressure, caution deltas, and governance events.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2L2 13h12L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M8 6v3.5M8 11v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'feed',
    label: 'Feed',
    description: 'Enriched signal feed from Bluesky and connected sources. Agent-summarized and ranked.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="13" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    ),
  },
]

// Slots actually shown. The rest of SLOTS/MOCK_CONTENT were placeholder demos with
// hardcoded data; the right panel now shows only real, live context.
const ENABLED_SLOTS: AgentSlotId[] = ['context']

type ToolActivityItem = { id: string; name: string; target: string }
type FileChange = { id: string; path: string; content: string }

// Real Context panel: files referenced by this session's tool calls + the actual
// stored memories. No mock data.
function ContextSlot({ inScopeFiles, activity, changes }: { inScopeFiles: string[]; activity: ToolActivityItem[]; changes: FileChange[] }) {
  const { entries, hydrated } = useMemory()
  const recent = entries.slice(0, 6)
  const [openChange, setOpenChange] = useState<string | null>(null)
  return (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">
        In scope{inScopeFiles.length > 0 ? ` · ${inScopeFiles.length}` : ''}
      </div>
      {inScopeFiles.length === 0 ? (
        <SlotRow><span className="text-[var(--color-text-tertiary)]">No files referenced yet</span></SlotRow>
      ) : (
        inScopeFiles.map((f) => (
          <SlotRow key={f}><span className="text-[var(--color-text-secondary)] mr-1.5">—</span><span className="truncate">{f}</span></SlotRow>
        ))
      )}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">
        Activity{activity.length > 0 ? ` · ${activity.length}` : ''}
      </div>
      {activity.length === 0 ? (
        <SlotRow><span className="text-[var(--color-text-tertiary)]">No tool calls yet</span></SlotRow>
      ) : (
        activity.map((a, i) => (
          <SlotRow key={`${a.id}-${i}`}>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[10px] text-[var(--color-text-primary)] shrink-0">{a.name}</span>
              {a.target && <span className="truncate text-[var(--color-text-tertiary)]">{a.target}</span>}
            </span>
          </SlotRow>
        ))
      )}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">
        Changes{changes.length > 0 ? ` · ${changes.length}` : ''}
      </div>
      {changes.length === 0 ? (
        <SlotRow><span className="text-[var(--color-text-tertiary)]">No files written yet</span></SlotRow>
      ) : (
        changes.map((c) => (
          <div key={c.id}>
            <button
              onClick={() => setOpenChange(openChange === c.id ? null : c.id)}
              className="flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)]"
              title={c.path}
            >
              <span className="truncate font-mono text-[10px] text-[var(--color-text-primary)]">{c.path.split('/').pop()}</span>
              <span className="shrink-0 text-[10px] text-[#4ade80]">+{c.content ? c.content.split('\n').length : 0}</span>
            </button>
            {openChange === c.id && (
              <pre className="mt-0.5 max-h-44 overflow-auto rounded-md bg-[var(--color-background-primary)] p-2 text-[10px] leading-snug text-[var(--color-text-secondary)] whitespace-pre-wrap">{c.content || '(empty file)'}</pre>
            )}
          </div>
        ))
      )}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">
        Memory{hydrated ? ` · ${entries.length}` : ''}
      </div>
      {!hydrated ? (
        <SlotRow><span className="text-[var(--color-text-tertiary)]">Loading…</span></SlotRow>
      ) : entries.length === 0 ? (
        <SlotRow><span className="text-[var(--color-text-tertiary)]">No memories stored yet</span></SlotRow>
      ) : (
        recent.map((m) => (
          <SlotRow key={m.id}><span className="line-clamp-2 leading-snug">{m.text}</span></SlotRow>
        ))
      )}
    </div>
  )
}

function GraphMini() {
  const nodes = [
    { id: 'a', x: 80, y: 30, label: 'Voice', r: 14 },
    { id: 'b', x: 160, y: 55, label: 'Agents', r: 17 },
    { id: 'c', x: 50, y: 90, label: 'DPO', r: 11 },
    { id: 'd', x: 130, y: 110, label: 'Runtime', r: 13 },
    { id: 'e', x: 190, y: 110, label: 'Rust', r: 10 },
  ]
  const edges = [['a','b'],['b','d'],['b','e'],['a','c'],['c','d'],['d','e']]
  return (
    <svg viewBox="0 0 240 135" width="100%" style={{ display: 'block' }}>
      {edges.map(([s, t]) => {
        const sn = nodes.find(n => n.id === s)!
        const tn = nodes.find(n => n.id === t)!
        return <line key={s+t} x1={sn.x} y1={sn.y} x2={tn.x} y2={tn.y} stroke="var(--color-border-secondary)" strokeWidth="1"/>
      })}
      {nodes.map(n => (
        <g key={n.id} style={{ cursor: 'pointer' }}>
          <circle cx={n.x} cy={n.y} r={n.r} fill="var(--color-background-tertiary)" stroke="var(--color-text-tertiary)" strokeWidth="1"/>
          <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="var(--color-text-secondary)" fontFamily="sans-serif">{n.label}</text>
        </g>
      ))}
    </svg>
  )
}

function StatusDot({ level }: { level: 'ok' | 'warn' | 'alert' }) {
  const color = level === 'ok' ? 'bg-[var(--color-text-secondary)]' : level === 'warn' ? 'bg-[var(--color-text-secondary)]' : 'bg-[var(--color-text-primary)]'
  return <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${color}`} />
}

function SlotRow({ children, accent }: { children: React.ReactNode; accent?: 'warn' | 'alert' }) {
  const border = accent === 'alert' ? 'border-[var(--color-border-secondary)]' : accent === 'warn' ? 'border-[var(--color-border-secondary)]' : 'border-[var(--color-border-tertiary)]'
  return (
    <div className={`rounded border ${border} bg-[var(--color-background-primary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] leading-snug`}>
      {children}
    </div>
  )
}

const MOCK_CONTENT: Record<AgentSlotId, React.ReactNode | null> = {
  context: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">In scope</div>
      {['AppShell.tsx', 'RightSidebar.tsx', 'useVoice.ts'].map((f) => (
        <SlotRow key={f}><span className="text-[var(--color-text-secondary)] mr-1.5">—</span>{f}</SlotRow>
      ))}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Memory</div>
      <SlotRow>3 relevant memories active</SlotRow>
    </div>
  ),
  mail: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Status</div>
      <SlotRow><span className="flex items-center gap-1.5"><StatusDot level="ok" />Monitoring · 2m ago</span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Flagged</div>
      <SlotRow accent="warn"><span className="flex items-center gap-1.5"><StatusDot level="warn" />2 threads need attention</span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Drafts queued</div>
      <SlotRow>3 awaiting approval</SlotRow>
    </div>
  ),
  calendar: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Status</div>
      <SlotRow><span className="flex items-center gap-1.5"><StatusDot level="ok" />Active · monitoring conflicts</span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Today</div>
      {['10:00 — Standup', '14:00 — Design review', '16:30 — 1:1'].map((e) => (
        <SlotRow key={e}>{e}</SlotRow>
      ))}
    </div>
  ),
  tasks: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Status</div>
      <SlotRow><span className="flex items-center gap-1.5"><StatusDot level="ok" />Queue agent · 12 tracked</span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Flagged</div>
      <SlotRow accent="alert"><span className="flex items-center gap-1.5"><StatusDot level="alert" />PR review overdue #241</span></SlotRow>
      <SlotRow accent="warn"><span className="flex items-center gap-1.5"><StatusDot level="warn" />Rust build blocked</span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Done today</div>
      <SlotRow>UI shell redesign ✓</SlotRow>
      <SlotRow>Voice button ✓</SlotRow>
    </div>
  ),
  graph: (
    <div className="p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-2">Concept graph · this session</div>
      <GraphMini />
      <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-1">Top concepts</div>
      {['Agent runtime', 'Voice routing', 'DPO training', 'Rust build', 'Right sidebar'].map((c) => (
        <SlotRow key={c}>{c}</SlotRow>
      ))}
    </div>
  ),
  lattice: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Value generated</div>
      <SlotRow><span className="flex items-center justify-between w-full"><span>Agent tasks</span><span className="font-medium text-[var(--color-text-primary)]">$42.80</span></span></SlotRow>
      <SlotRow><span className="flex items-center justify-between w-full"><span>Reviews saved</span><span className="font-medium text-[var(--color-text-primary)]">$18.20</span></span></SlotRow>
      <SlotRow><span className="flex items-center justify-between w-full"><span>Supervision</span><span className="font-medium text-[var(--color-text-primary)]">$12.50</span></span></SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Session total</div>
      <SlotRow><span className="flex items-center justify-between w-full"><span className="font-medium text-[var(--color-text-primary)]">Today</span><span className="font-semibold text-[var(--color-text-primary)]">$73.50</span></span></SlotRow>
    </div>
  ),
  risk: null,
  feed: (
    <div className="space-y-1 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Top signals</div>
      <SlotRow>Anthropic releases Claude 4.8 Opus</SlotRow>
      <SlotRow>OpenAI cuts GPT-5 API pricing 40%</SlotRow>
      <SlotRow>EU AI Act enforcement begins Q3</SlotRow>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Bluesky · your network</div>
      <SlotRow>3 posts mention agent tooling</SlotRow>
      <SlotRow>1 thread tagged #noetica</SlotRow>
    </div>
  ),
}

function RiskSlot({ riskReadout }: { riskReadout?: RiskAversionLiveReadout | null }) {
  if (!riskReadout) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <div className="text-[10px] text-[var(--color-text-tertiary)]">Risk readout populates after the first exchange.</div>
      </div>
    )
  }
  const { dimensions, latestTurn } = riskReadout
  return (
    <div className="space-y-1.5 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pb-0.5">Dominant dimensions</div>
      {dimensions.map(({ label, value }) => (
        <div key={label} className="text-[11px] text-[var(--color-text-primary)]">
          <div className="flex justify-between mb-0.5">
            <span>{label}</span>
            <span className="font-medium">{value.toFixed(2)}</span>
          </div>
          <div className="h-1 w-full rounded-full bg-[var(--color-border-tertiary)]">
            <div className="h-1 rounded-full bg-[var(--color-text-secondary)]" style={{ width: `${value * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Caution delta</div>
      <div className="flex gap-2">
        <SlotRow>
          <span className="block text-[9px] text-[var(--color-text-tertiary)]">Directness</span>
          <span className="font-semibold text-[var(--color-text-primary)]">{latestTurn.directnessDelta.toFixed(2)}</span>
        </SlotRow>
        <SlotRow>
          <span className="block text-[9px] text-[var(--color-text-tertiary)]">Caution</span>
          <span className="font-semibold text-[var(--color-text-primary)]">{latestTurn.cautionDelta.toFixed(2)}</span>
        </SlotRow>
      </div>
      {latestTurn.steeringModes.length > 0 && latestTurn.steeringModes[0] !== 'direct_answer' && (
        <>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Observed steering</div>
          {latestTurn.steeringModes.map((mode) => (
            <SlotRow key={mode}>{mode.replace(/_/g, ' ')}</SlotRow>
          ))}
        </>
      )}
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] pt-2 pb-0.5">Turn</div>
      <SlotRow><span className="truncate block">{latestTurn.label}</span></SlotRow>
    </div>
  )
}

type RightSidebarProps = {
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
  riskReadout?: RiskAversionLiveReadout | null
  inScopeFiles?: string[]
  toolActivity?: ToolActivityItem[]
  fileChanges?: FileChange[]
}

function AgentSlotConfig({ slotId, onClose }: { slotId: AgentSlotId; onClose: () => void }) {
  const { settings, update } = useSettings()
  const current = settings.agentSlots[slotId] ?? ''

  return (
    <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Configure agent</span>
        <button onClick={onClose} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <select
        value={current}
        onChange={(e) => update({ agentSlots: { ...settings.agentSlots, [slotId]: e.target.value } })}
        className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
      >
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div className="mt-2 flex gap-1.5">
        <button className="flex-1 rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
          View history
        </button>
        <button className="flex-1 rounded-full border border-[#fca5a5] bg-[var(--color-background-primary)] px-2 py-1 text-[10px] font-medium text-[#dc2626] hover:bg-[#fef2f2]">
          Replace agent
        </button>
      </div>
    </div>
  )
}

export function RightSidebar({ collapsed, onCollapse, onExpand, riskReadout, inScopeFiles = [], toolActivity = [], fileChanges = [] }: RightSidebarProps) {
  const [activeSlot, setActiveSlot] = useState<AgentSlotId>('context')
  const [configuringSlot, setConfiguringSlot] = useState<AgentSlotId | null>(null)
  const { settings } = useSettings()

  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center border-l border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] py-3 lg:flex">
        <button
          onClick={onExpand}
          className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"
          aria-label="Expand right sidebar"
          title="Expand"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <nav className="flex flex-col items-center gap-1">
          {SLOTS.filter((s) => ENABLED_SLOTS.includes(s.id)).map((slot) => (
            <button
              key={slot.id}
              onClick={() => { setActiveSlot(slot.id); onExpand() }}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                activeSlot === slot.id ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
              }`}
              title={slot.label}
            >
              {slot.icon}
            </button>
          ))}
        </nav>
      </aside>
    )
  }

  const slot = SLOTS.find((s) => s.id === activeSlot)!
  const agentModel = models.find((m) => m.id === (settings.agentSlots[activeSlot] ?? ''))

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-l border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] lg:flex">
      {/* Slot tabs — scrollable row */}
      <div className="flex items-center border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)]">
        {ENABLED_SLOTS.length > 1 ? (
          <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none gap-px px-1 pt-1">
            {SLOTS.filter((s) => ENABLED_SLOTS.includes(s.id)).map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveSlot(s.id); setConfiguringSlot(null) }}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-t-md transition ${
                  activeSlot === s.id ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
                title={s.label}
              >
                {s.icon}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          onClick={onCollapse}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
          aria-label="Collapse right sidebar"
          title="Collapse"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Slot header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text-primary)]">{slot.label}</div>
          {agentModel && (
            <div className="text-[10px] text-[var(--color-text-tertiary)]">{agentModel.label}</div>
          )}
        </div>
        <button
          onClick={() => setConfiguringSlot(configuringSlot === activeSlot ? null : activeSlot)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-secondary)]"
          title="Configure agent slot"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.34 2.34l1.06 1.06M8.6 8.6l1.06 1.06M2.34 9.66l1.06-1.06M8.6 3.4l1.06-1.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Config panel */}
      {configuringSlot === activeSlot && (
        <AgentSlotConfig slotId={activeSlot} onClose={() => setConfiguringSlot(null)} />
      )}

      {/* Slot description */}
      <div className="px-3 pb-2">
        <p className="text-[10px] leading-4 text-[var(--color-text-tertiary)]">{slot.description}</p>
      </div>

      {/* Slot content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeSlot === 'context'
          ? <ContextSlot inScopeFiles={inScopeFiles} activity={toolActivity} changes={fileChanges} />
          : activeSlot === 'risk'
          ? <RiskSlot riskReadout={riskReadout} />
          : MOCK_CONTENT[activeSlot]}
      </div>
    </aside>
  )
}
