'use client'

// A living feature guide — the map of what Noetica can do today, updated as new
// capabilities roll out. Grouped by area; the "Recently shipped" block up top is the
// changelog users skim to keep up.

type Feature = { name: string; desc: string; isNew?: boolean }
type Group = { title: string; features: Feature[] }

const RECENT: { date: string; items: string[] } = {
  date: '2026-07-18',
  items: [
    'Attach multiple files to a project at once — all of them save (not just one).',
    'Attach a whole folder to a project in one go.',
    'Switch the active project from the chat’s Knowledge-scope picker — every project is listed.',
    'Responses can be shown all at once instead of streaming (Appearance → Responses).',
    'Stop a response mid-generation with the ■ button while it’s writing.',
  ],
}

const GROUPS: Group[] = [
  {
    title: 'Chat',
    features: [
      { name: 'Grounded answers with a reasoning trace', desc: 'Every answer streams intent, plan, grounding and retrieval steps, with a verification badge on completion.' },
      { name: 'Knowledge scope', desc: 'Scope a conversation to this chat, a specific project’s knowledge base, or everything — switchable inline.', isNew: true },
      { name: 'Stream or all-at-once', desc: 'Watch the answer as it’s written, or hold it and reveal the whole thing at once.', isNew: true },
      { name: 'Stop generation', desc: 'Cancel a response mid-stream with the ■ button.' },
      { name: 'Agent modes', desc: 'Auto, Plan, and Ask — choose how much autonomy the agent takes on a turn.' },
      { name: 'Fan-out', desc: 'Send one prompt to several models and compare, then recombine the best answer.' },
    ],
  },
  {
    title: 'Projects & knowledge',
    features: [
      { name: 'Project files as context', desc: 'Files attached to a project are injected into every conversation in it.' },
      { name: 'Multi-file & folder upload', desc: 'Add many files — or a whole folder — in one action.', isNew: true },
      { name: 'System prompt per project', desc: 'Give each project its own standing instructions.' },
      { name: 'Attachments in chat', desc: 'Drop files straight into a conversation for one-off context.' },
    ],
  },
  {
    title: 'Models & runtime',
    features: [
      { name: 'Model picker', desc: 'Choose per-conversation; show all models or just the ones you have keys for.' },
      { name: 'Prophet Cloud Mesh', desc: 'Opt in to route inference to the sovereign vLLM mesh instead of local models.' },
      { name: 'Thinking budget', desc: 'Tune how much deliberation the model spends before answering.' },
    ],
  },
  {
    title: 'Connect & extend',
    features: [
      { name: 'MCP connectors', desc: 'Bring external tools in over the Model Context Protocol.' },
      { name: 'Voice', desc: 'Speak to Noetica and have answers read back.' },
      { name: 'Memory', desc: 'Durable, salience-weighted memory across conversations.' },
    ],
  },
  {
    title: 'Governance',
    features: [
      { name: 'Policy controls', desc: 'Set the guardrails the agent operates within.' },
      { name: 'Verification & receipts', desc: 'Answers carry a verification badge and a reasoning receipt you can inspect.' },
    ],
  },
]

function NewTag() {
  return (
    <span className="ml-2 rounded-full bg-[rgba(29,78,216,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8] align-middle">
      NEW
    </span>
  )
}

export function GuidePanel() {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Feature guide</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">What Noetica can do today. Updated as new features ship.</p>
      </div>

      {/* Recently shipped */}
      <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">Recently shipped</span>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{RECENT.date}</span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {RECENT.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              <span className="text-[#1d4ed8]">＋</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Feature groups */}
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)]">{g.title}</h3>
          <div className="mt-2 space-y-3">
            {g.features.map((f) => (
              <div key={f.name}>
                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                  {f.name}{f.isNew && <NewTag />}
                </div>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-secondary)]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
