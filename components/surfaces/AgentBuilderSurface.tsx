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

  function load() {
    void fetch(amUrl('/api/agents'))
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: AgentsResp) => { setData(d); setOffline(false) })
      .catch(() => setOffline(true))   // don't silently blank the surface — tell the user + offer retry
  }
  useEffect(load, [])

  const toggleTool = (t: string) => setDraft((d) => ({ ...d, tools: d.tools.includes(t) ? d.tools.filter((x) => x !== t) : [...d.tools, t] }))

  async function save() {
    if (!draft.label.trim()) { setMsg('Give the agent a name.'); return }
    setSaving(true); setMsg('')
    try {
      const r = await fetch(amUrl('/api/agents'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
      if (!r.ok) throw new Error(`save ${r.status}`)
      setDraft({ ...EMPTY }); setMsg('Saved — your agent is now dispatchable.'); load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'save failed — is the backend running?') }
    finally { setSaving(false) }
  }

  async function edit(a: Agent) { setDraft({ label: a.label, description: a.description, systemPrompt: a.systemPrompt ?? '', tools: a.tools, maxTurns: a.maxTurns, model: a.model ?? 'general' }); setMsg('') }
  async function remove(id: string) { await fetch(amUrl(`/api/agents?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).catch(() => {}); load() }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Agent Builder</div>
      {offline && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/10 px-3 py-2 text-xs text-[#dc2626]">
          <span>Can’t reach the backend — the agent service is offline. Your saved agents can’t load.</span>
          <button onClick={load} className="ml-auto rounded px-1.5 py-0.5 font-medium underline transition hover:no-underline">Retry</button>
        </div>
      )}
      <p className="mb-5 max-w-2xl text-xs text-[var(--color-text-secondary)]">Define a custom sub-agent — its job, the tools it may use, and its budget. It saves encrypted and becomes dispatchable like the built-ins; the same containment, sandbox, and governance apply.</p>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Builder form */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-5">
          <div className="grid gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Name
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. SQL Helper" className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)]" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Description <span className="text-[var(--color-text-tertiary)]">(helps the concierge pick it)</span>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Writes + checks SQL queries against a schema." className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)]" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">System prompt
              <textarea value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} rows={5} placeholder="You are a focused SQL specialist. Given a request, write the query, run it to verify, and return the result." className="resize-y rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)]" />
            </label>
            <div className="flex flex-col gap-1.5 text-[11px] text-[var(--color-text-secondary)]">Tools it may use
              <div className="flex flex-wrap gap-1.5">
                {TOOLS.map((t) => (
                  <button key={t} onClick={() => toggleTool(t)} className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${draft.tools.includes(t) ? 'border-[#1d4ed8] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)]'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Max turns
                <input type="number" min={1} max={12} value={draft.maxTurns} onChange={(e) => setDraft({ ...draft, maxTurns: Math.max(1, Math.min(12, +e.target.value || 4)) })} className="w-20 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Model tier
                <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value === 'coder' ? 'coder' : 'general' })} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
                  <option value="general">general</option><option value="coder">coder</option>
                </select>
              </label>
              <button onClick={() => void save()} disabled={saving} className="ml-auto rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">{saving ? 'Saving…' : 'Save agent'}</button>
              {draft.label && <button onClick={() => setDraft({ ...EMPTY })} className="rounded-xl border border-[var(--color-border-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">Clear</button>}
            </div>
            {msg && <div className="text-[11px] text-[var(--color-text-secondary)]">{msg}</div>}
          </div>
        </div>

        {/* Your agents + built-ins */}
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold text-[#1d4ed8]">Your agents</div>
            {!data?.custom.length
              ? <div className="text-[11px] text-[var(--color-text-tertiary)]">None yet — build one on the left.</div>
              : <div className="space-y-2">
                  {data.custom.map((a) => (
                    <div key={a.id} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{a.label}</span>
                        <div className="flex shrink-0 gap-1.5">
                          <button onClick={() => void edit(a)} className="text-[11px] text-[#1d4ed8] hover:underline">edit</button>
                          <button onClick={() => void remove(a.id)} className="text-[11px] text-[#dc2626] hover:underline">delete</button>
                        </div>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{a.tools.length} tools · {a.maxTurns} turns · {a.model}</div>
                    </div>
                  ))}
                </div>}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">Built-in roles</div>
            <div className="space-y-1.5">
              {(data?.builtin ?? []).map((a) => (
                <div key={a.id} className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5" title={a.description}>
                  <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{a.label}</span>
                  <span className="ml-1 text-[11px] text-[var(--color-text-tertiary)]">{a.tools.length} tools</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
