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

test('provisionBrain refuses cleanly when no URL is configured', async () => {
  delete process.env['NOETICA_BRAIN_ACADEMIC_URL']
  const { provisionBrain } = await import('./brain-provision.js')
  const r = await provisionBrain('academic')
  assert.equal(r.ok, false)
  assert.match(r.message, /no download url configured/i)
})
