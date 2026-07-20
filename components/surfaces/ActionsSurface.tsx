'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

// Actions — the typed action layer catalog (Bet C, v1). Shows what the agent can DO as typed,
// parameterized actions with their class + reversibility, so the capability surface is legible. v1 is the
// catalog; execution still happens in chat through the gated tool path. Approve/undo UX is the next phase.

type ActionClass = 'read' | 'write' | 'exec' | 'net' | 'memory'
interface ActionParam { name: string; type: string; required: boolean; description: string }
interface ActionDef { id: string; label: string; description: string; actionClass: ActionClass; reversible: boolean; tool: string; params: ActionParam[] }

const CLASS_META: Record<ActionClass, { label: string; dot: string }> = {
  read:   { label: 'Read',   dot: 'var(--color-text-tertiary)' },
  net:    { label: 'Network', dot: 'var(--color-accent)' },
  memory: { label: 'Memory', dot: 'var(--color-accent)' },
  write:  { label: 'Write',  dot: 'var(--color-attention)' },
  exec:   { label: 'Execute', dot: '#dc2626' },
}
const ORDER: ActionClass[] = ['read', 'net', 'memory', 'write', 'exec']

export function ActionsSurface() {
  const [actions, setActions] = useState<ActionDef[]>([])
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch(amUrl('/api/actions'))
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad response')
      const j = (await r.json()) as { actions?: ActionDef[] }
      setActions(j.actions ?? [])
    } catch { setErr('Couldn’t load the action catalog — is the runtime running?') }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Actions</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-text-tertiary)]">
          The typed things the agent can do — each with its class and whether it can be undone. Ask in chat
          to run one; side-effecting actions pass through the scope-d gate and (in Plan mode) your approval.
        </p>
      </div>

      {err ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-3 text-[13px] text-[var(--color-text-secondary)]">{err}</p>
            <button onClick={() => void load()} className="rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-background-primary)]">Retry</button>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl px-6 py-5">
          {ORDER.filter((cls) => actions.some((a) => a.actionClass === cls)).map((cls) => (
            <div key={cls} className="mb-5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: CLASS_META[cls].dot }} />{CLASS_META[cls].label}
              </div>
              <div className="space-y-2">
                {actions.filter((a) => a.actionClass === cls).map((a) => (
                  <div key={a.id} className="rounded-xl border border-[var(--color-border-secondary)] px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{a.label}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${a.reversible ? 'text-[var(--color-accent)]' : 'text-[#dc2626]'}`}
                        style={{ background: 'var(--color-background-secondary)' }}>
                        {a.reversible ? 'reversible' : 'irreversible'}
                      </span>
                      <span className="ml-auto font-mono text-[10.5px] text-[var(--color-text-tertiary)]">{a.tool}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{a.description}</p>
                    {a.params.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {a.params.map((p) => (
                          <span key={p.name} className="rounded-md bg-[var(--color-background-secondary)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-text-tertiary)]" title={p.description}>
                            {p.name}{p.required ? '' : '?'}: {p.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
