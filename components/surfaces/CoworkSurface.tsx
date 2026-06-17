'use client'

import { useEffect, useRef, useState } from 'react'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { useSettings } from '@/lib/settings/context'
import type { ChatMessage } from '@/lib/types/message'

type Task = { id: string; title: string; status: 'todo' | 'doing' | 'done'; agent?: string; result?: string; running?: boolean; inputFrom?: string }
type Decision = { id: string; text: string; createdAt: string }

const AGENT_OPTIONS = ['Researcher', 'Engineer', 'Analyst', 'Writer', 'Reviewer']

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

export function CoworkSurface({ thinkingBudget }: { thinkingBudget?: number }) {
  const { settings } = useSettings()
  const [objective, setObjective] = useState('')
  const [editingObjective, setEditingObjective] = useState(false)
  const [draftObjective, setDraftObjective] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [decomposing, setDecomposing] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort all in-flight streams on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  function providerKeys() {
    return {
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
    }
  }

  function setObj() {
    if (draftObjective.trim()) {
      setObjective(draftObjective.trim())
      setDecisions((prev) => [{ id: crypto.randomUUID(), text: `Objective set: "${draftObjective.trim()}"`, createdAt: new Date().toISOString() }, ...prev])
    }
    setEditingObjective(false)
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
    setAddingTask(false)
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

  const todoCount  = tasks.filter((t) => t.status === 'todo').length
  const doingCount = tasks.filter((t) => t.status === 'doing').length
  const doneCount  = tasks.filter((t) => t.status === 'done').length

  const STATUS_STYLE: Record<Task['status'], string> = {
    todo:  'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]',
    doing: 'bg-[rgba(29,78,216,0.12)] text-[#1d4ed8]',
    done:  'bg-[rgba(34,197,94,0.12)] text-[#16a34a]',
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">

        {/* Objective */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Objective</div>
            {!editingObjective && (
              <button
                onClick={() => { setDraftObjective(objective); setEditingObjective(true) }}
                className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition"
              >
                {objective ? 'Edit' : 'Set objective'}
              </button>
            )}
          </div>

          {editingObjective ? (
            <div className="mt-3 space-y-2">
              <textarea
                autoFocus
                rows={2}
                className="w-full resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#1d4ed8]"
                placeholder="Describe the goal for this cowork session…"
                value={draftObjective}
                onChange={(e) => setDraftObjective(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setObj() }}
              />
              <div className="flex gap-2">
                <button onClick={setObj} className="rounded-lg bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Set</button>
                <button onClick={() => setEditingObjective(false)} className="rounded-lg border border-[var(--color-border-tertiary)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">Cancel</button>
              </div>
            </div>
          ) : objective ? (
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-primary)]">{objective}</p>
          ) : (
            <div className="mt-2 rounded-xl border border-dashed border-[var(--color-border-secondary)] px-4 py-3 text-sm text-[var(--color-text-tertiary)]">
              No objective set. Click <span className="font-medium text-[var(--color-text-secondary)]">Set objective</span> to begin.
            </div>
          )}

          {objective && (
            <button
              onClick={() => void decompose()}
              disabled={decomposing}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:opacity-50"
            >
              {decomposing ? (
                <><span className="h-1.5 w-1.5 rounded-full bg-[#1d4ed8] animate-pulse" /> Decomposing…</>
              ) : (
                <><svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v4M6 11V7M1 6h4M11 6H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> AI decompose into tasks</>
              )}
            </button>
          )}
        </div>

        {/* Tasks */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Tasks</div>
              {tasks.length > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
                  <span>{todoCount} to do</span>
                  <span>·</span>
                  <span className="text-[#1d4ed8]">{doingCount} doing</span>
                  <span>·</span>
                  <span className="text-[#16a34a]">{doneCount} done</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {tasks.some((t) => t.agent && t.status !== 'done' && !t.running) && (
                <button
                  onClick={() => void runChain()}
                  className="flex items-center gap-1 rounded-lg bg-[#1d4ed8] px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[#1e40af]"
                  title="Run all assigned tasks in chain order"
                >
                  ⛓ Run chain
                </button>
              )}
              <button
                onClick={() => setAddingTask(true)}
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border-tertiary)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
              >
                + Add task
              </button>
            </div>
          </div>

          {addingTask && (
            <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3 space-y-2">
              <input
                autoFocus
                className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] placeholder:text-[var(--color-text-tertiary)]"
                placeholder="Task title…"
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setAddingTask(false) }}
              />
              <div className="flex gap-2">
                <button onClick={addTask} className="rounded-lg bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white">Add</button>
                <button onClick={() => setAddingTask(false)} className="rounded-lg border border-[var(--color-border-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">Cancel</button>
              </div>
            </div>
          )}

          {tasks.length === 0 && !addingTask ? (
            <div className="px-5 py-6 text-center text-sm text-[var(--color-text-tertiary)]">
              No tasks yet. Set an objective and use <strong className="text-[var(--color-text-secondary)]">AI decompose</strong>, or add tasks manually.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border-tertiary)]">
              {tasks.map((task) => (
                <div key={task.id} className="group">
                  <div className="flex items-center gap-3 px-5 py-3">
                    <button
                      onClick={() => cycleStatus(task.id)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${STATUS_STYLE[task.status]}`}
                      title="Click to cycle status"
                    >
                      {task.running ? (
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#1d4ed8] animate-pulse" />
                          running
                        </span>
                      ) : task.status}
                    </button>
                    <span className={`flex-1 text-sm ${task.status === 'done' ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}`}>
                      {task.title}
                    </span>
                    {/* Agent assign */}
                    <select
                      value={task.agent ?? ''}
                      onChange={(e) => e.target.value && assignAgent(task.id, e.target.value)}
                      className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] outline-none opacity-0 group-hover:opacity-100 transition"
                      title="Assign agent"
                    >
                      <option value="">Assign…</option>
                      {AGENT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    {task.agent && (
                      <span className="shrink-0 rounded-full bg-[rgba(29,78,216,0.10)] px-2 py-0.5 text-[10px] text-[#1d4ed8]">{task.agent}</span>
                    )}
                    {/* Chain-from selector */}
                    {tasks.filter((t) => t.id !== task.id && t.result).length > 0 && (
                      <select
                        value={task.inputFrom ?? ''}
                        onChange={(e) => setInputFrom(task.id, e.target.value || undefined)}
                        className="shrink-0 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 transition"
                        title="Chain input from a prior task result"
                      >
                        <option value="">chain from…</option>
                        {tasks.filter((t) => t.id !== task.id && t.result).map((t) => (
                          <option key={t.id} value={t.id}>{t.title.slice(0, 30)}</option>
                        ))}
                      </select>
                    )}
                    {task.inputFrom && (
                      <span className="shrink-0 rounded-full bg-[rgba(16,185,129,0.10)] px-2 py-0.5 text-[10px] text-[#059669]" title="Chains from prior task">⛓</span>
                    )}
                    {task.agent && !task.running && task.status !== 'done' && (
                      <button
                        onClick={() => void runTask(task)}
                        className="shrink-0 rounded-lg bg-[#1d4ed8] px-2.5 py-1 text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100 transition hover:bg-[#1e40af]"
                        title={`Run with ${task.agent}`}
                      >
                        Run
                      </button>
                    )}
                    <button
                      onClick={() => removeTask(task.id)}
                      className="shrink-0 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition hover:text-[#ef4444]"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                  {/* Agent result */}
                  {task.result && (
                    <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-5 py-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-[#1d4ed8]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#1d4ed8]" />
                        {task.agent}
                        {task.running && <span className="animate-pulse">…</span>}
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--color-text-primary)]">{task.result}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Decisions log */}
        {decisions.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Decision log</div>
            <div className="mt-3 space-y-2">
              {decisions.map((d) => (
                <div key={d.id} className="flex items-start gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1d4ed8]" />
                  <div>
                    <p className="text-xs text-[var(--color-text-primary)]">{d.text}</p>
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">{new Date(d.createdAt).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
