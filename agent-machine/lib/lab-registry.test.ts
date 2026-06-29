import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { LabRegistry } from './lab-registry.js'

// ── Module-level mocks must be set before the module under test is imported.
// We use globalThis to intercept the named imports that lab-registry.ts pulls in.

// Stub global fetch so no real network calls are made.
type FetchStub = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
let _fetchStub: FetchStub = () => Promise.reject(new Error('fetch not configured'))
const originalFetch = globalThis.fetch

describe('LabRegistry', async () => {
  // Set up module mocks BEFORE importing the module under test.
  before(() => {
    // Intercept global fetch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = (url: string | URL | Request, init?: RequestInit) =>
      _fetchStub(url, init)
  })

  after(() => {
    // Restore original fetch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = originalFetch
  })

  // ── 1. healthCheck: returns false when endpoint unreachable ───────────────

  await it('healthCheck: returns false when endpoint unreachable', async () => {
    _fetchStub = () => Promise.reject(new Error('ECONNREFUSED'))

    const registry = new LabRegistry()
    const fakeEndpoint = {
      surface: 'speech' as const,
      url: 'http://localhost:8127',
      healthy: true,
      lastChecked: new Date(),
      serviceId: 'service://socioprophet/modality/speech/default@0.1.0',
      status: 'experimental',
    }

    const ok = await registry.healthCheck(fakeEndpoint)
    assert.equal(ok, false)
  })

  // ── 2. healthCheck: returns true on 200 response ──────────────────────────

  await it('healthCheck: returns true on 200 response', async () => {
    _fetchStub = () =>
      Promise.resolve(new Response(null, { status: 200 }))

    const registry = new LabRegistry()
    const fakeEndpoint = {
      surface: 'speech' as const,
      url: 'http://localhost:8127',
      healthy: false,
      lastChecked: new Date(),
      serviceId: 'service://socioprophet/modality/speech/default@0.1.0',
      status: 'experimental',
    }

    const ok = await registry.healthCheck(fakeEndpoint)
    assert.equal(ok, true)
  })

  // ── 3. resolve: returns null for surface with no WELL_KNOWN_PORTS entry ───

  await it('resolve: returns null for surface with no well-known port (ocr)', async () => {
    // 'ocr' has no WELL_KNOWN_PORTS entry → _probeLocal returns null immediately.
    _fetchStub = () => Promise.reject(new Error('should not be called'))

    const registry = new LabRegistry()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await registry.resolve('ocr' as any)
    assert.equal(result, null)
  })

  // ── 4. resolve: returns endpoint when health check succeeds ──────────────

  await it('resolve: returns healthy endpoint for speech when health check succeeds', async () => {
    _fetchStub = () => Promise.resolve(new Response(null, { status: 200 }))

    const registry = new LabRegistry()
    const endpoint = await registry.resolve('speech')
    assert.ok(endpoint !== null, 'should resolve a speech endpoint')
    assert.equal(endpoint!.surface, 'speech')
    assert.equal(endpoint!.healthy, true)
    assert.equal(endpoint!.url, 'http://localhost:8127')
  })

  // ── 5. all: returns cached snapshot ──────────────────────────────────────

  await it('all: returns cached snapshot after resolving surfaces', async () => {
    // Make health checks succeed so both endpoints are accepted.
    _fetchStub = () => Promise.resolve(new Response(null, { status: 200 }))

    const registry = new LabRegistry()

    // Manually seed the snapshot via resolve so we control the surfaces.
    // speech (port 8127) and language (port 8080) both have WELL_KNOWN_PORTS entries.
    await registry.resolve('speech')
    await registry.resolve('language')

    const snapshot = registry.all()
    assert.ok(snapshot.length >= 2, `expected at least 2 endpoints, got ${snapshot.length}`)
    const surfaces = snapshot.map(e => e.surface)
    assert.ok(surfaces.includes('speech'), 'speech should be in snapshot')
    assert.ok(surfaces.includes('language'), 'language should be in snapshot')
  })

  // ── 6. discover: excludes unhealthy surfaces ──────────────────────────────

  await it('discover: returns only healthy endpoints (all unreachable → empty except embedding if available)', async () => {
    // All HTTP probes fail. In test env isLocalEmbedAvailable() = false (no binary).
    _fetchStub = () => Promise.reject(new Error('unreachable'))

    const registry = new LabRegistry()
    const endpoints = await registry.discover()

    // All endpoints should be healthy (unhealthy ones are filtered out).
    for (const ep of endpoints) {
      assert.equal(ep.healthy, true, `endpoint ${ep.surface} should be healthy or excluded`)
    }
  })
})
