/** Tests for canonical brain-path resolution + the status report. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

test('env override wins for the academic brain path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'))
  process.env['OCW_BRAIN'] = dir
  const { academicBrainDir } = await import('./brain-home.js')
  assert.equal(academicBrainDir(), dir)
  delete process.env['OCW_BRAIN']
})

test('brainHome honors NOETICA_BRAIN_HOME and resolves brains under it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'))
  // create the canonical locations so they're the first EXISTING candidate (deterministic regardless of
  // any legacy brain on the test machine)
  fs.mkdirSync(path.join(dir, 'academic'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'operational'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'operational', 'manpages.jsonl'), '{}\n')
  process.env['NOETICA_BRAIN_HOME'] = dir
  delete process.env['OCW_BRAIN']; delete process.env['OPS_CORPUS']
  const { brainHome, academicBrainDir, opsBrainFile } = await import('./brain-home.js')
  assert.equal(brainHome(), dir)
  assert.equal(academicBrainDir(), path.join(dir, 'academic'))
  assert.equal(opsBrainFile(), path.join(dir, 'operational', 'manpages.jsonl'))
  delete process.env['NOETICA_BRAIN_HOME']
})

test('brainStatus reports all three brains and flags absence', async () => {
  process.env['OCW_BRAIN'] = path.join(os.tmpdir(), 'no-such-academic-brain')
  process.env['OPS_CORPUS'] = path.join(os.tmpdir(), 'no-such-ops.jsonl')
  const { brainStatus } = await import('./brain-provision.js')
  const s = brainStatus()
  const names = s.brains.map((b) => b.name).sort()
  assert.deepEqual(names, ['academic', 'chat', 'operational'])
  assert.equal(s.brains.find((b) => b.name === 'academic')!.present, false)
  assert.equal(s.brains.find((b) => b.name === 'operational')!.present, false)
  delete process.env['OCW_BRAIN']; delete process.env['OPS_CORPUS']
})

test('brainUrl defaults to the official release asset, env overrides it', async () => {
  delete process.env['NOETICA_BRAIN_ACADEMIC_URL']; delete process.env['NOETICA_RELEASE_BASE_URL']
  const { brainUrl } = await import('./brain-provision.js')
  // no config → the GitHub "latest" release asset, so a brew install loads knowledge with zero setup
  assert.match(brainUrl('academic'), /releases\/latest\/download\/academic-brain\.tar\.gz$/)
  assert.match(brainUrl('operational'), /releases\/latest\/download\/operational-brain\.tar\.gz$/)
  // explicit override wins
  process.env['NOETICA_BRAIN_ACADEMIC_URL'] = 'https://example.com/my-brain.tar.gz'
  assert.equal(brainUrl('academic'), 'https://example.com/my-brain.tar.gz')
  delete process.env['NOETICA_BRAIN_ACADEMIC_URL']
  // base override
  process.env['NOETICA_RELEASE_BASE_URL'] = 'https://cdn.example.com/brains'
  assert.equal(brainUrl('operational'), 'https://cdn.example.com/brains/operational-brain.tar.gz')
  delete process.env['NOETICA_RELEASE_BASE_URL']
})
