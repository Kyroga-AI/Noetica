'use client'

import { useEffect, useRef, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { useComputerUse, describeAction } from '@/lib/computer-use/useComputerUse'
import type { ComputerStep, CUProvider } from '@/lib/computer-use/useComputerUse'
import type { Plan } from '@/lib/computer-use/planner'
import { getAllTraces, clearMemory } from '@/lib/computer-use/memory'
import { isTauri } from '@/lib/tauri/bridge'

// ─── Sub-task progress bar ────────────────────────────────────────────────────

function PlanView({ plan }: { plan: Plan }) {
  const total = plan.subTasks.length
  const done  = plan.subTasks.filter((t) => t.done && !t.failed).length
  const failed = plan.subTasks.filter((t) => t.failed).length

  return (
    <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#1d4ed8]">Plan — {total} step{total !== 1 ? 's' : ''}</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">{done}/{total} done{failed ? `, ${failed} failed` : ''}</span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-[#bfdbfe] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${failed ? 'bg-[#f87171]' : 'bg-[#3b82f6]'}`}
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <div className="space-y-1">
        {plan.subTasks.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
              t.failed ? 'bg-[#fecaca] text-[#dc2626]' :
              t.done   ? 'bg-[#dcfce7] text-[#16a34a]' :
              'bg-[#dbeafe] text-[#3b82f6]'
            }`}>
              {t.failed ? '✕' : t.done ? '✓' : i + 1}
            </span>
            <span className={`text-[11px] ${t.failed ? 'text-[#dc2626] line-through' : t.done ? 'text-[#15803d]' : 'text-[var(--color-text-secondary)]'}`}>
              {t.title}
            </span>
            {t.appContext && t.appContext !== 'unknown' && (
              <span className="ml-auto shrink-0 rounded-full bg-[#dbeafe] px-1.5 py-0.5 text-[9px] text-[#1d4ed8]">{t.appContext}</span>
            )}
          </div>
        ))}
      </div>
      {plan.reasoning && (
        <p className="text-[10px] text-[var(--color-text-tertiary)] border-t border-[#bfdbfe] pt-2">{plan.reasoning}</p>
      )}
    </div>
  )
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({ step, isPending, onApprove, onReject }: {
  step: ComputerStep
  isPending: boolean
  onApprove?: () => void
  onReject?: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (step.type === 'screenshot') {
    return (
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-secondary)]">
        <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-2 bg-[var(--color-background-secondary)] px-3 py-1.5 text-left">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Screenshot</span>
          <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{step.timestamp.split('T')[1]?.slice(0, 8)}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d={expanded ? 'M2 7l3-4 3 4' : 'M2 3l3 4 3-4'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <img src={`data:image/png;base64,${step.content}`} alt="Screen capture"
          className={`w-full object-cover object-top ${expanded ? '' : 'max-h-40'}`} />
      </div>
    )
  }

  if (step.type === 'plan') {
    return (
      <div className="rounded-xl bg-[#f0f9ff] border border-[#bae6fd] px-4 py-3">
        <p className="text-[11px] font-semibold text-[#0369a1] mb-1">Planning</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{step.content}</p>
      </div>
    )
  }

  if (step.type === 'subtask') {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="h-px flex-1 bg-[var(--color-border-secondary)]" />
        <span className="text-[10px] font-semibold text-[#3b82f6]">{step.content}</span>
        <div className="h-px flex-1 bg-[var(--color-border-secondary)]" />
      </div>
    )
  }

  if (step.type === 'thinking') {
    return (
      <div className="rounded-xl bg-[var(--color-background-secondary)] px-4 py-2.5 border-l-2 border-[#e2e8f0]">
        <p className="text-xs italic text-[var(--color-text-tertiary)]">{step.content}</p>
      </div>
    )
  }

  if (step.type === 'text') {
    return (
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-[10px] font-bold text-white">N</div>
        <div className="flex-1 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)]">
          <p className="whitespace-pre-wrap">{step.content}</p>
        </div>
      </div>
    )
  }

  if (step.type === 'action') {
    const isApproved = step.approved === true
    const isRejected = step.approved === false
    const waiting    = step.approved === undefined

    return (
      <div className={`rounded-xl border-2 px-4 py-3 ${
        waiting    ? 'border-[#fbbf24] bg-[#fffbeb]' :
        isApproved ? 'border-[#22c55e] bg-[#f0fdf4]' :
        'border-[#f87171] bg-[#fef2f2]'
      }`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-base">{waiting ? '⚡' : isApproved ? '✓' : '✕'}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${waiting ? 'text-[#92400e]' : isApproved ? 'text-[#15803d]' : 'text-[#991b1b]'}`}>
              {waiting ? 'Proposed action' : isApproved ? 'Executed' : 'Rejected'}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{step.content}</p>
            {step.action && (
              <p className="mt-1 font-mono text-[9px] text-[var(--color-text-tertiary)] break-all">{JSON.stringify(step.action)}</p>
            )}
          </div>
        </div>
        {isPending && waiting && onApprove && onReject && (
          <div className="mt-3 flex gap-2">
            <button onClick={onApprove} className="flex-1 rounded-lg bg-[#22c55e] py-1.5 text-xs font-semibold text-white hover:bg-[#16a34a] transition">Allow</button>
            <button onClick={onReject}  className="flex-1 rounded-lg border border-[#fecaca] bg-white py-1 text-xs font-medium text-[#dc2626] hover:bg-[#fef2f2] transition">Stop</button>
          </div>
        )}
      </div>
    )
  }

  if (step.type === 'error') {
    return (
      <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3">
        <p className="text-xs font-medium text-[#dc2626]">{step.content}</p>
      </div>
    )
  }

  return null
}

// ─── Memory panel ─────────────────────────────────────────────────────────────

function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [traces, setTraces] = useState(() => getAllTraces())

  function handleClear() {
    if (!window.confirm(`Delete all ${traces.length} episodic memory trace${traces.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    clearMemory()
    setTraces([])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">Episodic Memory</p>
        <div className="flex gap-2">
          {traces.length > 0 && (
            <button onClick={handleClear} className="text-[10px] text-[#dc2626] hover:underline">Clear all</button>
          )}
          <button onClick={onClose} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {traces.length === 0 ? (
          <p className="text-center text-xs text-[var(--color-text-tertiary)] py-6">No sessions recorded yet.</p>
        ) : (
          traces.map((t) => (
            <div key={t.id} className={`rounded-xl border px-3 py-2.5 ${t.succeeded ? 'border-[#dcfce7] bg-[#f0fdf4]' : 'border-[#fecaca] bg-[#fef2f2]'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-[var(--color-text-primary)] leading-4">{t.goal}</p>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${t.succeeded ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#fecaca] text-[#dc2626]'}`}>
                  {t.succeeded ? 'ok' : 'fail'}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{t.appContext}</p>
              <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{t.stepSummary}</p>
              <p className="mt-1 text-[9px] text-[#cbd5e1]">{new Date(t.createdAt).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Not Tauri notice ─────────────────────────────────────────────────────────

function NotTauriNotice() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="max-w-md rounded-2xl border border-dashed border-[#bfdbfe] bg-[#eff6ff] p-10">
        <p className="mb-3 text-3xl">🖥️</p>
        <p className="text-sm font-semibold text-[var(--color-text-secondary)]">Desktop app required</p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          Computer Use requires the Noetica desktop app to take screenshots and control the system.
        </p>
        <p className="mt-3 font-mono text-[11px] text-[var(--color-text-tertiary)]">npm run tauri:dev</p>
      </div>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

export function ComputerUseSurface() {
  const { settings } = useSettings()
  const [goal, setGoal] = useState('')
  const [provider, setProvider] = useState<CUProvider>('anthropic')
  const [usePlanning, setUsePlanning] = useState(true)
  const [showMemory, setShowMemory] = useState(false)
  const stepsEndRef = useRef<HTMLDivElement>(null)

  const {
    status, steps, plan, error, pendingAction,
    isSupported, startSession, stopSession, reset,
    approveAction, rejectAction,
  } = useComputerUse({
    anthropicApiKey: settings.anthropicApiKey || '',
    openaiApiKey: settings.openaiApiKey || undefined,
    provider,
    useHierarchicalPlanning: usePlanning,
  })

  const isRunning = status === 'running' || status === 'awaiting_approval' || status === 'planning'

  // Auto-stop if stuck in running/planning for more than 5 minutes
  useEffect(() => {
    if (status !== 'running' && status !== 'planning') return
    const t = setTimeout(() => {
      stopSession()
    }, 5 * 60 * 1000)
    return () => clearTimeout(t)
  }, [status, stopSession])

  if (!isSupported) return <NotTauriNotice />

  const hasAnthropicKey = Boolean(settings.anthropicApiKey)
  const hasOpenAIKey    = Boolean(settings.openaiApiKey)

  if (!hasAnthropicKey && !hasOpenAIKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
        <div className="max-w-md rounded-2xl border border-dashed border-[#fecaca] bg-[#fef2f2] p-10">
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">API key required</p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Add an Anthropic or OpenAI key in Settings → Providers.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Main panel ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--color-border-secondary)] px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Computer Use</h1>
              {/* Provider toggle */}
              <div className="flex items-center gap-0.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-0.5">
                {(['anthropic', 'openai'] as CUProvider[]).map((p) => {
                  const disabled = p === 'anthropic' ? !hasAnthropicKey : !hasOpenAIKey
                  return (
                    <button
                      key={p}
                      onClick={() => !disabled && setProvider(p)}
                      disabled={disabled}
                      title={disabled ? `No ${p === 'anthropic' ? 'Anthropic' : 'OpenAI'} key` : undefined}
                      className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition capitalize ${
                        provider === p ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {p === 'anthropic' ? 'Claude' : 'OpenAI'}
                    </button>
                  )
                })}
              </div>
              {/* Planning toggle */}
              <button
                onClick={() => setUsePlanning((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition ${
                  usePlanning
                    ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
                    : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'
                }`}
                title="Agent S hierarchical planning"
              >
                <span className="text-[10px]">⚙</span> Agent S
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                status === 'idle'              ? 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]' :
                status === 'planning'          ? 'bg-[#f0f9ff] text-[#0369a1] animate-pulse' :
                status === 'running'           ? 'bg-[#dbeafe] text-[#1d4ed8] animate-pulse' :
                status === 'awaiting_approval' ? 'bg-[#fef9c3] text-[#92400e]' :
                status === 'done'              ? 'bg-[#dcfce7] text-[#15803d]' :
                'bg-[#fef2f2] text-[#dc2626]'
              }`}>
                {status === 'idle' ? 'Ready' : status === 'planning' ? 'Planning…' : status === 'running' ? 'Running…' : status === 'awaiting_approval' ? 'Awaiting approval' : status === 'done' ? 'Done' : 'Error'}
              </span>
              <button onClick={() => setShowMemory((v) => !v)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${showMemory ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-secondary)]'}`}
                title="Episodic memory">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {(isRunning || status === 'done') && (
                <button onClick={isRunning ? stopSession : reset}
                  className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">
                  {isRunning ? 'Stop' : 'Reset'}
                </button>
              )}
            </div>
          </div>

          {/* Safety notice */}
          <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3 py-1.5">
            <span className="shrink-0 text-xs">⚠️</span>
            <p className="text-[10px] leading-4 text-[#92400e]">
              <strong>Human-in-the-loop:</strong> Every proposed action requires your approval. Clicks and keystrokes execute on your real system.
            </p>
          </div>
        </div>

        {/* Plan view */}
        {plan && (
          <div className="shrink-0 border-b border-[var(--color-border-secondary)] px-6 py-3">
            <PlanView plan={plan} />
          </div>
        )}

        {/* Steps timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {steps.length === 0 && status === 'idle' && (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--color-text-tertiary)]">Enter a goal to start a computer use session.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                  'Open Safari and go to apple.com',
                  'Open TextEdit and write a haiku',
                  'Take a screenshot and describe what you see',
                  'Open Calculator and compute 1234 × 5678',
                  'Search for "Noetica AI" in Safari',
                  'Create a new folder on the Desktop called "Projects"',
                ].map((s) => (
                  <button key={s} onClick={() => setGoal(s)}
                    className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3">
              <p className="text-xs font-semibold text-[#dc2626]">Error</p>
              <p className="mt-0.5 text-xs text-[#dc2626]">{error}</p>
            </div>
          )}

          {steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              isPending={pendingAction?.id === step.id}
              onApprove={pendingAction?.id === step.id ? () => approveAction(step.id) : undefined}
              onReject={pendingAction?.id === step.id ? () => rejectAction(step.id) : undefined}
            />
          ))}

          {(status === 'running' || status === 'planning') && (
            <div className="flex items-center gap-2 px-1">
              {[0, 150, 300].map((delay) => (
                <div key={delay} className="h-1.5 w-1.5 rounded-full bg-[#3b82f6] animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {status === 'planning' ? 'Planning sub-tasks…' : 'Noetica is acting…'}
              </span>
            </div>
          )}

          <div ref={stepsEndRef} />
        </div>

        {/* Sticky approval banner */}
        {status === 'awaiting_approval' && pendingAction?.action && (
          <div className="shrink-0 mx-4 mb-2 flex items-center gap-3 rounded-2xl border border-[#fcd34d] bg-[#fefce8] px-4 py-3 shadow-md">
            <span className="text-lg">⚡</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#92400e]">Approval required</p>
              <p className="truncate text-xs text-[#78350f]">{pendingAction.content}</p>
            </div>
            <button onClick={() => approveAction(pendingAction.id)} className="rounded-lg bg-[#22c55e] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#16a34a]">Allow</button>
            <button onClick={() => rejectAction(pendingAction.id)} className="rounded-lg border border-[#fecaca] bg-white px-3 py-1.5 text-xs font-medium text-[#dc2626] transition hover:bg-[#fef2f2]">Stop</button>
          </div>
        )}

        {/* Goal input */}
        <div className="shrink-0 border-t border-[var(--color-border-secondary)] px-6 py-4">
          <div className="flex items-end gap-3 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3 shadow-sm">
            <textarea
              className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="Describe what you want Noetica to do on your computer…"
              value={goal}
              disabled={isRunning}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isRunning) void startSession(goal)
              }}
            />
            <button
              onClick={() => void startSession(goal)}
              disabled={!goal.trim() || isRunning}
              className="shrink-0 rounded-xl bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? 'Running…' : 'Start'}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-[#cbd5e1]">⌘ + Enter · {provider === 'openai' ? 'OpenAI computer-use-preview' : 'Claude computer-use-2024-10-22'}{usePlanning ? ' · Agent S planning' : ''}</p>
        </div>
      </div>

      {/* ── Memory sidebar ── */}
      {showMemory && (
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
          <MemoryPanel onClose={() => setShowMemory(false)} />
        </aside>
      )}
    </div>
  )
}
