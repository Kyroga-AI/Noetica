/** Tests for lattice-forge RuntimeAsset conformance. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelRuntimeAsset, sidecarRuntimeAsset, conformsToLattice, LATTICE_API_VERSION } from './lattice-forge.js'

test('modelRuntimeAsset emits a conformant RuntimeAsset for an Ollama model', () => {
  const a = modelRuntimeAsset('qwen2.5:7b', { createdAt: '2026-06-22T00:00:00Z', digest: 'sha256:abc' })
  assert.equal(a.apiVersion, LATTICE_API_VERSION)
  assert.equal(a.kind, 'RuntimeAsset')
  assert.equal(a.spec.runtimeClass, 'model')
  assert.equal(a.spec.channels[0]!.type, 'ollama')
  assert.equal(a.spec.artifacts[0]!.role, 'model-weights')
  assert.equal(a.spec.artifacts[0]!.digest, 'sha256:abc')
  assert.equal(conformsToLattice(a).conforms, true)
})

test('sidecarRuntimeAsset carries SLSA + in-toto provenance', () => {
  const a = sidecarRuntimeAsset('noetica-embed', { version: '0.1.0', createdAt: '2026-06-22T00:00:00Z', languages: ['rust'], runtimeClass: 'embed-sidecar' })
  assert.deepEqual(a.spec.provenance.attestations, ['slsa', 'in-toto'])
  assert.equal(a.spec.provenance.builderId, 'noetica-runtime-manager')
  assert.equal(conformsToLattice(a).conforms, true)
})

test('conformsToLattice flags a malformed asset', () => {
  const bad = { apiVersion: 'wrong', kind: 'RuntimeAsset' as const, metadata: { name: '', version: '1', createdAt: 'x' }, spec: { runtimeClass: 'm', languages: [], channels: [], artifacts: [], provenance: { attestations: [], sourceRefs: [], builderId: '' } } }
  const r = conformsToLattice(bad)
  assert.equal(r.conforms, false)
  assert.ok(r.missing.includes('apiVersion') && r.missing.includes('metadata.name') && r.missing.includes('spec.provenance.builderId'))
})
