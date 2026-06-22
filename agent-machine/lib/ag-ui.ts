/**
 * ag-ui.ts — conformance with the AG-UI Agent-User Interaction Protocol (ag-ui.com; CopilotKit + LangGraph/
 * CrewAI/Mastra/ADK, ~16 typed events). Standardizes the agent↔frontend contract (streaming, tool-call
 * rendering, state sync) we previously did bespoke — making the Noetica mesh interoperable with the whole
 * AG-UI ecosystem, with zero cloud coupling (transport can be local Tauri IPC or our local HTTP SSE).
 *
 * This module is the protocol layer: typed events + factories + a run-sequence builder + SSE formatter +
 * validation. The agent loop emits these; the React side consumes via @ag-ui/client (next integration step).
 */
export type AGUIEventType =
  | 'RUN_STARTED' | 'RUN_FINISHED' | 'RUN_ERROR'
  | 'STEP_STARTED' | 'STEP_FINISHED'
  | 'TEXT_MESSAGE_START' | 'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START' | 'TOOL_CALL_ARGS' | 'TOOL_CALL_END' | 'TOOL_CALL_RESULT'
  | 'STATE_SNAPSHOT' | 'STATE_DELTA' | 'MESSAGES_SNAPSHOT'
  | 'RAW' | 'CUSTOM'

export interface AGUIEvent { type: AGUIEventType; [k: string]: unknown }
export interface JsonPatchOp { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }

// ── lifecycle ──
export const runStarted = (threadId: string, runId: string): AGUIEvent => ({ type: 'RUN_STARTED', threadId, runId })
export const runFinished = (threadId: string, runId: string): AGUIEvent => ({ type: 'RUN_FINISHED', threadId, runId })
export const runError = (message: string, code?: string): AGUIEvent => ({ type: 'RUN_ERROR', message, ...(code ? { code } : {}) })
export const stepStarted = (stepName: string): AGUIEvent => ({ type: 'STEP_STARTED', stepName })
export const stepFinished = (stepName: string): AGUIEvent => ({ type: 'STEP_FINISHED', stepName })

// ── text messages ──
export const textMessageStart = (messageId: string, role: 'assistant' | 'user' = 'assistant'): AGUIEvent => ({ type: 'TEXT_MESSAGE_START', messageId, role })
export const textMessageContent = (messageId: string, delta: string): AGUIEvent => ({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta })
export const textMessageEnd = (messageId: string): AGUIEvent => ({ type: 'TEXT_MESSAGE_END', messageId })

// ── tool calls ──
export const toolCallStart = (toolCallId: string, toolCallName: string, parentMessageId?: string): AGUIEvent => ({ type: 'TOOL_CALL_START', toolCallId, toolCallName, ...(parentMessageId ? { parentMessageId } : {}) })
export const toolCallArgs = (toolCallId: string, delta: string): AGUIEvent => ({ type: 'TOOL_CALL_ARGS', toolCallId, delta })
export const toolCallEnd = (toolCallId: string): AGUIEvent => ({ type: 'TOOL_CALL_END', toolCallId })
export const toolCallResult = (messageId: string, toolCallId: string, content: string): AGUIEvent => ({ type: 'TOOL_CALL_RESULT', messageId, toolCallId, content })

// ── state sync ──
export const stateSnapshot = (snapshot: unknown): AGUIEvent => ({ type: 'STATE_SNAPSHOT', snapshot })
export const stateDelta = (delta: JsonPatchOp[]): AGUIEvent => ({ type: 'STATE_DELTA', delta })
export const custom = (name: string, value: unknown): AGUIEvent => ({ type: 'CUSTOM', name, value })

const REQUIRED: Partial<Record<AGUIEventType, string[]>> = {
  RUN_STARTED: ['threadId', 'runId'], RUN_FINISHED: ['threadId', 'runId'], RUN_ERROR: ['message'],
  TEXT_MESSAGE_START: ['messageId', 'role'], TEXT_MESSAGE_CONTENT: ['messageId', 'delta'], TEXT_MESSAGE_END: ['messageId'],
  TOOL_CALL_START: ['toolCallId', 'toolCallName'], TOOL_CALL_ARGS: ['toolCallId', 'delta'], TOOL_CALL_END: ['toolCallId'],
  TOOL_CALL_RESULT: ['messageId', 'toolCallId', 'content'], STATE_SNAPSHOT: ['snapshot'], STATE_DELTA: ['delta'],
}

/** Validate an event against the AG-UI required-field contract. */
export function isValidEvent(e: AGUIEvent): boolean {
  if (!e || typeof e.type !== 'string') return false
  const req = REQUIRED[e.type] ?? []
  return req.every((k) => e[k] !== undefined)
}

/** SSE frame for an AG-UI event (plain data frame; the type lives inside the JSON). */
export function toSSE(event: AGUIEvent): string { return `data: ${JSON.stringify(event)}\n\n` }

/** Build a conformant event sequence for a text run (optionally streamed in chunks). */
export function buildTextRun(threadId: string, runId: string, messageId: string, chunks: string[]): AGUIEvent[] {
  return [
    runStarted(threadId, runId),
    textMessageStart(messageId),
    ...chunks.map((c) => textMessageContent(messageId, c)),
    textMessageEnd(messageId),
    runFinished(threadId, runId),
  ]
}

/** Order invariant check: a well-formed run starts/ends once and properly brackets BOTH messages AND tool
 * calls (START before ARGS/END; no duplicate START; no second RUN_STARTED). */
export function isWellFormedRun(events: AGUIEvent[]): boolean {
  if (events.length < 2) return false
  if (events[0]!.type !== 'RUN_STARTED') return false
  const last = events[events.length - 1]!.type
  if (last !== 'RUN_FINISHED' && last !== 'RUN_ERROR') return false
  const openMsgs = new Set<string>(); const openTools = new Set<string>()
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isValidEvent(e)) return false
    if (e.type === 'RUN_STARTED' && i > 0) return false   // exactly one, at the start
    switch (e.type) {
      case 'TEXT_MESSAGE_START': { const id = e['messageId'] as string; if (openMsgs.has(id)) return false; openMsgs.add(id); break }
      case 'TEXT_MESSAGE_CONTENT': if (!openMsgs.has(e['messageId'] as string)) return false; break
      case 'TEXT_MESSAGE_END': { const id = e['messageId'] as string; if (!openMsgs.has(id)) return false; openMsgs.delete(id); break }
      case 'TOOL_CALL_START': { const id = e['toolCallId'] as string; if (openTools.has(id)) return false; openTools.add(id); break }
      case 'TOOL_CALL_ARGS': if (!openTools.has(e['toolCallId'] as string)) return false; break
      case 'TOOL_CALL_END': { const id = e['toolCallId'] as string; if (!openTools.has(id)) return false; openTools.delete(id); break }
      default: break
    }
  }
  return openMsgs.size === 0 && openTools.size === 0
}
