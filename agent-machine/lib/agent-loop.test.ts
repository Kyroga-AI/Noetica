import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgentLoop, type ProviderAdapter, type ProviderEvent, type ToolUseBlock, type ToolResult, type LoopCtx } from './agent-loop.js'

// A scriptable adapter: `turns` is a list of event-arrays, one per streamTurn() call.
function makeAdapter(turns: ProviderEvent[][], opts: Partial<ProviderAdapter> = {}): ProviderAdapter & { appended: unknown[]; nudges: unknown[] } {
  let i = 0
  const appended: unknown[] = []
  const nudges: unknown[] = []
  return {
    appended, nudges,
    suppressInlineToolText: opts.suppressInlineToolText ?? false,
    enableDivergenceRecovery: opts.enableDivergenceRecovery ?? false,
    parseInlineToolCalls: opts.parseInlineToolCalls,
    init() { /* no-op */ },
    async *streamTurn() { const evs = turns[i++] ?? []; for (const e of evs) yield e },
    appendToolTurn(text: string, calls: ToolUseBlock[], results: ToolResult[]) { appended.push({ text, calls, results }) },
    appendNudge(text: string, calls: ToolUseBlock[], note: string) { nudges.push({ text, calls, note }) },
  }
}

function makeCtx(over: Partial<LoopCtx> = {}): LoopCtx & { deltas: string[]; executed: string[] } {
  const deltas: string[] = []
  const executed: string[] = []
  return {
    deltas, executed,
    maxTurns: 8,
    async executeTool(name, input) { executed.push(`${name}:${JSON.stringify(input)}`); return `result-of-${name}` },
    sse() { /* no-op */ },
    recordTrajectory() { /* no-op */ },
    onDelta(t) { deltas.push(t) },
    ...over,
  }
}

test('accumulates text deltas into content and stops when no tool calls', async () => {
  const adapter = makeAdapter([[{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }]])
  const ctx = makeCtx()
  const r = await runAgentLoop(adapter, ctx)
  assert.equal(r.content, 'Hello world')
  assert.equal(r.turns, 0)
  assert.deepEqual(ctx.deltas, ['Hello ', 'world'])
  assert.equal(ctx.executed.length, 0)
})

test('structured tool_calls trigger one execution per call, then a follow-up turn', async () => {
  const call: ToolUseBlock = { id: 't1', name: 'web_search', input: { q: 'noetica' } }
  const adapter = makeAdapter([
    [{ type: 'text', text: 'searching' }, { type: 'tool_calls', calls: [call] }],
    [{ type: 'text', text: 'done' }],
  ])
  const ctx = makeCtx()
  const r = await runAgentLoop(adapter, ctx)
  assert.deepEqual(ctx.executed, ['web_search:{"q":"noetica"}'])
  assert.equal(adapter.appended.length, 1)
  assert.equal((adapter.appended[0] as { results: ToolResult[] }).results[0]!.result, 'result-of-web_search')
  assert.equal(r.content, 'searchingdone')
  assert.deepEqual(r.lastToolCalls, [call])
})

test('Ollama-style inline tool-call recovery: JSON-as-text becomes a real call', async () => {
  const call: ToolUseBlock = { id: 'inline', name: 'read_file', input: { path: '/tmp/x' } }
  const adapter = makeAdapter(
    [
      [{ type: 'text', text: '{"tool":"read_file"...}' }], // model emitted a call as text, no structured event
      [{ type: 'text', text: 'answer' }],
    ],
    {
      suppressInlineToolText: true,
      parseInlineToolCalls: (text) => text.includes('read_file') ? { calls: [call], cleaned: '' } : { calls: [], cleaned: text },
    },
  )
  const ctx = makeCtx()
  await runAgentLoop(adapter, ctx)
  assert.deepEqual(ctx.executed, ['read_file:{"path":"/tmp/x"}'])
})

test('divergence recovery: nudges on repeated calls, gives up after 3 nudges', async () => {
  const call: ToolUseBlock = { id: 'r', name: 'web_search', input: { q: 'same' } }
  // Always emits the same call → after 2 priors it is "allRepeated", then 3 nudges → give up.
  const adapter = makeAdapter(Array.from({ length: 12 }, () => [{ type: 'tool_calls', calls: [call] } as ProviderEvent]), { enableDivergenceRecovery: true })
  const ctx = makeCtx({ maxTurns: 20 })
  const r = await runAgentLoop(adapter, ctx)
  // Turns 0-1 execute (building the repeat count to 2). Turn 2 detects allRepeated → nudge #1; turn 3 → nudge
  // #2; turn 4 → the 3rd detection trips the give-up (break) WITHOUT appending a nudge. So: 2 executions, 2 nudges.
  assert.equal(ctx.executed.length, 2, 'executed the call twice before nudging began')
  assert.equal(adapter.nudges.length, 2, 'nudged twice, then gave up on the 3rd repeat')
  assert.match(r.content, /kept repeating/)
})
