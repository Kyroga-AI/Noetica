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
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border-secondary)] px-[22px]" style={{ height: 50 }}>
        <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">Agent Builder</span>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">Define, save &amp; dispatch custom sub-agents — same containment &amp; governance as built-ins</span>
      </div>

      {offline && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/10 px-3 py-2 text-xs text-[#dc2626]">
          <span>Can&apos;t reach the backend — the agent service is offline. Your saved agents can&apos;t load.</span>
          <button onClick={load} className="ml-auto rounded px-1.5 py-0.5 font-medium underline transition hover:no-underline">Retry</button>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT panel — form */}
        <div className="flex w-[460px] shrink-0 flex-col gap-[14px] overflow-y-auto border-r border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-5">
          {/* Section header */}
          <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--accent)]">
            {editingId ? `Editing: ${draft.label}` : 'New Agent'}
          </div>

          {/* Name */}
          <div>
            <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Name</div>
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Security Reviewer" className="w-full rounded-[9px] border border-[var(--line)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13.5px] text-[var(--color-text-primary)]" style={{ fontFamily: "'Manrope', sans-serif" }} />
          </div>

          {/* Description */}
          <div>
            <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
              Description <span className="text-[9px] font-normal normal-case text-[var(--color-text-tertiary)]">(helps the concierge pick it automatically)</span>
            </div>
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Reviews code diffs for security vulnerabilities before merge." className="w-full rounded-[9px] border border-[var(--line)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13px] text-[var(--color-text-primary)]" style={{ fontFamily: "'Manrope', sans-serif" }} />
          </div>

          {/* System prompt */}
          <div>
            <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">System prompt</div>
            <textarea value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} rows={4} placeholder="You are a focused SQL specialist. Given a request, write the query, run it to verify, and return the result." className="w-full resize-y rounded-[9px] border border-[var(--line)] bg-[var(--color-background-primary)] px-3 py-[9px] text-[13px] leading-[1.6] text-[var(--color-text-primary)]" style={{ fontFamily: "'Manrope', sans-serif" }} />
          </div>

          {/* Tools */}
          <div>
            <div className="mb-[7px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
              Tools it may use <span className="text-[9px] font-normal normal-case text-[var(--color-text-tertiary)]">(re-validated server-side at dispatch)</span>
            </div>
            <div className="flex flex-wrap gap-[5px]">
              {TOOLS.map((t) => (
                <button key={t} onClick={() => toggleTool(t)} className={`rounded-full px-[11px] py-[4px] text-[11.5px] transition ${draft.tools.includes(t) ? 'bg-[var(--accent)] font-bold text-white' : 'border border-[var(--line)] bg-[var(--color-background-primary)] font-medium text-[var(--color-text-secondary)]'}`}>{t}</button>
              ))}
            </div>
          </div>

          {/* Max turns + Model tier side by side */}
          <div className="flex gap-4">
            {/* Max turns */}
            <div className="flex-1">
              <div className="mb-[5px] flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Max turns</span>
                <span className="font-mono text-[12px] text-[var(--color-text-primary)]">{draft.maxTurns}</span>
              </div>
              <input type="range" min={1} max={12} value={draft.maxTurns} onChange={(e) => setDraft({ ...draft, maxTurns: +e.target.value })} className="w-full" style={{ accentColor: 'var(--accent)' }} />
              <div className="mt-[2px] flex justify-between">
                <span className="text-[9px] text-[var(--color-text-tertiary)]">1</span>
                <span className="text-[9px] text-[var(--color-text-tertiary)]">12</span>
              </div>
            </div>

            {/* Model tier */}
            <div className="flex-1">
              <div className="mb-[7px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Model tier</div>
              <div className="flex gap-[6px]">
                {(['general', 'coder'] as const).map((tier) => (
                  <button key={tier} onClick={() => setDraft({ ...draft, model: tier })} className={`rounded-full px-[14px] py-[6px] text-[12px] transition ${draft.model === tier ? 'bg-[var(--accent)] font-bold text-white' : 'border border-[var(--line)] bg-[var(--color-background-primary)] font-medium text-[var(--color-text-secondary)]'}`}>{tier}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Save button — full width */}
          <button onClick={() => void save()} disabled={saving} className="w-full cursor-pointer rounded-[12px] bg-[var(--accent)] px-5 py-[11px] text-center text-[14px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : editingId ? `Update ${draft.label}` : 'Save agent'}</button>

          {/* Success banner */}
          {isSuccess && (
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--verified-line)] bg-[var(--verified-soft)] p-[10px_14px]">
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-[var(--verified)]" />
              <span className="text-[13px] font-bold text-[var(--verified-fg)]">Saved — your agent is now dispatchable</span>
            </div>
          )}

          {/* Error messages */}
          {msg && !isSuccess && <div className="text-[11px] text-[var(--color-text-secondary)]">{msg}</div>}
        </div>

        {/* RIGHT panel — agent list */}
        <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {/* Your agents */}
          <div>
            <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">Your agents</div>
            {!data?.custom.length
              ? <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--color-background-secondary)] p-[14px] text-[13px] text-[var(--color-text-tertiary)]">No custom agents yet — fill in the form and save one.</div>
              : <div className="flex flex-col gap-2">
                  {data.custom.map((a) => (
                    <div key={a.id} className="flex flex-col gap-[6px] rounded-[12px] border border-[var(--line)] bg-[var(--color-background-secondary)] p-[14px_16px]">
                      <div className="flex items-start justify-between gap-[10px]">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-extrabold text-[var(--color-text-primary)]">{a.label}</div>
                          {a.description && <div className="mt-[2px] text-[12px] text-[var(--color-text-secondary)]">{a.description}</div>}
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button onClick={() => void edit(a)} className="cursor-pointer text-[12px] font-semibold text-[var(--accent)] hover:underline">edit</button>
                          <button onClick={() => void remove(a.id)} className="cursor-pointer text-[12px] font-semibold text-[var(--danger-fg)] hover:underline">delete</button>
                        </div>
                      </div>
                      <div className="font-mono text-[11.5px] text-[var(--color-text-tertiary)]">{a.tools.length} tools · {a.maxTurns} turns · {a.model}</div>
                    </div>
                  ))}
                </div>}
          </div>

          {/* Built-in roles */}
          <div>
            <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
              Built-in roles <span className="text-[9px] font-normal normal-case text-[var(--color-text-tertiary)]">— read-only reference</span>
            </div>
            <div className="flex flex-col gap-[6px]">
              {(data?.builtin ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--color-background-secondary)] p-[11px_14px] opacity-[0.85]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-[var(--color-text-primary)]">{a.label}</div>
                    {a.description && <div className="mt-[2px] truncate text-[11.5px] text-[var(--color-text-tertiary)]">{a.description}</div>}
                  </div>
                  <div className="shrink-0 whitespace-nowrap font-mono text-[11px] text-[var(--color-text-tertiary)]">{a.tools.length} tools</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
