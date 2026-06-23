/** Tests for the per-domain knowledge readiness report. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

test('domainStatus flags rich / thin / missing from the manifest + field presence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'))
  fs.mkdirSync(path.join(dir, 'mathematics')); fs.writeFileSync(path.join(dir, 'mathematics', 'a.jsonl'), '{}\n')
  fs.mkdirSync(path.join(dir, 'medicine')); fs.writeFileSync(path.join(dir, 'medicine', 'a.jsonl'), '{}\n')
  // legal: no dir at all → missing
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({
    embed_model: 'nomic-embed-text', dims: 768, courses_built: 134, courses_by_field: { mathematics: 133, medicine: 1 },
  }))
  process.env['OCW_BRAIN'] = dir
  const { domainStatus } = await import('./knowledge-domains.js')
  const d = domainStatus()
  const by = Object.fromEntries(d.domains.map((x) => [x.field, x]))
  assert.equal(by['mathematics']!.status, 'rich')
  assert.equal(by['medicine']!.status, 'thin')   // staged but not built at scale
  assert.equal(by['legal']!.status, 'missing')   // pipeline ready, not run
  assert.equal(by['legal']!.present, false)
  assert.equal(d.dims, 768)
  assert.equal(d.embedModel, 'nomic-embed-text')
  delete process.env['OCW_BRAIN']
})
