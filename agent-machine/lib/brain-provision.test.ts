import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { brainUrl, installedBrainVersion, brainStatus } from './brain-provision.js'

// All brain paths read env lazily (at call time). We redirect NOETICA_BRAIN_HOME to a temp dir AND pin the
// per-brain overrides (OCW_BRAIN/OPS_CORPUS) INTO it. Pinning — not clearing — is what makes this hermetic:
// academicBrainDir()/opsBrainFile() use pick(), which returns the env override BEFORE consulting filesystem
// candidates, so it otherwise falls through to legacy paths that exist on the dev box
// (~/Downloads/MIT OCW/_brain, ~/.noetica/ops-corpus) and spuriously reports brains "present" (mirrors the
// canonical guard in brain-home.test.ts).
let tmp: string
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['NOETICA_BRAIN_HOME', 'OCW_BRAIN', 'OPS_CORPUS', 'HELLGRAPH_STORE_DIR',
  'NOETICA_BRAIN_ACADEMIC_URL', 'NOETICA_BRAIN_OPS_URL', 'NOETICA_RELEASE_BASE_URL', 'NOETICA_BRAIN_MANIFEST_URL']

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-brain-'))
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  process.env['NOETICA_BRAIN_HOME'] = tmp
  process.env['OCW_BRAIN'] = path.join(tmp, 'academic')                       // pin academic into the temp dir
  process.env['OPS_CORPUS'] = path.join(tmp, 'operational', 'manpages.jsonl') // pin ops into the temp dir
  process.env['HELLGRAPH_STORE_DIR'] = path.join(tmp, 'hellgraph-empty')      // absent → chat 'empty'
})
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }
})

test('brainUrl: env override > release-base override > the default release asset', () => {
  process.env['NOETICA_BRAIN_ACADEMIC_URL'] = 'https://my.mirror/acad.tar.gz'
  assert.equal(brainUrl('academic'), 'https://my.mirror/acad.tar.gz', 'explicit env URL wins')

  delete process.env['NOETICA_BRAIN_ACADEMIC_URL']
  process.env['NOETICA_RELEASE_BASE_URL'] = 'https://files.example.com/dl/' // trailing slash must be stripped
  assert.equal(brainUrl('operational'), 'https://files.example.com/dl/operational-brain.tar.gz')

  delete process.env['NOETICA_RELEASE_BASE_URL']
  assert.equal(brainUrl('academic'), 'https://github.com/SocioProphet/Noetica/releases/latest/download/academic-brain.tar.gz')
})

test('installedBrainVersion: reads the .brain-version marker, null when absent', () => {
  assert.equal(installedBrainVersion('academic'), null, 'no marker → null')
  const acad = path.join(tmp, 'academic')
  fs.mkdirSync(acad, { recursive: true })
  fs.writeFileSync(path.join(acad, '.brain-version'), '2.1.0\n')
  assert.equal(installedBrainVersion('academic'), '2.1.0', 'trimmed marker value')
})

test('brainStatus: fresh install reports all three brains not provisioned', () => {
  const { brains } = brainStatus()
  const by = Object.fromEntries(brains.map((b) => [b.name, b]))
  assert.equal(by['academic']!.present, false)
  assert.equal(by['operational']!.present, false)
  assert.equal(by['chat']!.present, false)
  assert.match(by['academic']!.detail, /not provisioned/)
})

test('brainStatus: flags an update when the installed marker differs from the manifest version', () => {
  // A present academic brain (one subject field) with an old marker, manifest offers a newer version.
  const acad = path.join(tmp, 'academic')
  fs.mkdirSync(path.join(acad, 'physics'), { recursive: true })
  fs.writeFileSync(path.join(acad, '.brain-version'), '1.0.0')
  const manifest = { brains: { academic: { version: '2.0.0', url: 'x', sha256: '' } } } as never

  const acadEntry = brainStatus(manifest).brains.find((b) => b.name === 'academic')!
  assert.equal(acadEntry.present, true, 'a subject field makes it present')
  assert.equal(acadEntry.installedVersion, '1.0.0')
  assert.equal(acadEntry.availableVersion, '2.0.0')
  assert.equal(acadEntry.updateAvailable, true)
})
