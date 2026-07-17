'use client'

import { useEffect, useState } from 'react'

/**
 * AgentBuilderSurface — the no-code agent builder. Define a custom sub-agent (label, system prompt, allowed
 * tools, turn budget, model tier); it persists encrypted via /api/agents and becomes dispatchable exactly like
 * the built-in roles (dispatch_agent resolves custom agents first). Lists built-ins read-only for reference.
 */
type Agent = {
  id: string; label: string; description: string; systemPrompt?: string
  tools: string[]; maxTurns: number; model?: 'coder' | 'general'; builtin?: boolean; custom?: boolean
}
type AgentsResp = { builtin: Agent[]; custom: Agent[] }

// The built-in tool names a custom agent may grant (validated again at dispatch against BUILTIN_TOOLS).
const TOOLS = ['web_search', 'public_data', 'read_file', 'write_file', 'edit_file', 'list_directory', 'run_command', 'code_execute', 'render_chart', 'generate_image', 'ocr', 'registry_lookup', 'remember']

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

const EMPTY = { label: '', description: '', systemPrompt: '', tools: [] as string[], maxTurns: 4, model: 'general' as 'coder' | 'general' }

export function AgentBuilderSurface() {
  const [data, setData] = useState<AgentsResp | null>(null)
  const [draft, setDraft] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [offline, setOffline] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function load() {
    void fetch(amUrl('/api/agents'))
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: AgentsResp) => { setData(d); setOffline(false) })
      .catch(() => setOffline(true))
  }
  useEffect(load, [])

  const toggleTool = (t: string) => setDraft((d) => ({ ...d, tools: d.tools.includes(t) ? d.tools.filter((x) => x !== t) : [...d.tools, t] }))

  async function save() {
    if (!draft.label.trim()) { setMsg('Give the agent a name.'); return }
    setSaving(true); setMsg('')
    try {
      const r = await fetch(amUrl('/api/agents'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
      if (!r.ok) throw new Error(`save ${r.status}`)
      setDraft({ ...EMPTY }); setEditingId(null); setMsg('saved'); load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'save failed — is the backend running?') }
    finally { setSaving(false) }
  }

  async function edit(a: Agent) {
    setDraft({ label: a.label, description: a.description, systemPrompt: a.systemPrompt ?? '', tools: a.tools, maxTurns: a.maxTurns, model: a.model ?? 'general' })
    setEditingId(a.id)
    setMsg('')
  }
  async function remove(id: string) { await fetch(amUrl(`/api/agents?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).catch(() => {}); load() }

  const isSuccess = msg === 'saved'

  return (
    <div className="flex h-full flex-col">
      {/* Fixed topbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border-secondary)] px-6" style={{ height: 50 }}>
        <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">Agent Builder</span>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">Define custom agents with specific tools, prompts, and constraints</span>
      </div>

      {offline && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/10 px-3 py-2 text-xs text-[#dc2626]">
          <span>Can&apos;t reach the backend — the agent service is offline. Your saved agents can&apos;t load.</span>
          <button onClick={load} className="ml-auto rounded px-1.5 py-0.5 font-medium underline transition hover:no-underline">Retry</button>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {/* LEFT panel — form */}
        <div className="w-[460px] shrink-0 overflow-y-auto bg-[var(--color-background-secondary)] p-5">
          {/* Section header */}
          <div className="mb-4 text-[11px] font-bold uppercase text-[var(--accent)]">
            {editingId ? `Editing: ${draft.label}` : 'New Agent'}
          </div>

          <div className="grid gap-3">
            {/* Name */}
            <label className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Name</span>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Security Reviewer" className="rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13.5px] text-[var(--color-text-primary)]" />
            </label>

            {/* Description */}
            <label className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                Description <span className="text-[9px] font-normal normal-case text-[var(--color-text-tertiary)]">(helps the concierge pick it automatically)</span>
              </span>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Reviews code diffs for security vulnerabilities before merge." className="rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13.5px] text-[var(--color-text-primary)]" />
            </label>

            {/* System prompt */}
            <label className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">System prompt</span>
              <textarea value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} rows={4} placeholder="You are a focused SQL specialist. Given a request, write the query, run it to verify, and return the result." className="resize-y rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13px] leading-[1.6] text-[var(--color-text-primary)]" />
            </label>

            {/* Tools */}
            <div className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                Tools it may use <span className="text-[9px] font-normal normal-case text-[var(--color-text-tertiary)]">(re-validated server-side at dispatch)</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TOOLS.map((t) => (
                  <button key={t} onClick={() => toggleTool(t)} className={`rounded-full border px-2 py-1 text-[11.5px] font-medium transition ${draft.tools.includes(t) ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)]'}`}>{t}</button>
                ))}
              </div>
            </div>

            {/* Max turns — range slider */}
            <div className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Max turns</span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">1</span>
                <input type="range" min={1} max={12} value={draft.maxTurns} onChange={(e) => setDraft({ ...draft, maxTurns: +e.target.value })} className="flex-1" style={{ accentColor: 'var(--accent)' }} />
                <span className="text-[10px] text-[var(--color-text-tertiary)]">12</span>
                <span className="ml-1 min-w-[24px] text-center text-[13px] font-bold text-[var(--color-text-primary)]">{draft.maxTurns}</span>
              </div>
            </div>

            {/* Model tier — toggle pills */}
            <div className="flex flex-col">
              <span className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Model tier</span>
              <div className="flex gap-2">
                {(['general', 'coder'] as const).map((tier) => (
                  <button key={tier} onClick={() => setDraft({ ...draft, model: tier })} className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${draft.model === tier ? 'bg-[var(--accent)] text-white' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'}`}>{tier}</button>
                ))}
              </div>
            </div>

            {/* Save + Clear */}
            <div className="mt-1 flex items-center gap-2">
              <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl bg-[var(--accent)] py-[11px] text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save agent'}</button>
              {draft.label && <button onClick={() => { setDraft({ ...EMPTY }); setEditingId(null); setMsg('') }} className="shrink-0 rounded-xl border border-[var(--color-border-secondary)] px-3 py-[11px] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">Clear</button>}
            </div>

            {/* Success banner */}
            {isSuccess && (
              <div className="flex items-center gap-2 rounded-[10px] border border-[#86efac] bg-[#dcfce7] p-3">
                <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
                <span className="text-[12px] font-medium text-[#15803d]">Saved — your agent is now dispatchable</span>
              </div>
            )}

            {/* Error messages */}
            {msg && !isSuccess && <div className="text-[11px] text-[var(--color-text-secondary)]">{msg}</div>}
          </div>
        </div>

        {/* RIGHT panel — agent list */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            {/* Your agents */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Your agents</div>
              {!data?.custom.length
                ? <div className="rounded-[10px] border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3.5 text-[13px] text-[var(--color-text-tertiary)]">None yet — build one on the left.</div>
                : <div className="space-y-2">
                    {data.custom.map((a) => (
                      <div key={a.id} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3.5">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-[13.5px] font-extrabold text-[var(--color-text-primary)]">{a.label}</span>
                          <div className="flex shrink-0 gap-1.5">
                            <button onClick={() => void edit(a)} className="text-xs font-semibold text-[var(--accent)] hover:underline">edit</button>
                            <button onClick={() => void remove(a.id)} className="text-xs font-semibold text-[#dc2626] hover:underline">delete</button>
                          </div>
                        </div>
                        {a.description && <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{a.description}</div>}
                        <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">{a.tools.length} tools · {a.maxTurns} turns · {a.model}</div>
                      </div>
                    ))}
                  </div>}
            </div>

            {/* Built-in roles */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                Built-in roles <span className="text-[9px] font-normal normal-case">(read-only reference)</span>
              </div>
              <div className="space-y-1.5">
                {(data?.builtin ?? []).map((a) => (
                  <div key={a.id} className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 opacity-85" title={a.description}>
                    <span className="text-[13px] font-bold text-[var(--color-text-secondary)]">{a.label}</span>
                    <span className="ml-1 text-[9px] text-[var(--color-text-tertiary)]">{a.tools.length} tools</span>
                    {a.description && <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">{a.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
