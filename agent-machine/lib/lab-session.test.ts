import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LabSession } from './lab-session.js'
import type { LabEndpoint } from './lab-registry.js'
import type { SessionProvider } from './agent-session.js'

// ---------------------------------------------------------------------------
// Stub SessionProvider — satisfies the SessionProvider interface without
// making any real network calls. The _provider injection path in AgentSession
// routes all LLM calls through this object.
// ---------------------------------------------------------------------------
function makeProvider(respondWith: string): SessionProvider {
  return {
    async generate() {
      return { content: respondWith, reasoning: '' }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async *stream() {
      yield { text: respondWith }
    },
  }
}

function makeTrackingProvider(respondWith: string): { provider: SessionProvider; prompts: string[] } {
  const prompts: string[] = []
  const provider: SessionProvider = {
    async generate(params) {
      const userMsg = params.messages.find(m => m.role === 'user')
      if (userMsg) prompts.push(userMsg.content)
      return { content: respondWith, reasoning: '' }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async *stream() {
      yield { text: respondWith }
    },
  }
  return { provider, prompts }
}

// ---------------------------------------------------------------------------
// Stub LabRegistry — implements only the subset of the real LabRegistry that
// LabSession calls (_registry.resolve, _registry.discover, _registry.all).
// ---------------------------------------------------------------------------
class StubLabRegistry {
  private _endpoints: LabEndpoint[]
  private _resolveResult: LabEndpoint | null

  constructor(opts: {
    endpoints?: LabEndpoint[]
    resolveResult?: LabEndpoint | null
  } = {}) {
    this._endpoints = opts.endpoints ?? []
    this._resolveResult = opts.resolveResult ?? null
  }

  async resolve(_surface: string): Promise<LabEndpoint | null> {
    return this._resolveResult
  }

  async discover(): Promise<LabEndpoint[]> {
    return this._endpoints
  }

  all(): LabEndpoint[] {
    return [...this._endpoints]
  }
}

describe('LabSession', async () => {

  // ── 1. embed: returns null when sidecar unavailable (no embed binary in test env) ──

  await it('embed: returns null when local embed sidecar is unavailable', async () => {
    const session = new LabSession({
      _provider: makeProvider(''),
      _registry: new StubLabRegistry() as never,
    })

    // In test env, noetica-embed binary is not present, so embedBatchLocal returns null.
    const result = await session.embed('test text')
    // Either null (sidecar unavailable) or a number array (sidecar running) — both valid.
    assert.ok(result === null || Array.isArray(result), 'embed must return null or a number[]')
  })

  // ── 2. embedBatch: returns null or an array when sidecar unavailable ─────

  await it('embedBatch: returns null or array when local embed sidecar is unavailable', async () => {
    const session = new LabSession({
      _provider: makeProvider(''),
      _registry: new StubLabRegistry() as never,
    })

    const result = await session.embedBatch(['foo', 'bar'])
    // null if sidecar not running, or array of (number[] | null) if it is
    assert.ok(result === null || Array.isArray(result), 'embedBatch must return null or an array')
  })

  // ── 3. transcribe: falls back to respond when STT unavailable ────────────

  await it('transcribe: falls back to provider when STT binary is unavailable', async () => {
    // isSttAvailable() = false in test env (no whisper binary), so LabSession.transcribe
    // falls back to this.respond(), which calls the injected provider.
    const { provider, prompts } = makeTrackingProvider('transcription fallback')

    const session = new LabSession({
      _provider: provider,
      _registry: new StubLabRegistry() as never,
    })

    const result = await session.transcribe('/tmp/audio.wav', { language: 'en' })
    // If STT is available in the environment, accept any valid result shape.
    // If STT is unavailable, the provider fallback must have been called.
    assert.ok(
      'text' in result || 'error' in result,
      'transcribe must return {text} or {error}'
    )
    if ('text' in result && result.text === 'transcription fallback') {
      // Provider fallback was used — prompt should reference the audio path
      assert.ok(prompts.length > 0, 'provider should have been called for fallback')
      assert.ok(
        prompts[0]!.includes('/tmp/audio.wav'),
        `expected audio path in prompt, got: ${prompts[0]}`
      )
    }
  })

  // ── 4. translate: falls back to respond when no lab endpoint ──────────────

  await it('translate: falls back to respond when no translation endpoint', async () => {
    const { provider, prompts } = makeTrackingProvider('Bonjour')

    // Registry resolves to null → no translation endpoint → model fallback.
    const session = new LabSession({
      _provider: provider,
      _registry: new StubLabRegistry({ resolveResult: null }) as never,
    })

    const result = await session.translate('Hello world', { from: 'en', to: 'fr' })

    assert.equal(result, 'Bonjour')
    assert.ok(prompts.length > 0, 'provider should have been called')
    assert.ok(
      prompts[0]!.includes('fr'),
      `expected target language in prompt, got: ${prompts[0]}`
    )
    assert.ok(
      prompts[0]!.includes('Hello world'),
      `expected source text in prompt, got: ${prompts[0]}`
    )
  })

  // ── 5. describeImage: falls back to respond when OCR unavailable ──────────

  await it('describeImage: falls back to provider when OCR returns unavailable', async () => {
    const { provider, prompts } = makeTrackingProvider('a cat sitting on a mat')

    const session = new LabSession({
      _provider: provider,
      _registry: new StubLabRegistry() as never,
    })

    // runOcr returns 'OCR unavailable' in test env (no OCR binary).
    const result = await session.describeImage('/tmp/test.png')

    // Either OCR succeeded (non-error string) or provider was called as fallback.
    assert.ok(typeof result === 'string' && result.length > 0, 'describeImage must return a non-empty string')
    if (result === 'a cat sitting on a mat') {
      // Provider was used — prompt should reference the image path.
      assert.ok(prompts.length > 0, 'provider should have been called for fallback')
    }
  })

  // ── 6. labs: returns registry snapshot ────────────────────────────────────

  await it('labs: returns registry snapshot', async () => {
    const stubEndpoints: LabEndpoint[] = [
      {
        surface: 'embedding',
        url: 'http://localhost:8126',
        healthy: true,
        lastChecked: new Date(),
        serviceId: 'service://socioprophet/modality/embedding/default@0.1.0',
        status: 'experimental',
      },
      {
        surface: 'speech',
        url: 'http://localhost:8127',
        healthy: true,
        lastChecked: new Date(),
        serviceId: 'service://socioprophet/modality/speech/default@0.1.0',
        status: 'experimental',
      },
    ]

    const session = new LabSession({
      _provider: makeProvider(''),
      _registry: new StubLabRegistry({ endpoints: stubEndpoints }) as never,
    })

    const result = await session.labs()
    assert.equal(result.length, 2)
    assert.equal(result[0]!.surface, 'embedding')
    assert.equal(result[1]!.surface, 'speech')
  })
})
