'use client'

import { useEffect, useRef, useState } from 'react'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { useSettings } from '@/lib/settings/context'
import type { ChatMessage } from '@/lib/types/message'

type Task = { id: string; title: string; status: 'todo' | 'doing' | 'done'; agent?: string; result?: string; running?: boolean; inputFrom?: string }
type Decision = { id: string; text: string; createdAt: string }

const AGENT_OPTIONS = ['Researcher', 'Engineer', 'Analyst', 'Writer', 'Reviewer']

const AGENT_EMOJI: Record<string, string> = {
  Researcher: '\u{1F50D}',
  Engineer: '⚙️',
  Analyst: '\u{1F4CA}',
  Writer: '✍️',
  Reviewer: '\u{1F50E}',
}

const AGENT_PERSONAS: Record<string, string> = {
  Researcher:
    'You are a research agent. Your job is to investigate the given task thoroughly. Provide key facts, relevant context, potential approaches, and sources of uncertainty. Be concise and structured.',
  Engineer:
    'You are a software engineering agent. Your job is to implement or design the technical solution for the given task. Provide concrete code, architecture decisions, and implementation steps.',
  Analyst:
    'You are a data and systems analyst. Your job is to break down the given task, identify risks, dependencies, success metrics, and trade-offs. Be systematic and rigorous.',
  Writer:
    'You are a writing and communication agent. Your job is to produce clear, well-structured written output for the given task. Match tone and format to the intended audience.',
  Reviewer:
    'You are a critical review agent. Your job is to evaluate the given task or artifact for correctness, completeness, edge cases, and quality. Provide specific, actionable feedback.',
}

const COWORK_STORAGE_KEY = 'noetica:cowork:v1'

function loadCoworkState(): { objective: string; tasks: Task[]; decisions: Decision[] } {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(COWORK_STORAGE_KEY) : null
    if (!raw) return { objective: '', tasks: [], decisions: [] }
    return JSON.parse(raw) as { objective: string; tasks: Task[]; decisions: Decision[] }
  } catch {
    return { objective: '', tasks: [], decisions: [] }
  }
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function CoworkSurface({ thinkingBudget }: { thinkingBudget?: number }) {
  const { settings } = useSettings()
  const initial = loadCoworkState()
  const [objective, setObjectiveState] = useState(initial.objective)
  const [tasks, setTasks] = useState<Task[]>(initial.tasks)
  const [decisions, setDecisions] = useState<Decision[]>(initial.decisions)
  const [decomposing, setDecomposing] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [confirmNewSession, setConfirmNewSession] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort all in-flight streams on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Persist objective + tasks + decisions whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(COWORK_STORAGE_KEY, JSON.stringify({ objective, tasks, decisions }))
    } catch { /* storage quota exceeded — ignore */ }
  }, [objective, tasks, decisions])

  function providerKeys() {
    return {
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
    }
  }

  function commitObjective(next: string) {
    const trimmed = next.trim()
    const changed = trimmed !== objective
    setObjectiveState(trimmed)
    if (changed && trimmed) {
      setDecisions((prev) => [{ id: crypto.randomUUID(), text: `Objective set: "${trimmed}"`, createdAt: new Date().toISOString() }, ...prev])
    }
  }

  async function decompose() {
    if (!objective || decomposing) return
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    setDecomposing(true)
    const msgs: ChatMessage[] = [
      {
        id: 'sys', role: 'system',
        content: 'You decompose objectives into concrete, actionable tasks. Respond with a numbered list of 4–7 tasks, one per line. No preamble, no extra text — just the numbered list.',
        created_at: new Date().toISOString(),
      },
      {
        id: 'u', role: 'user',
        content: `Decompose this objective into specific tasks: "${objective}"`,
        created_at: new Date().toISOString(),
      },
    ]
    let output = ''
    try {
      await sendNoeticaChat(
        { session_id: `cowork:${crypto.randomUUID()}`, mode: 'standalone', model_id: settings.defaultModelId, messages: msgs, memory_scope: 'noetica-cowork', provider_keys: providerKeys(), thinking_budget: thinkingBudget },
        {
          onMeta: () => {},
          onDelta: (d) => { output += d },
          onThinkingDelta: () => {},
          onDone: () => {
            const lines = output.split('\n')
              .map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim())
              .filter((l) => l.length > 5)
            const newTasks: Task[] = lines.map((title) => ({ id: crypto.randomUUID(), title, status: 'todo' }))
            setTasks((prev) => [...prev, ...newTasks])
            setDecisions((prev) => [
              { id: crypto.randomUUID(), text: `AI decomposed objective into ${newTasks.length} tasks`, createdAt: new Date().toISOString() },
              ...prev,
            ])
          },
          onError: (e) => { output = `Error: ${e}` },
        },
        {},
        abort.signal
      )
    } finally {
      setDecomposing(false)
    }
  }

  function addTask() {
    if (!newTaskText.trim()) return
    setTasks((prev) => [{ id: crypto.randomUUID(), title: newTaskText.trim(), status: 'todo' }, ...prev])
    setNewTaskText('')
  }

  function cycleStatus(id: string) {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== id) return t
      const next: Task['status'] = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo'
      return { ...t, status: next }
    }))
  }

  function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  function assignAgent(id: string, agent: string) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, agent } : t))
    setDecisions((prev) => [
      { id: crypto.randomUUID(), text: `"${tasks.find((t) => t.id === id)?.title?.slice(0,40)}" assigned to ${agent}`, createdAt: new Date().toISOString() },
      ...prev,
    ])
  }

  async function runTask(task: Task, taskList?: Task[]) {
    if (!task.agent || task.running) return
    const persona = AGENT_PERSONAS[task.agent] ?? `You are a ${task.agent} agent. Complete the following task to the best of your ability.`
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, running: true, status: 'doing', result: '' } : t))

    // Task chaining — inject predecessor result as context
    const predecessorTask = task.inputFrom ? (taskList ?? tasks).find((t) => t.id === task.inputFrom) : null
    const predecessorContext = predecessorTask?.result
      ? `\n\nPrior task result (from ${predecessorTask.agent ?? 'agent'} — "${predecessorTask.title}"):\n${predecessorTask.result}`
      : ''

    const msgs: ChatMessage[] = [
      {
        id: 'sys', role: 'system',
        content: `${persona}\n\nObjective context: ${objective || '(not set)'}${predecessorContext}`,
        created_at: new Date().toISOString(),
      },
      {
        id: 'user', role: 'user',
        content: `Complete this task: ${task.title}`,
        created_at: new Date().toISOString(),
      },
    ]

    const abort = new AbortController()
    abortRef.current = abort

    let output = ''
    try {
      await sendNoeticaChat(
        {
          session_id: `cowork:task:${task.id}`,
          mode: 'standalone',
          model_id: settings.defaultModelId,
          messages: msgs,
          memory_scope: 'noetica-cowork',
          provider_keys: providerKeys(),
          thinking_budget: thinkingBudget,
        },
        {
          onMeta: () => {},
          onDelta: (d) => {
            output += d
            setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, result: output } : t))
          },
          onThinkingDelta: () => {},
          onDone: (result) => {
            const final = result.content || output
            setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, result: final, running: false, status: 'done' } : t))
            setDecisions((prev) => [
              { id: crypto.randomUUID(), text: `${task.agent} completed: "${task.title.slice(0, 40)}"`, createdAt: new Date().toISOString() },
              ...prev,
            ])
          },
          onError: (err) => {
            setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, running: false, result: `Error: ${err}` } : t))
          },
        },
        {},
        abort.signal
      )
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, running: false } : t))
    }
  }

  // Run all assigned tasks in dependency order (topological sort by inputFrom)
  async function runChain() {
    const pending = tasks.filter((t) => t.agent && t.status !== 'done' && !t.running)
    if (pending.length === 0) return
    // Topological order: tasks with no inputFrom first, then tasks whose predecessor is done
    const ordered: Task[] = []
    const remaining = [...pending]
    const maxIter = remaining.length * 2
    let iter = 0
    while (remaining.length > 0 && iter++ < maxIter) {
      const idx = remaining.findIndex((t) => {
        if (!t.inputFrom) return true
        return ordered.some((o) => o.id === t.inputFrom) || tasks.find((p) => p.id === t.inputFrom)?.status === 'done'
      })
      if (idx === -1) { ordered.push(...remaining); break }
      ordered.push(remaining.splice(idx, 1)[0])
    }
    // Execute sequentially
    let currentTasks = tasks
    for (const task of ordered) {
      const latest = currentTasks.find((t) => t.id === task.id) ?? task
      await runTask(latest, currentTasks)
      // Re-read tasks after each run
      await new Promise<void>((resolve) => {
        setTasks((prev) => { currentTasks = prev; resolve(); return prev })
      })
    }
  }

  function setInputFrom(id: string, fromId: string | undefined) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, inputFrom: fromId } : t))
  }

  function newSession() {
    setObjectiveState('')
    setTasks([])
    setDecisions([])
    setConfirmNewSession(false)
  }

  const chainable = tasks.filter((t) => t.agent && t.status !== 'done' && !t.running)

  const STATUS_STYLE: Record<Task['status'], string> = {
    todo:  'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]',
    doing: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    done:  'bg-[rgba(34,197,94,0.12)] text-[#16a34a]',
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Objective bar — full width, persistent */}
      <div className="shrink-0 border-b border-[var(--color-border-tertiary)]" style={{ padding: '14px 20px 12px' }}>
        <div className="flex items-center gap-[10px]">
          {/* Sunken objective container: label + input */}
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
            <div className="shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">Objective</div>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="e.g. Launch a landing page for our new pricing model"
              value={objective}
              onChange={(e) => setObjectiveState(e.target.value)}
              onBlur={(e) => commitObjective(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <button
            onClick={() => void decompose()}
            disabled={!objective || decomposing}
            className={`shrink-0 rounded-[10px] px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              objective
                ? 'bg-[var(--accent)] text-white hover:opacity-90'
                : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]'
            }`}
          >
            {decomposing ? (
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Decomposing...</span>
            ) : (
              'AI decompose'
            )}
          </button>
          <button
            onClick={() => void runChain()}
            disabled={chainable.length === 0}
            title={chainable.length === 0 ? 'No assigned, incomplete tasks to chain' : 'Run all assigned tasks in chain order'}
            className="shrink-0 rounded-[10px] px-3.5 py-2 text-[12.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: chainable.length > 0 ? 'var(--accent)' : 'var(--color-background-secondary)',
              color: chainable.length > 0 ? '#fff' : 'var(--color-text-secondary)',
              border: chainable.length > 0 ? '1px solid var(--accent)' : '1px solid var(--color-border-tertiary)',
            }}
          >
            Run chain
          </button>
          <button
            onClick={() => setConfirmNewSession(true)}
            className="shrink-0 rounded-[10px] border border-[var(--color-border-tertiary)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)]"
          >
            New session
          </button>
        </div>
      </div>

      {/* Confirm banner — full-width strip outside objective bar */}
      {confirmNewSession && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[#FCD34D] bg-[#FEF3C7] px-5 py-2.5">
          <span className="flex-1 text-[13px] text-[#92400E]">Clear this session? All tasks and results will be lost.</span>
          <span onClick={newSession} className="cursor-pointer text-[13px] font-bold text-[#DC2626]">Clear</span>
          <span onClick={() => setConfirmNewSession(false)} className="cursor-pointer text-[13px] font-semibold text-[var(--color-text-secondary)]">Cancel</span>
        </div>
      )}

      {/* Board + decision log */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Task board */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" style={{ padding: '18px 20px' }}>
          {/* Always-visible add-task row */}
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="Add a task…"
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
            />
            <button onClick={addTask} className="shrink-0 rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)]">Add</button>
          </div>

          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-[13px] leading-[1.7] text-[var(--color-text-tertiary)]" style={{ padding: '48px 20px' }}>
              <div className="mb-3 text-2xl">{'⛓'}</div>
              <div className="mb-1.5 font-semibold text-[var(--color-text-secondary)]">No tasks yet</div>
              <div>Set an objective above and click <strong>AI decompose</strong>, or add tasks manually.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border bg-[var(--color-background-primary)]"
                  style={{ borderColor: task.status === 'done' ? 'rgba(34,197,94,0.25)' : task.status === 'doing' ? 'var(--accent-soft)' : 'var(--color-border-tertiary)', opacity: task.status === 'done' ? 0.85 : 1 }}
                >
                  {/* Row 1: status pill + title + delete X */}
                  <div className="flex items-start gap-[10px] px-[14px] pt-[14px]">
                    <button
                      onClick={() => cycleStatus(task.id)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${STATUS_STYLE[task.status]}`}
                      title="Click to cycle status"
                    >
                      {task.running ? (
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                          running
                        </span>
                      ) : task.status}
                    </button>
                    <span className={`flex-1 text-[13.5px] font-semibold leading-[1.45] ${task.status === 'done' ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}`} style={{ paddingTop: 1, cursor: 'default' }}>
                      {task.title}
                    </span>
                    <button
                      onClick={() => removeTask(task.id)}
                      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[14px] text-[var(--color-text-primary)] opacity-[0.35] transition hover:opacity-70"
                      style={{ marginTop: 1 }}
                    >
                      {'✕'}
                    </button>
                  </div>
                  {/* Row 2: agent dropdown + chain-from dropdown + Run button */}
                  <div className="mx-[14px] flex items-center gap-2 border-t border-[var(--color-border-secondary)]" style={{ marginTop: 9, paddingTop: 9, paddingBottom: 14 }}>
                    <select
                      value={task.agent ?? ''}
                      onChange={(e) => e.target.value && assignAgent(task.id, e.target.value)}
                      className="flex-1 rounded-[7px] border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-[5px] text-[12px] text-[var(--color-text-primary)] outline-none"
                      title="Assign agent"
                    >
                      <option value="">{'— assign agent —'}</option>
                      {AGENT_OPTIONS.map((a) => <option key={a} value={a}>{AGENT_EMOJI[a]} {a}</option>)}
                    </select>
                    <select
                      value={task.inputFrom ?? ''}
                      onChange={(e) => setInputFrom(task.id, e.target.value || undefined)}
                      className="rounded-[7px] border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-[5px] text-[12px] text-[var(--color-text-primary)] outline-none"
                      style={{ maxWidth: 160 }}
                      title="Chain input from a prior task result"
                    >
                      <option value="">Chain from…</option>
                      {tasks.filter((t) => t.id !== task.id).map((t) => (
                        <option key={t.id} value={t.id}>{t.title.slice(0, 30)}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    <button
                      onClick={() => void runTask(task)}
                      disabled={!task.agent || task.running}
                      className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition disabled:cursor-not-allowed"
                      style={{
                        background: task.running ? 'var(--color-background-secondary)' : task.agent ? 'var(--accent)' : 'var(--color-background-secondary)',
                        color: task.running ? 'var(--color-text-tertiary)' : task.agent ? '#fff' : 'var(--color-text-tertiary)',
                        opacity: task.agent ? 1 : 0.5,
                      }}
                    >
                      {task.status === 'done' ? '↺ Re-run' : '▶ Run'}
                    </button>
                  </div>
                  {/* Agent result */}
                  {task.result && (
                    <div className="mx-[14px] mb-[14px]" style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--color-background-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
                        {task.agent} result
                        {task.running && <span className="animate-pulse">...</span>}
                      </div>
                      <div className="max-h-[180px] overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-[1.6] text-[var(--color-text-primary)]">
                        {task.result}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Decision log — persistent 240px right rail */}
        <div className="flex w-[240px] shrink-0 flex-col border-l border-[var(--color-border-tertiary)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)]" style={{ padding: '12px 14px 10px' }}>
            <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-[var(--color-text-secondary)]">Decision log</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">{decisions.length > 0 ? decisions.length : ''}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" style={{ padding: '10px 12px' }}>
            {decisions.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">No decisions yet</div>
            ) : (
              decisions.map((d) => (
                <div key={d.id} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]" style={{ padding: '8px 10px' }}>
                  <div className="text-[11.5px] leading-[1.5] text-[var(--color-text-primary)]">{d.text}</div>
                  <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(d.createdAt)}</div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-[var(--color-border-secondary)]" style={{ padding: '10px 12px' }}>
            <div className="text-[10.5px] leading-[1.6] text-[var(--color-text-tertiary)]">One session at a time. Results are ephemeral — copy to Notes or Canvas to keep them.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
