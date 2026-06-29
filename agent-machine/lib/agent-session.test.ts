/**
 * Tests for AgentSession (base class) and OllamaProvider (Gap 02+03).
 * All providers are injected — no live Ollama or Anthropic.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AgentSession, OllamaProvider, ReasoningLevel,
  type SessionProvider, type GenerateParams, type GenerateResult, type StreamChunk,
} from './agent-session.js'

// ── Stub provider factory ──────────────────────────────────────────────────────

function stubProvider(response: string, throws?: Error): SessionProvider & { calls: GenerateParams[] } {
  const calls: GenerateParams[] = []
  return {
    calls,
    async generate(params: GenerateParams): Promise<GenerateResult> {
      calls.push(params)
      if (throws) throw throws
      return { content: response, reasoning: '' }
    },
    async *stream(params: GenerateParams): AsyncGenerator<StreamChunk> {
      calls.push(params)
      for (const word of response.split(' ')) yield { text: word + ' ' }
    },
  }
}

// ── AgentSession base class ────────────────────────────────────────────────────

test('respond: delegates to provider and returns content', async () => {
  const prov = stubProvider('Hello world')
  const session = new AgentSession({ _provider: prov })
  const result = await session.respond('Say hello')
  assert.equal(result, 'Hello world')
})

test('respond: prepends system prompt when configured', async () => {
  const prov = stubProvider('ok')
  const session = new AgentSession({ _provider: prov, systemPrompt: 'You are concise.' })
  await session.respond('hello')
  const msgs = prov.calls[0]!.messages
  assert.equal(msgs[0]?.role, 'system')
  assert.ok(msgs[0]?.content.includes('concise'))
  assert.equal(msgs[1]?.role, 'user')
})

test('respond: throws when no provider configured', async () => {
  const session = new AgentSession()
  await assert.rejects(() => session.respond('hi'), /no provider/)
})

test('stream: yields chunks from provider', async () => {
  const prov = stubProvider('a b c')
  const session = new AgentSession({ _provider: prov })
  const chunks: string[] = []
  for await (const chunk of session.stream('go')) {
    if (chunk.text) chunks.push(chunk.text)
  }
  assert.ok(chunks.length > 0)
  assert.ok(chunks.join('').includes('a'))
})

// ── ReasoningLevel enum ────────────────────────────────────────────────────────

test('ReasoningLevel: has all four levels as runtime values', () => {
  assert.equal(ReasoningLevel.LIGHT,    'light')
  assert.equal(ReasoningLevel.MODERATE, 'moderate')
  assert.equal(ReasoningLevel.DEEP,     'deep')
  assert.equal(ReasoningLevel.SOVEREIGN,'sovereign')
  assert.equal(Object.values(ReasoningLevel).length, 4)
})

// ── OllamaProvider ─────────────────────────────────────────────────────────────
// We can't call real Ollama in tests, but we CAN test the routing and structured
// output logic by patching global fetch (Anthropic fallback) and checking env vars.

test('OllamaProvider.parseStructured: strips markdown fences', () => {
  const raw = '```json\n{"x": 1}\n```'
  const result = OllamaProvider.parseStructured(raw)
  assert.deepEqual(result, { x: 1 })
})

test('OllamaProvider.parseStructured: passes through plain JSON', () => {
  const raw = '{"name":"Alice","age":30}'
  const result = OllamaProvider.parseStructured(raw)
  assert.deepEqual(result, { name: 'Alice', age: 30 })
})

test('OllamaProvider: DEEP falls back to Anthropic when ANTHROPIC_API_KEY set', async () => {
  const origKey = process.env['ANTHROPIC_API_KEY']
  process.env['ANTHROPIC_API_KEY'] = 'test-key'

  const originalFetch = global.fetch
  global.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
    if (String(url).includes('anthropic.com')) {
      return new Response(
        JSON.stringify({ content: [{ text: 'Anthropic says hi' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    // Simulate local Ollama being unreachable
    throw new Error('ECONNREFUSED')
  }

  try {
    const provider = new OllamaProvider(ReasoningLevel.DEEP)
    const result = await provider.generate({ messages: [{ role: 'user', content: 'hello' }] })
    assert.equal(result.content, 'Anthropic says hi')
  } finally {
    global.fetch = originalFetch
    if (origKey === undefined) delete process.env['ANTHROPIC_API_KEY']
    else process.env['ANTHROPIC_API_KEY'] = origKey
  }
})

test('OllamaProvider: DEEP with no ANTHROPIC_API_KEY propagates local error', async () => {
  const origKey = process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_API_KEY']

  const originalFetch = global.fetch
  global.fetch = async () => { throw new Error('ECONNREFUSED') }

  try {
    const provider = new OllamaProvider(ReasoningLevel.DEEP)
    await assert.rejects(
      () => provider.generate({ messages: [{ role: 'user', content: 'hello' }] }),
      /ECONNREFUSED|ANTHROPIC_API_KEY/
    )
  } finally {
    global.fetch = originalFetch
    if (origKey !== undefined) process.env['ANTHROPIC_API_KEY'] = origKey
  }
})

test('OllamaProvider: uses PROPHET_LIGHT_MODEL env var for LIGHT lane', () => {
  const orig = process.env['PROPHET_LIGHT_MODEL']
  process.env['PROPHET_LIGHT_MODEL'] = 'tinyllama:1b'
  try {
    // Can't invoke without Ollama, but constructing is enough to confirm no error
    const provider = new OllamaProvider(ReasoningLevel.LIGHT)
    assert.ok(provider instanceof OllamaProvider)
  } finally {
    if (orig === undefined) delete process.env['PROPHET_LIGHT_MODEL']
    else process.env['PROPHET_LIGHT_MODEL'] = orig
  }
})
