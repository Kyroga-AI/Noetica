/**
 * agent-loop.ts — the unified agentic generation loop.
 *
 * server.ts historically carried THREE near-identical copies of the tool loop (Ollama / Anthropic / OpenAI),
 * ~95% the same body diverging only in (a) provider message format, (b) the assistant/tool-result append shape,
 * and (c) two Ollama-only behaviors (inline tool-call parsing + divergence recovery). That triplication is why
 * frontier libs (best-of-n, self-consistency, council, plan-mode, planner-executor, constrained-decode,
 * multi-agent) were wired zero or one times instead of once-for-all.
 *
 * This module hoists the shared body into ONE `runAgentLoop`, behind a `ProviderAdapter` that owns only the
 * provider-specific format. The loop owns turn accounting, streaming, tool dispatch, trajectory recording, and
 * divergence recovery. The dormant libs then attach at three named seams (see SEAM markers below), each ONCE.
 *
 * STATUS: scaffolding (Step 0 of the migration) — defined + typechecked, not yet wired into server.ts. The
 * three provider branches in server.ts are converted to adapters one at a time (OpenAI → Anthropic → Ollama),
 * each verified for behavioral equivalence before the next. Until then nothing imports this file.
 */

/** A normalized tool call — provider-agnostic (matches server.ts ToolUseBlock structurally). */
export interface ToolUseBlock {
  id: string
  name: string
  input: Record<string, unknown>
}

/** The normalized streaming event every provider's stream*() already yields. */
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_calls'; calls: ToolUseBlock[] }

/** A tool execution result, ready for the adapter to format into provider-native shape. */
export interface ToolResult {
  id: string
  name: string
  result: string
}

/**
 * Provider-specific format owner. Each implementation (OllamaAdapter / AnthropicAdapter / OpenAIAdapter) closes
 * over its model/keys/tools and privately owns its message buffer — the loop never sees provider message shapes.
 */
export interface ProviderAdapter {
  /** Build the initial provider-native history from incoming messages + system prompt. Called once. */
  init(): void
  /** Stream one assistant turn, normalized to ProviderEvent (already true of all three stream*() fns today). */
  streamTurn(): AsyncGenerator<ProviderEvent>
  /** Append the assistant turn + the executed tool results, in provider-native shape. */
  appendToolTurn(assistantText: string, calls: ToolUseBlock[], results: ToolResult[]): void
  /** Append a corrective tool-result WITHOUT a real execution (divergence nudge). */
  appendNudge(assistantText: string, calls: ToolUseBlock[], note: string): void
  /** Ollama-only: recover structured calls from a local model that emitted JSON-as-text. Cloud: omit. */
  parseInlineToolCalls?(text: string): { calls: ToolUseBlock[]; cleaned: string }
  /** Whether to hold back streamed text that looks like a raw tool call (Ollama true, cloud false). */
  readonly suppressInlineToolText: boolean
  /** Whether to run divergence recovery (nudge/give-up on repeated identical calls). Ollama had this; cloud
   * providers did NOT — keep it false for them during migration to preserve exact behavioral equivalence, then
   * it can be enabled fleet-wide as a separate reviewable change (it's a cheap pathological-loop guard). */
  readonly enableDivergenceRecovery: boolean
}

/** Everything the loop needs from the host (server.ts) without importing it — keeps this module dependency-free. */
export interface LoopCtx {
  maxTurns: number
  /** Execute a tool (server.ts executeToolWithTimeout), returning its text result. */
  executeTool(name: string, input: Record<string, unknown>): Promise<string>
  /** Emit an SSE event to the client. */
  sse(event: string, data: Record<string, unknown>): void
  /** Record tool calls for the trajectory monitor (best-effort; may be async). */
  recordTrajectory(calls: ToolUseBlock[]): void | Promise<void>
  /** Optional: schema-coerce a tool call's args before execution (constrained-decode). Returns coerced args
   * (e.g. the string "5" → number 5 for a numeric param). Applied to BOTH the executed call and the recorded
   * history so they stay consistent. A no-op for already-well-typed args (cloud); fixes local-model arg types. */
  coerceToolInput?(name: string, input: Record<string, unknown>): Record<string, unknown>
  /** Called for each streamed text delta so the host can accumulate its live buffer. */
  onDelta?(text: string): void
  /** Called for each streamed thinking delta. */
  onThinkingDelta?(text: string): void
  /** Optional autonomy gate (autonomy-gate.ts): consulted per tool-call before execution. A denied
   * verdict short-circuits execution and returns a governed refusal as the tool result (fail-closed),
   * so the model sees the refusal and can adapt rather than the action silently running. */
  autonomyGate?(call: ToolUseBlock): { allowed: boolean; reason: string }
}

/** What the loop returns to the host to fold into its final response + governance epilogue. */
export interface LoopResult {
  content: string
  thinking: string
  lastToolCalls: ToolUseBlock[] | undefined
  turns: number
}

const TOOL_CALL_ONSET = /<tool_call|```|^\s*\{/i

/**
 * The single, provider-agnostic agentic loop. Replaces the three hand-copied loops in server.ts. Owns: turn
 * accounting, text/thinking streaming (with Ollama-style inline-call suppression), inline-call recovery, tool
 * dispatch, trajectory recording, and divergence recovery (now uniform across ALL providers — it was Ollama-only).
 */
export async function runAgentLoop(adapter: ProviderAdapter, ctx: LoopCtx): Promise<LoopResult> {
  adapter.init()

  let fullContent = ''
  let fullThinking = ''
  let lastToolCalls: ToolUseBlock[] | undefined
  const toolSeen = new Map<string, number>()
  let nudges = 0
  let turn = 0

  for (; turn < ctx.maxTurns; turn++) {
    let turnContent = ''
    let streamedLen = 0
    let suppressed = false
    let calls: ToolUseBlock[] | undefined

    for await (const ev of adapter.streamTurn()) {
      if (ev.type === 'text') {
        turnContent += ev.text
        // Look-back window matches the original Ollama loop exactly (incl. the `streamedLen ? … : 0` form).
        const window = turnContent.slice(streamedLen ? streamedLen - 16 : 0)
        if (adapter.suppressInlineToolText && !suppressed && TOOL_CALL_ONSET.test(window)) {
          suppressed = true // hold back — this might be a raw tool call the local model is emitting as text
        } else if (!suppressed) {
          ctx.onDelta?.(ev.text)
          ctx.sse('delta', { delta: ev.text })
          streamedLen = turnContent.length
        }
      } else if (ev.type === 'thinking') {
        fullThinking += ev.text
        ctx.onThinkingDelta?.(ev.text)
        ctx.sse('thinking_delta', { delta: ev.text })
      } else if (ev.type === 'tool_calls') {
        calls = ev.calls
      }
    }

    // Recover inline tool calls (Ollama local models) when no structured calls arrived.
    let assistantText = turnContent
    if (!calls?.length && adapter.parseInlineToolCalls) {
      const parsed = adapter.parseInlineToolCalls(turnContent)
      if (parsed.calls.length) {
        calls = parsed.calls
        assistantText = parsed.cleaned
      } else if (suppressed) {
        // We held text back expecting a tool call that never materialized — flush the remainder now.
        const rest = turnContent.slice(streamedLen)
        if (rest) { ctx.onDelta?.(rest); ctx.sse('delta', { delta: rest }) }
      }
    }

    fullContent += assistantText
    if (!calls?.length) break

    // ── Divergence recovery: if every call repeats a prior one, nudge; give up at 3. Gated per-adapter so cloud
    // providers (which never had this) stay byte-equivalent during migration.
    if (adapter.enableDivergenceRecovery) {
      const sig = (tc: ToolUseBlock) => `${tc.name}:${JSON.stringify(tc.input)}`
      const allRepeated = calls.every((tc) => (toolSeen.get(sig(tc)) ?? 0) >= 2)
      for (const tc of calls) toolSeen.set(sig(tc), (toolSeen.get(sig(tc)) ?? 0) + 1)
      if (allRepeated) {
        if (++nudges >= 3) {
          const note = '\n\n_(Stopped — repeated the same tool call without making progress.)_'
          fullContent += note
          ctx.onDelta?.(note)
          ctx.sse('delta', { delta: note })
          break
        }
        adapter.appendNudge(assistantText, calls, 'You already ran that exact tool call and it did not move the task forward. Try a different tool or different arguments.')
        continue
      }
    }

    // SEAM (per-tool-call): constrained-decode — schema-coerce args before execution, once, for all providers.
    // Coerce in-place so the streamed tool_calls event, the execution, and the recorded history all agree.
    if (ctx.coerceToolInput) {
      const fn = ctx.coerceToolInput
      calls = calls.map((tc) => ({ ...tc, input: fn(tc.name, tc.input) }))
    }
    ctx.sse('tool_calls', { tool_calls: calls })
    lastToolCalls = calls
    void ctx.recordTrajectory(calls)

    const results: ToolResult[] = await Promise.all(
      calls.map(async (tc) => {
        // SEAM (per-tool-call): autonomy gate — fail closed before execution.
        if (ctx.autonomyGate) {
          const verdict = ctx.autonomyGate(tc)
          if (!verdict.allowed) {
            ctx.sse('autonomy_blocked', { tool: tc.name, reason: verdict.reason })
            return { id: tc.id, name: tc.name, result: `AUTONOMY BLOCKED: ${verdict.reason}` }
          }
        }
        return { id: tc.id, name: tc.name, result: await ctx.executeTool(tc.name, tc.input) }
      }),
    )
    adapter.appendToolTurn(assistantText, calls, results)
  }

  return { content: fullContent, thinking: fullThinking, lastToolCalls, turns: turn }
}
