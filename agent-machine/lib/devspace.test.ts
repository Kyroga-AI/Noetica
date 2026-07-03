import { test } from 'node:test'
import assert from 'node:assert/strict'
import { devSpaceFor, listDevSpaces, TRUST_NAMESPACES } from './devspace.js'

test('self maps to an isolated BaseSpace (on-device); others to MeshSpace', () => {
  const self = devSpaceFor('self', 'noetica')
  assert.equal(self.spaceType, 'base')
  assert.equal(self.kubeNamespace, 'noetica-self')
  assert.equal(devSpaceFor('workspace').spaceType, 'mesh')
  assert.equal(devSpaceFor('collective').spaceType, 'mesh')
})

test('every DevSpace exposes the Nocalhost dev-mode fast loop', () => {
  const d = devSpaceFor('workspace')
  assert.deepEqual(new Set(d.devMode), new Set(['file-sync', 'port-forward', 'debug', 'exec']))
})

test('listDevSpaces returns one DevSpace per trust namespace', async () => {
  const { spaces } = await listDevSpaces('demo')
  assert.equal(spaces.length, TRUST_NAMESPACES.length)
  assert.deepEqual(spaces.map((s) => s.trustNamespace).sort(), [...TRUST_NAMESPACES].sort())
  assert.ok(spaces.every((s) => s.name.startsWith('demo@')))
})
