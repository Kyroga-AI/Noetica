/** Tests for the file-path confinement predicate — esp. the sibling-dir traversal it must reject. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as path from 'node:path'
import { isConfinedToHomeOrTmp } from './path-confine.js'

const home = path.resolve(os.homedir())

test('allows the home dir and files strictly inside it', () => {
  assert.equal(isConfinedToHomeOrTmp(home), true)
  assert.equal(isConfinedToHomeOrTmp(path.join(home, 'docs', 'a.txt')), true)
})

test('allows /tmp and the OS tmpdir', () => {
  assert.equal(isConfinedToHomeOrTmp('/tmp'), true)
  assert.equal(isConfinedToHomeOrTmp('/tmp/x'), true)
  assert.equal(isConfinedToHomeOrTmp(path.join(path.resolve(os.tmpdir()), 'y')), true)
})

test('REJECTS sibling-dir traversal (the missing path.sep bug)', () => {
  // `<home>-evil` and `/tmpfoo` used to pass the un-anchored startsWith(home)/startsWith("/tmp").
  assert.equal(isConfinedToHomeOrTmp(home + '-evil/secrets'), false)
  assert.equal(isConfinedToHomeOrTmp('/tmpfoo/passwd'), false)
})

test('rejects an unrelated absolute path', () => {
  assert.equal(isConfinedToHomeOrTmp('/etc/passwd'), false)
})
