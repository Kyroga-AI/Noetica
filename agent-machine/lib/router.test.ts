import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRouterDecision, classifyTask, LOCAL_MODEL_SUITE } from './router.js'

// The full local model inventory — used to simulate "everything installed".
const ALL_MODELS = LOCAL_MODEL_SUITE.map((m) => m.name)
const toolUseOf = (name: string) => LOCAL_MODEL_SUITE.find((m) => m.name === name)?.toolUse

const BASE = {
  ollamaAvailable: true,
  hasAnthropicKey: false,
  hasOpenAIKey: false,
}

// ── Task classification ─────────────────────────────────────────────────────
test('classifyTask routes reasoning phrasing to reasoning', () => {
  assert.equal(classifyTask('compare X and Y and explain which is better'), 'reasoning')
  assert.equal(classifyTask('analyze the trade-offs here'), 'reasoning')
})

test('classifyTask routes code phrasing to coding', () => {
  assert.equal(classifyTask('write a function to reverse a linked list'), 'coding')
})

// ── Model-capability contract (the deepseek-r1 bug class) ───────────────────
test('deepseek-r1 is declared tool-incapable (Ollama 400s on tools)', () => {
  assert.equal(toolUseOf('deepseek-r1:8b'), false, 'deepseek-r1:8b must be toolUse:false')
})

test('every suite model has an explicit boolean toolUse flag', () => {
  for (const m of LOCAL_MODEL_SUITE) {
    assert.equal(typeof m.toolUse, 'boolean', `${m.name} missing toolUse flag`)
  }
})

// ── Router invariant: never route a tool-requiring request to a no-tools model ─
const TASKS: Array<{ content: string }> = [
  { content: 'analyze and compare these two approaches' }, // reasoning
  { content: 'write a python function with tests' },        // coding
  { content: 'draft an email to the team' },                // writing
  { content: 'research the history of TCP' },               // research
  { content: 'hello there' },                               // general
]

test('with tools required and all models installed, the routed model is tool-capable', () => {
  for (const t of TASKS) {
    const d = buildRouterDecision({
      ...BASE, requestId: 'r', content: t.content,
      availableModels: ALL_MODELS, hasTools: true,
    })
    if (d.resolvedProvider === 'ollama') {
      assert.notEqual(toolUseOf(d.resolvedModel), false,
        `task "${t.content}" routed to tool-incapable ${d.resolvedModel} despite hasTools`)
    }
  }
})

test('with tools required and the tool-capable upgrade NOT installed, fallback is still tool-capable', () => {
  // Only deepseek-r1 (no tools) installed → writing/research/general fall back to it.
  // The router must NOT hand a tool request to a tool-incapable fallback.
  for (const content of ['draft an email', 'research quantum computing', 'tell me a joke']) {
    const d = buildRouterDecision({
      ...BASE, requestId: 'r', content,
      availableModels: ['deepseek-r1:8b'], hasTools: true,
    })
    if (d.resolvedProvider === 'ollama') {
      assert.notEqual(toolUseOf(d.resolvedModel), false,
        `"${content}" fell back to tool-incapable ${d.resolvedModel} with hasTools`)
    }
  }
})

test('without tools, reasoning still routes to the reasoning model', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'analyze the trade-offs',
    availableModels: ALL_MODELS, hasTools: false,
  })
  assert.equal(d.resolvedModel, 'deepseek-r1:8b')
})
