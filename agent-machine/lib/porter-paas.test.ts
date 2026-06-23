/** Tests for the Porter PaaS integration — app spec, yaml, commands, conformance. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { porterApp, porterCommands, toPorterYaml, conformsToPorter } from './porter-paas.js'

test('porterApp builds a conformant v2 spec, slugging the name', () => {
  const app = porterApp({ name: 'My Noetica App!', run: 'node server.js', port: 8080 })
  assert.equal(app.version, 'v2')
  assert.equal(app.name, 'my-noetica-app')
  assert.equal(app.services[0]!.run, 'node server.js')
  assert.equal(app.services[0]!.port, 8080)
  assert.equal(conformsToPorter(app).conforms, true)
})

test('toPorterYaml serializes the spec', () => {
  const y = toPorterYaml(porterApp({ name: 'app', run: 'npm start', port: 3000, env: { NODE_ENV: 'production' } }))
  assert.ok(y.includes('version: v2'))
  assert.ok(y.includes('name: app'))
  assert.ok(y.includes('port: 3000'))
  assert.ok(y.includes('NODE_ENV'))
})

test('porterCommands cover the local-first dev → deploy loop', () => {
  const c = porterCommands('app')
  assert.ok(c.devRun.includes('porter app run app'), 'local-first run')
  assert.ok(c.apply.includes('porter apply'))
  assert.ok(c.logs.includes('porter app logs app'))
})

test('conformsToPorter flags a malformed spec', () => {
  const r = conformsToPorter({ name: '', services: [] })
  assert.equal(r.conforms, false)
  assert.ok(r.missing.includes('name') && r.missing.includes('services') && r.missing.includes('build.method'))
})

test('planPorterDeploy brokers compute to cheapest cloud + resolves the model into env', async () => {
  const { porterApp, planPorterDeploy } = await import('./porter-paas.js')
  const app = porterApp({ name: 'My Infer App', compute: { broker: true, gpu: 'A100', hours: 10, spot: true }, model: 'openrouter/meta-llama/llama-3.1-70b' })
  const plan = await planPorterDeploy(app)
  assert.equal(plan.compute?.brokered, true)
  assert.ok(plan.compute?.provider, 'a cloud provider was brokered')
  assert.ok((plan.compute?.totalUsd ?? 0) > 0)
  assert.equal(plan.model?.provider, 'openrouter')
  assert.equal(plan.model?.id, 'meta-llama/llama-3.1-70b')
  assert.equal(plan.env['NOETICA_MODEL_PROVIDER'], 'openrouter')
  assert.equal(plan.env['NOETICA_CLOUD_PROVIDER'], plan.compute?.provider)
})
