/** Tests for the brain manifest (the injection + update service client). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brainManifestUrl, entryFor, _resetManifestCache, type BrainManifest } from './brain-manifest.js'

test('manifest URL: default canonical bucket, overridable by env', () => {
  delete process.env['NOETICA_BRAIN_MANIFEST_URL']
  assert.match(brainManifestUrl(), /^https:\/\/storage\.googleapis\.com\/.*manifest\.json$/)
  process.env['NOETICA_BRAIN_MANIFEST_URL'] = 'https://cdn.example.com/m.json'
  assert.equal(brainManifestUrl(), 'https://cdn.example.com/m.json')
  delete process.env['NOETICA_BRAIN_MANIFEST_URL']
  _resetManifestCache()
})

test('brainStatus flags updateAvailable when the installed version differs from the manifest', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acad-'))
  fs.mkdirSync(path.join(dir, 'biology'))
  fs.writeFileSync(path.join(dir, 'biology', 'x.jsonl'), '{}\n')
  fs.writeFileSync(path.join(dir, '.brain-version'), '2026.01.01') // installed version
  process.env['OCW_BRAIN'] = dir
  const { brainStatus, installedBrainVersion } = await import('./brain-provision.js')
  assert.equal(installedBrainVersion('academic'), '2026.01.01')

  const mkManifest = (v: string): BrainManifest => ({ schema: 1, updated_at: 'now', brains: { academic: { version: v, url: 'https://x/a.tar.gz', sha256: 'z' } } })
  const newer = brainStatus(mkManifest('2026.06.22')).brains.find((b) => b.name === 'academic')!
  assert.equal(newer.present, true)
  assert.equal(newer.installedVersion, '2026.01.01')
  assert.equal(newer.availableVersion, '2026.06.22')
  assert.equal(newer.updateAvailable, true)

  const same = brainStatus(mkManifest('2026.01.01')).brains.find((b) => b.name === 'academic')!
  assert.equal(same.updateAvailable, false) // up to date → no nag
  delete process.env['OCW_BRAIN']
})

test('entryFor returns a usable entry only when it has a url', () => {
  const m: BrainManifest = {
    schema: 1, updated_at: 'now',
    brains: { academic: { version: '2026.06.22', url: 'https://x/y.tar.gz', sha256: 'abc' }, broken: { version: '1', url: '', sha256: '' } },
  }
  assert.equal(entryFor(m, 'academic')?.version, '2026.06.22')
  assert.equal(entryFor(m, 'broken'), null) // no url → not usable
  assert.equal(entryFor(m, 'missing'), null)
  assert.equal(entryFor(null, 'academic'), null)
})
