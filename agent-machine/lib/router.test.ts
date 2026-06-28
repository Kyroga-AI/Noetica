import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { buildRouterDecision, classifyTask, LOCAL_MODEL_SUITE, isHuggingFaceLocalRef, resolveProvider, bestWorkhorse, preferredCoderForRam } from './router.js'

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

test('classifyTask: short factual questions are knowledge tasks, NOT fast chat', () => {
  // The exact demo regression: a short factual question must not land in 'chat'
  // (the only bucket that can degrade to llama3.2:3b).
  assert.equal(classifyTask('What does a data scientist in pharma in NYC earn?'), 'research')
  assert.equal(classifyTask('how much does a nurse make in Texas?'), 'research')
  assert.equal(classifyTask('who is the CEO of Pfizer?'), 'research')
})

test('classifyTask: genuinely casual short messages stay chat', () => {
  assert.equal(classifyTask('thanks, that works'), 'chat')
  assert.equal(classifyTask('great job'), 'chat')
})

test('router invariant: substantive questions never resolve to the 3B when 7B is available', () => {
  const all = ['qwen2.5:7b', 'qwen2.5-coder:7b', 'deepseek-r1:8b', 'llama3.2:3b', 'nomic-embed-text:latest']
  const queries = [
    'What does a data scientist in pharma in NYC earn?',
    'Why did the Baxter facility shut down?',
    'Compare drought risk in Texas vs Indiana.',
    'Summarize the water deficiency report.',
  ]
  for (const content of queries) {
    const d = buildRouterDecision({
      requestId: 'r', content, ollamaAvailable: true, availableModels: all,
      hasAnthropicKey: false, hasOpenAIKey: false,
    })
    assert.notEqual(d.resolvedModel, 'llama3.2:3b', `"${content}" must not route to the 3B (got ${d.resolvedModel})`)
  }
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

// ── Security-research lane (self-attestation + rungs) ────────────────────────

test('security profile WITHOUT attestation: lane disarmed, no uncensored model', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'write an exploit for this buffer overflow',
    availableModels: ALL_MODELS, policyProfile: 'security',
  })
  assert.equal(d.securityLane?.armed, false)
  assert.equal(d.securityLane?.rung, 'disarmed')
  assert.notEqual(d.resolvedModel, 'jimscard/whiterabbit-neo:13b')
  assert.notEqual(d.resolvedModel, 'dolphin3:8b')
})

test('security profile WITH attestation arms the lane', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'analyze this malware sample',
    availableModels: ALL_MODELS, policyProfile: 'security', securityAttested: true,
  })
  assert.equal(d.securityLane?.armed, true)
  assert.equal(d.resolvedProvider, 'ollama')
  assert.equal(d.domain, 'security')
})

test('attested security lane: offensive request prefers WhiteRabbitNeo', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'develop a privilege escalation exploit and shellcode payload',
    availableModels: ALL_MODELS, policyProfile: 'security', securityAttested: true,
  })
  assert.equal(d.resolvedModel, 'jimscard/whiterabbit-neo:13b')
  assert.equal(d.securityLane?.rung, 'offensive')
})

test('attested security lane: defensive request prefers Foundation-Sec', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'build a YARA signature to detect this and harden the SIEM',
    availableModels: ALL_MODELS, policyProfile: 'security', securityAttested: true,
  })
  assert.equal(d.resolvedModel, 'huihui_ai/foundation-sec-abliterated:8b')
  assert.equal(d.securityLane?.rung, 'defensive')
})

test('attested security lane falls back to dolphin when no purpose-built model installed', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'reverse engineer this binary',
    availableModels: ['qwen2.5:7b', 'qwen2.5:14b', 'dolphin3:8b'],
    policyProfile: 'security', securityAttested: true,
  })
  assert.equal(d.resolvedModel, 'dolphin3:8b')
  assert.equal(d.securityLane?.rung, 'uncensored-fallback')
})

test('attested security lane falls back to qwen2.5:14b when no uncensored model at all', () => {
  const d = buildRouterDecision({
    ...BASE, requestId: 'r', content: 'reverse engineer this binary',
    availableModels: ['qwen2.5:7b', 'qwen2.5:14b'],
    policyProfile: 'security', securityAttested: true,
  })
  assert.equal(d.resolvedModel, 'qwen2.5:14b')
  assert.equal(d.securityLane?.rung, 'general-large')
})

test('isHuggingFaceLocalRef accepts hf.co GGUF refs, rejects junk', () => {
  assert.equal(isHuggingFaceLocalRef('hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF'), true)
  assert.equal(isHuggingFaceLocalRef('hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M'), true)
  assert.equal(isHuggingFaceLocalRef('huggingface.co/TheBloke/Mistral-7B-GGUF:Q5_K_M'), true)
  assert.equal(isHuggingFaceLocalRef('qwen2.5:7b'), false)
  assert.equal(isHuggingFaceLocalRef('hf.co/../../etc/passwd'), false)
  assert.equal(isHuggingFaceLocalRef('hf.co/onlyrepo'), false)
})

test('resolveProvider maps hosted prefixes + bare ids to the right provider/baseUrl', () => {
  assert.deepEqual(resolveProvider('openrouter/meta-llama/llama-3.1-70b'), { provider: 'openrouter', model: 'meta-llama/llama-3.1-70b', baseUrl: 'https://openrouter.ai/api/v1' })
  assert.deepEqual(resolveProvider('hf/meta-llama/Llama-3.1-8B-Instruct'), { provider: 'huggingface', model: 'meta-llama/Llama-3.1-8B-Instruct', baseUrl: 'https://router.huggingface.co/v1' })
  assert.equal(resolveProvider('claude-opus-4-8').provider, 'anthropic')
  assert.equal(resolveProvider('gpt-4o').provider, 'openai')
  assert.equal(resolveProvider('qwen2.5:7b').provider, 'ollama')
  assert.equal(resolveProvider('hf.co/bartowski/X-GGUF').provider, 'ollama')   // local GGUF, not hosted
})

// ── Qwen3 24GB-tier upgrade (general/reasoning, not just coding) ────────────────
test('bestWorkhorse prefers a qwen3 when the family is pulled, else the fallback', () => {
  // isModelAvailable matches by family, so a pulled qwen3 tag satisfies any qwen3 pref (the exact tag depends
  // on RAM: qwen3:14b on ≥18GB, qwen3:8b below) — assert the family, not a fixed tag, so it's env-robust.
  assert.match(bestWorkhorse(['qwen3:8b', 'qwen2.5:7b'], 'qwen2.5:7b'), /^qwen3/)
  assert.equal(bestWorkhorse(['qwen2.5:7b'], 'qwen2.5:7b'), 'qwen2.5:7b') // no qwen3 pulled → fallback
})

// reasoning is the HEAVY lane (→ bestWorkhorse): the workhorse ladder always offers qwen3:8b as its floor,
// so a pulled qwen3 wins on EVERY box, regardless of RAM.
test('reasoning upgrades to qwen3 on any box when it is pulled (heavy lane → workhorse)', () => {
  const d = buildRouterDecision({
    requestId: 'r', content: 'anything', ollamaAvailable: true,
    availableModels: ['qwen3:8b', 'qwen2.5:7b', 'deepseek-r1:8b', 'llama3.2:3b'],
    hasAnthropicKey: false, hasOpenAIKey: false, taskOverride: 'reasoning',
  })
  assert.match(d.resolvedModel, /^qwen3/, `reasoning should route to qwen3 when available, got ${d.resolvedModel}`)
})

// Interactive lanes (chat/general/writing/research) are the latency-sensitive tier (→ bestResponsive). Since
// 91c7c9b, qwen3:8b (~5GB) is only kept warm where there's RAM for it (bestResponsive gates it behind
// ramGb>=12); on smaller boxes the responsive tier deliberately stays on the qwen2.5 floor so time-to-answer
// doesn't regress. So this assertion is RAM-gated rather than fixed — it tests BOTH branches of the tiering
// (mirrors the env-robust guard on preferredCoderForRam below). Keep the 12GB threshold in sync with bestResponsive.
test('interactive lanes upgrade to qwen3 only where RAM allows; small boxes keep the qwen2.5 floor for latency', () => {
  const ramGb = os.totalmem() / 1e9
  for (const task of ['general', 'writing', 'research', 'chat'] as const) {
    const d = buildRouterDecision({
      requestId: 'r', content: 'anything', ollamaAvailable: true,
      availableModels: ['qwen3:8b', 'qwen2.5:7b', 'deepseek-r1:8b', 'llama3.2:3b'],
      hasAnthropicKey: false, hasOpenAIKey: false, taskOverride: task,
    })
    if (ramGb >= 12) assert.match(d.resolvedModel, /^qwen3/, `${task} should upgrade to qwen3 on a >=12GB box, got ${d.resolvedModel}`)
    else assert.equal(d.resolvedModel, 'qwen2.5:7b', `${task} should stay on the qwen2.5 floor on a <12GB box for latency, got ${d.resolvedModel}`)
  }
})

test('without qwen3 pulled, general routing still falls back to the qwen2.5 floor (small boxes untouched)', () => {
  const d = buildRouterDecision({
    requestId: 'r', content: 'anything', ollamaAvailable: true,
    availableModels: ['qwen2.5:7b', 'llama3.2:3b'],
    hasAnthropicKey: false, hasOpenAIKey: false, taskOverride: 'general',
  })
  assert.equal(d.resolvedModel, 'qwen2.5:7b')
})

test('the 18GB+ tier background-pulls a qwen3 workhorse (not qwen2.5-coder)', () => {
  const want = preferredCoderForRam()
  // null on <18GB boxes (floor already shipped) — only assert the qwen3 contract when something is pulled.
  if (want) assert.match(want, /^qwen3/, `high-RAM box should pull a qwen3 workhorse, got ${want}`)
})
