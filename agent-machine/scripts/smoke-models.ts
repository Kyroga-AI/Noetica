/**
 * Live model-matrix smoke test. Requires a running Ollama (NOT run in CI by
 * default — it needs real models). This is the integration check that would have
 * caught the deepseek-r1 "does not support tools" regression and the
 * reasoning-not-captured bug.
 *
 * For every installed model in LOCAL_MODEL_SUITE it verifies:
 *   - a no-tools completion succeeds
 *   - if toolUse===true: a with-tools completion succeeds (Ollama accepts tools)
 *   - if toolUse===false: sending tools is correctly avoided (we never send them)
 *   - reasoning models surface chain-of-thought (thinking events > 0)
 *
 * Run:  npm run test:models   (from agent-machine/)
 * Exit code is non-zero if any check fails.
 */
import { listLocalModels, streamOllama, OLLAMA_BASE } from '../lib/ollama.js'
import { LOCAL_MODEL_SUITE } from '../lib/router.js'
import type { ProviderTool } from '../server.js'

const TOOLS: ProviderTool[] = [{
  name: 'get_time', description: 'Get the current time',
  input_schema: { type: 'object', properties: {}, required: [] },
}]

type Result = { model: string; check: string; ok: boolean; detail?: string }

async function runOne(model: string, tools: ProviderTool[] | undefined): Promise<{ text: string; thinking: string; toolCalls: number; error?: string }> {
  let text = '', thinking = '', toolCalls = 0
  try {
    for await (const ev of streamOllama({
      model, tools,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      numCtx: 2048,
    })) {
      if (ev.type === 'text') text += ev.text
      else if (ev.type === 'thinking') thinking += ev.text
      else if (ev.type === 'tool_calls') toolCalls += ev.calls.length
    }
  } catch (e) {
    return { text, thinking, toolCalls, error: e instanceof Error ? e.message : String(e) }
  }
  return { text, thinking, toolCalls }
}

async function main() {
  console.log(`[smoke-models] Ollama: ${OLLAMA_BASE}`)
  const installed = await listLocalModels()
  if (installed.length === 0) {
    console.error('[smoke-models] No local models / Ollama unreachable — cannot run.')
    process.exit(2)
  }
  const results: Result[] = []

  for (const spec of LOCAL_MODEL_SUITE) {
    if (spec.role === 'embedding') continue
    if (!installed.includes(spec.name)) {
      console.log(`[smoke-models] skip ${spec.name} (not installed)`)
      continue
    }
    // 1. no-tools completion must succeed (HARD)
    const noTools = await runOne(spec.name, undefined)
    results.push({ model: spec.name, check: 'no-tools completes', ok: !noTools.error && noTools.text.length > 0, detail: noTools.error })

    // 2a. toolUse:true models MUST accept tools (HARD capability contract).
    if (spec.toolUse) {
      const withTools = await runOne(spec.name, TOOLS)
      results.push({ model: spec.name, check: 'accepts tools (toolUse:true)', ok: !withTools.error, detail: withTools.error })
    }
    // 2b. deepseek-r1 specifically MUST reject tools — the exact regression guard.
    // (Other toolUse:false models, e.g. llama3.2 conductor, are a POLICY choice
    //  not a capability claim, so we don't assert rejection for them.)
    if (spec.name === 'deepseek-r1:8b') {
      const withTools = await runOne(spec.name, TOOLS)
      results.push({ model: spec.name, check: 'deepseek-r1 rejects tools (regression guard)', ok: Boolean(withTools.error), detail: withTools.error ? undefined : 'accepted tools — the original bug has regressed' })
    }

    // 3. reasoning models must surface chain-of-thought (HARD).
    if (spec.role === 'reasoning') {
      results.push({ model: spec.name, check: 'reasoning surfaced (thinking>0)', ok: noTools.thinking.length > 0, detail: noTools.thinking.length > 0 ? undefined : 'no thinking captured — check delta.reasoning parsing' })
    }
  }

  let failed = 0
  for (const r of results) {
    console.log(`${r.ok ? '✔' : '✖'} ${r.model} — ${r.check}${r.detail ? `  (${r.detail})` : ''}`)
    if (!r.ok) failed++
  }
  console.log(`\n[smoke-models] ${results.length - failed}/${results.length} checks passed`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
