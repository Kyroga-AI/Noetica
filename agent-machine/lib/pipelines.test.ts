import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgoApps, pipelineStatus } from './pipelines.js'

test('parseArgoApps maps sync + health from the Argo Application list', () => {
  const json = JSON.stringify({
    items: [
      { metadata: { name: 'cloudshell' }, spec: { destination: { namespace: 'porter-system' } }, status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } } },
      { metadata: { name: 'shim' }, spec: { destination: { namespace: 'porter-system' } }, status: { sync: { status: 'OutOfSync' }, health: { status: 'Progressing' } } },
    ],
  })
  const apps = parseArgoApps(json)
  assert.equal(apps.length, 2)
  assert.deepEqual(apps[0], { name: 'cloudshell', namespace: 'porter-system', sync: 'Synced', health: 'Healthy' })
  assert.equal(apps[1].sync, 'OutOfSync')
})

test('parseArgoApps is robust to junk / missing fields', () => {
  assert.deepEqual(parseArgoApps('not json'), [])
  assert.deepEqual(parseArgoApps(JSON.stringify({ items: [{}] })), [{ name: '', namespace: '', sync: 'Unknown', health: 'Unknown' }])
})

test('pipelineStatus returns a well-formed shape', async () => {
  const s = await pipelineStatus()
  assert.equal(typeof s.gitops.kubectl, 'boolean')
  assert.equal(typeof s.gitops.argocd, 'boolean')
  assert.ok(Array.isArray(s.apps))
})
