'use client'

import { useCallback, useRef, useState } from 'react'
import { invokeTauri, isTauri } from '@/lib/tauri/bridge'
import { planGoal, fetchUiHints } from './planner'
import type { Plan, SubTask } from './planner'
import { saveTrace, getRelevantTraces } from './memory'

export type ComputerUseStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'error'
  | 'done'

export type CUProvider = 'anthropic' | 'openai'

export interface ComputerAction {
  // Unified action format (translated to provider-specific format at call time)
  action_type: 'screenshot' | 'left_click' | 'right_click' | 'double_click' | 'mouse_move' | 'type' | 'key' | 'scroll' | 'drag' | 'wait'
  x?: number
  y?: number
  text?: string
  key?: string         // e.g. "Return", "ctrl+c"
  scroll_x?: number
  scroll_y?: number
  drag_path?: Array<{ x: number; y: number }>
}

export interface ComputerStep {
  id: string
  type: 'screenshot' | 'thinking' | 'action' | 'text' | 'error' | 'plan' | 'subtask'
  content: string
  action?: ComputerAction
  approved?: boolean
  subTaskId?: string
  timestamp: string
}

// ─── OpenAI Responses API types ───────────────────────────────────────────────

interface OAIComputerCallAction {
  type: string
  button?: string
  x?: number
  y?: number
  text?: string
  keys?: string[]
  path?: Array<{ x: number; y: number }>
  scroll_x?: number
  scroll_y?: number
}

interface OAIResponseOutput {
  type: 'reasoning' | 'computer_call' | 'text' | 'message'
  id?: string
  call_id?: string
  action?: OAIComputerCallAction
  content?: string | Array<{ type: string; text?: string }>
  summary?: Array<{ type: string; text?: string }>
  pending_safety_checks?: Array<{ id: string; code: string; message: string }>
}

function nowIso() { return new Date().toISOString() }

// Convert OpenAI action to our unified format
function oaiActionToUnified(a: OAIComputerCallAction): ComputerAction {
  const t = a.type
  if (t === 'screenshot') return { action_type: 'screenshot' }
  if (t === 'click')       return { action_type: a.button === 'right' ? 'right_click' : 'left_click', x: a.x, y: a.y }
  if (t === 'double_click') return { action_type: 'double_click', x: a.x, y: a.y }
  if (t === 'move')        return { action_type: 'mouse_move', x: a.x, y: a.y }
  if (t === 'type')        return { action_type: 'type', text: a.text }
  if (t === 'key')         return { action_type: 'key', key: a.keys?.join('+') }
  if (t === 'scroll')      return { action_type: 'scroll', x: a.x, y: a.y, scroll_x: a.scroll_x, scroll_y: a.scroll_y }
  if (t === 'drag')        return { action_type: 'drag', drag_path: a.path }
  if (t === 'wait')        return { action_type: 'wait' }
  return { action_type: 'screenshot' }
}

// Convert unified action to Anthropic computer_20241022 format
function toAnthropicAction(a: ComputerAction): Record<string, unknown> {
  if (a.action_type === 'screenshot')   return { action: 'screenshot' }
  if (a.action_type === 'left_click')   return { action: 'left_click',   coordinate: [a.x, a.y] }
  if (a.action_type === 'right_click')  return { action: 'right_click',  coordinate: [a.x, a.y] }
  if (a.action_type === 'double_click') return { action: 'double_click', coordinate: [a.x, a.y] }
  if (a.action_type === 'mouse_move')   return { action: 'mouse_move',   coordinate: [a.x, a.y] }
  if (a.action_type === 'type')         return { action: 'type',         text: a.text }
  if (a.action_type === 'key')          return { action: 'key',          text: a.key }
  if (a.action_type === 'scroll')       return { action: 'scroll',       coordinate: [a.x, a.y], direction: (a.scroll_y ?? 0) > 0 ? 'down' : 'up', amount: Math.abs(a.scroll_y ?? 1) }
  return { action: 'screenshot' }
}

export function describeAction(a: ComputerAction): string {
  switch (a.action_type) {
    case 'left_click':   return `Click (${a.x}, ${a.y})`
    case 'right_click':  return `Right-click (${a.x}, ${a.y})`
    case 'double_click': return `Double-click (${a.x}, ${a.y})`
    case 'mouse_move':   return `Move mouse to (${a.x}, ${a.y})`
    case 'type':         return `Type: "${(a.text ?? '').slice(0, 60)}${(a.text ?? '').length > 60 ? '…' : ''}"`
    case 'key':          return `Key: ${a.key}`
    case 'scroll':       return `Scroll at (${a.x}, ${a.y}) by (${a.scroll_x ?? 0}, ${a.scroll_y ?? 0})`
    case 'drag':         return `Drag ${a.drag_path?.length ?? 0} waypoints`
    case 'wait':         return 'Wait'
    case 'screenshot':   return 'Screenshot'
    default:             return String(a.action_type)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface Options {
  anthropicApiKey: string
  openaiApiKey?: string
  provider?: CUProvider
  modelId?: string
  useHierarchicalPlanning?: boolean
}

export function useComputerUse({
  anthropicApiKey,
  openaiApiKey,
  provider = 'anthropic',
  modelId,
  useHierarchicalPlanning = true,
}: Options) {
  const [status, setStatus] = useState<ComputerUseStatus>('idle')
  const [steps, setSteps] = useState<ComputerStep[]>([])
  const [plan, setPlan]   = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<ComputerStep | null>(null)
  const abortRef = useRef(false)
  // OpenAI stateful response chaining
  const prevResponseIdRef = useRef<string | null>(null)

  const isSupported = isTauri()

  const effectiveModel = modelId ?? (provider === 'anthropic' ? 'claude-opus-4-8' : 'computer-use-preview')
  const apiKey = provider === 'anthropic' ? anthropicApiKey : (openaiApiKey ?? '')

  function addStep(step: Omit<ComputerStep, 'id' | 'timestamp'>): ComputerStep {
    const full: ComputerStep = { ...step, id: crypto.randomUUID(), timestamp: nowIso() }
    setSteps((prev) => [...prev, full])
    return full
  }

  function updateStep(id: string, patch: Partial<ComputerStep>) {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s))
  }

  async function screenshot(): Promise<string | null> {
    const b64 = await invokeTauri<string>('take_screenshot')
    if (!b64) return null
    addStep({ type: 'screenshot', content: b64 })
    return b64
  }

  // Wait for a step's approved field to be set (polling)
  async function waitForApproval(stepId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const interval = setInterval(() => {
        if (abortRef.current) { clearInterval(interval); resolve(false); return }
        setSteps((prev) => {
          const found = prev.find((s) => s.id === stepId)
          if (found?.approved !== undefined) {
            clearInterval(interval)
            resolve(found.approved === true)
          }
          return prev
        })
      }, 100)
    })
  }

  // ── Anthropic loop (single sub-task) ──────────────────────────────────────

  async function runAnthropicSubTask(instruction: string, subTaskId?: string): Promise<boolean> {
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

    // Build initial message with screenshot + instruction
    const initialShot = await screenshot()
    if (!initialShot) {
      setError('Screenshot failed — check Screen Recording permission.')
      return false
    }

    // Anthropic stateless: rebuild full history each turn
    type AMsg = { role: 'user' | 'assistant'; content: unknown }
    const history: AMsg[] = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: initialShot } },
        { type: 'text', text: instruction },
      ],
    }]

    for (let turn = 0; turn < 30 && !abortRef.current; turn++) {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'computer-use-2024-10-22',
        },
        body: JSON.stringify({
          model: effectiveModel,
          max_tokens: 1024,
          tools: [{
            type: 'computer_20241022',
            name: 'computer',
            display_width_px: 1440,
            display_height_px: 900,
            display_number: 1,
          }],
          messages: history,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        setError(`Anthropic API ${res.status}: ${body.slice(0, 200)}`)
        return false
      }

      const data = await res.json() as {
        stop_reason: string
        content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; id?: string }>
      }

      // Collect assistant content for history
      const assistantContent: unknown[] = []
      let hasToolUse = false

      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          addStep({ type: 'text', content: block.text, subTaskId })
          assistantContent.push({ type: 'text', text: block.text })
        }
        if (block.type === 'tool_use' && block.name === 'computer' && block.input) {
          const rawAction = block.input as Record<string, unknown>
          const action = unifiedFromAnthropicInput(rawAction)
          hasToolUse = true
          assistantContent.push({ type: 'tool_use', id: block.id, name: 'computer', input: rawAction })

          if (action.action_type === 'screenshot') {
            const shot = await invokeTauri<string>('take_screenshot')
            if (shot) {
              addStep({ type: 'screenshot', content: shot, subTaskId })
              history.push({ role: 'assistant', content: assistantContent.slice() })
              history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot } }] }] })
              assistantContent.length = 0
            }
          } else {
            const step = addStep({ type: 'action', content: describeAction(action), action, subTaskId })
            setPendingAction(step)
            setStatus('awaiting_approval')

            const approved = await waitForApproval(step.id)
            if (!approved || abortRef.current) return false

            await invokeTauri('execute_computer_action', { action })
            setStatus('running')

            const shot = await invokeTauri<string>('take_screenshot')
            const shotB64 = shot ?? ''
            if (shot) addStep({ type: 'screenshot', content: shot, subTaskId })

            history.push({ role: 'assistant', content: assistantContent.slice() })
            history.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: block.id,
                content: shot
                  ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shotB64 } }]
                  : [{ type: 'text', text: 'Action executed.' }],
              }],
            })
            assistantContent.length = 0
          }
        }
      }

      if (assistantContent.length) history.push({ role: 'assistant', content: assistantContent })

      if (!hasToolUse || data.stop_reason === 'end_turn') break
    }

    return true
  }

  // ── OpenAI Responses API loop (single sub-task) ───────────────────────────

  async function runOpenAISubTask(instruction: string, subTaskId?: string): Promise<boolean> {
    const RESPONSES_URL = 'https://api.openai.com/v1/responses'

    // Initial screenshot
    const initialShot = await screenshot()
    if (!initialShot) {
      setError('Screenshot failed — check Screen Recording permission.')
      return false
    }

    prevResponseIdRef.current = null

    const computerTool = {
      type: 'computer_use_preview',
      display_width: 1440,
      display_height: 900,
      environment: 'mac',
    }

    // First request: goal + initial screenshot
    let inputItems: unknown[] = [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/png;base64,${initialShot}` },
          { type: 'input_text',  text: instruction },
        ],
      },
    ]

    for (let turn = 0; turn < 30 && !abortRef.current; turn++) {
      const body: Record<string, unknown> = {
        model: effectiveModel,
        tools: [computerTool],
        input: inputItems,
        truncation: 'auto',
      }
      if (prevResponseIdRef.current) {
        body['previous_response_id'] = prevResponseIdRef.current
        // With stateful chaining, only send new items after first turn
      }

      const res = await fetch(RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'computer-use-preview',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const b = await res.text()
        setError(`OpenAI API ${res.status}: ${b.slice(0, 200)}`)
        return false
      }

      const data = await res.json() as { id: string; output: OAIResponseOutput[] }
      prevResponseIdRef.current = data.id

      let hasComputerCall = false
      const nextInputItems: unknown[] = []

      for (const item of data.output) {
        if (item.type === 'reasoning' && item.summary?.length) {
          const text = item.summary.map((s) => s.text).filter(Boolean).join(' ')
          if (text) addStep({ type: 'thinking', content: text, subTaskId })
        }

        if (item.type === 'text' || item.type === 'message') {
          const text = typeof item.content === 'string'
            ? item.content
            : Array.isArray(item.content)
              ? item.content.map((c) => c.text).filter(Boolean).join('')
              : ''
          if (text) addStep({ type: 'text', content: text, subTaskId })
        }

        if (item.type === 'computer_call' && item.action && item.call_id) {
          hasComputerCall = true
          const action = oaiActionToUnified(item.action)

          // Acknowledge safety checks (auto-approve for local env)
          const safetyChecks = item.pending_safety_checks?.map((c) => ({
            id: c.id,
            code: c.code,
            message: c.message,
          })) ?? []

          if (action.action_type === 'screenshot') {
            const shot = await invokeTauri<string>('take_screenshot')
            if (shot) {
              addStep({ type: 'screenshot', content: shot, subTaskId })
              nextInputItems.push({
                type: 'computer_call_output',
                call_id: item.call_id,
                acknowledged_safety_checks: safetyChecks,
                output: { type: 'input_image', image_url: `data:image/png;base64,${shot}` },
              })
            }
          } else {
            const step = addStep({ type: 'action', content: describeAction(action), action, subTaskId })
            setPendingAction(step)
            setStatus('awaiting_approval')

            const approved = await waitForApproval(step.id)
            if (!approved || abortRef.current) return false

            await invokeTauri('execute_computer_action', { action })
            setStatus('running')

            const shot = await invokeTauri<string>('take_screenshot')
            if (shot) addStep({ type: 'screenshot', content: shot, subTaskId })

            nextInputItems.push({
              type: 'computer_call_output',
              call_id: item.call_id,
              acknowledged_safety_checks: safetyChecks,
              output: shot
                ? { type: 'input_image', image_url: `data:image/png;base64,${shot}` }
                : { type: 'input_text', text: 'Action executed.' },
            })
          }
        }
      }

      if (!hasComputerCall) break
      // Next turn: only the tool results
      inputItems = nextInputItems
    }

    return true
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  const startSession = useCallback(async (goal: string) => {
    if (!goal.trim() || !apiKey) return
    abortRef.current = false
    prevResponseIdRef.current = null
    setStatus('planning')
    setError(null)
    setSteps([])
    setPlan(null)
    setPendingAction(null)

    let currentPlan: Plan

    if (useHierarchicalPlanning) {
      // Retrieve relevant past episodes
      const pastTraces = getRelevantTraces(goal)
      const memoryContext = pastTraces.length
        ? pastTraces.map((t) => `- ${t.goal}: ${t.stepSummary} (${t.succeeded ? 'succeeded' : 'failed'})`).join('\n')
        : ''

      try {
        currentPlan = await planGoal(
          goal,
          provider === 'anthropic' ? anthropicApiKey : (openaiApiKey ?? ''),
          provider,
          provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o',  // use a faster model for planning
          memoryContext
        )
      } catch (err) {
        // Planning failed — fall back to single-step execution
        currentPlan = {
          goal,
          reasoning: 'Fallback: executing goal directly.',
          createdAt: nowIso(),
          subTasks: [{
            id: crypto.randomUUID(),
            title: goal,
            instruction: goal,
            appContext: 'unknown',
            done: false,
            failed: false,
          }],
        }
      }

      setPlan(currentPlan)
      addStep({ type: 'plan', content: currentPlan.reasoning })
    } else {
      currentPlan = {
        goal,
        reasoning: '',
        createdAt: nowIso(),
        subTasks: [{
          id: crypto.randomUUID(),
          title: goal,
          instruction: goal,
          appContext: 'unknown',
          done: false,
          failed: false,
        }],
      }
    }

    setStatus('running')

    // Execute each sub-task in order
    let allSucceeded = true
    const taskResults: string[] = []

    for (const subTask of currentPlan.subTasks) {
      if (abortRef.current) break

      addStep({ type: 'subtask', content: `▶ ${subTask.title}${subTask.appContext !== 'unknown' ? ` — ${subTask.appContext}` : ''}`, subTaskId: subTask.id })

      // Optionally augment with web-searched UI hints
      let instruction = subTask.instruction
      if (subTask.webSearchQuery) {
        const hints = await fetchUiHints(subTask.webSearchQuery).catch(() => '')
        if (hints) instruction += `\n\nUI Reference:\n${hints}`
      }

      const succeeded = provider === 'anthropic'
        ? await runAnthropicSubTask(instruction, subTask.id)
        : await runOpenAISubTask(instruction, subTask.id)

      setPlan((prev) => prev ? {
        ...prev,
        subTasks: prev.subTasks.map((t) => t.id === subTask.id
          ? { ...t, done: true, failed: !succeeded }
          : t
        ),
      } : prev)

      taskResults.push(`${subTask.title}: ${succeeded ? 'done' : 'failed'}`)
      if (!succeeded) { allSucceeded = false; break }
    }

    // Save episodic trace
    const appContext = currentPlan.subTasks.map((t) => t.appContext).join(', ')
    saveTrace({
      goal,
      appContext,
      stepSummary: taskResults.join('; '),
      succeeded: allSucceeded,
    })

    if (!abortRef.current) setStatus('done')
  }, [anthropicApiKey, openaiApiKey, provider, effectiveModel, useHierarchicalPlanning]) // eslint-disable-line react-hooks/exhaustive-deps

  function approveAction(stepId: string) {
    updateStep(stepId, { approved: true })
    setPendingAction(null)
  }

  function rejectAction(stepId: string) {
    updateStep(stepId, { approved: false })
    setPendingAction(null)
    abortRef.current = true
    setStatus('done')
  }

  function stopSession() {
    abortRef.current = true
    setPendingAction(null)
    setStatus('idle')
  }

  function reset() {
    abortRef.current = true
    prevResponseIdRef.current = null
    setSteps([])
    setPlan(null)
    setPendingAction(null)
    setError(null)
    setStatus('idle')
  }

  return {
    status, steps, plan, error, pendingAction, isSupported,
    startSession, stopSession, reset,
    approveAction, rejectAction,
  }
}

// Convert Anthropic computer_20241022 input to unified action
function unifiedFromAnthropicInput(input: Record<string, unknown>): ComputerAction {
  const action = input['action'] as string
  const coord = input['coordinate'] as [number, number] | undefined
  if (action === 'screenshot')   return { action_type: 'screenshot' }
  if (action === 'left_click')   return { action_type: 'left_click',   x: coord?.[0], y: coord?.[1] }
  if (action === 'right_click')  return { action_type: 'right_click',  x: coord?.[0], y: coord?.[1] }
  if (action === 'double_click') return { action_type: 'double_click', x: coord?.[0], y: coord?.[1] }
  if (action === 'mouse_move')   return { action_type: 'mouse_move',   x: coord?.[0], y: coord?.[1] }
  if (action === 'type')         return { action_type: 'type',  text: input['text'] as string }
  if (action === 'key')          return { action_type: 'key',   key: input['text'] as string }
  if (action === 'scroll') {
    return {
      action_type: 'scroll',
      x: coord?.[0], y: coord?.[1],
      scroll_y: input['direction'] === 'down' ? Number(input['amount'] ?? 1) : -Number(input['amount'] ?? 1),
    }
  }
  return { action_type: 'screenshot' }
}
