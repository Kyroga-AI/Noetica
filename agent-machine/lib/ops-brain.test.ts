/** Tests for the operations-brain lexical lane. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function writeCorpus(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-'))
  const corpus = path.join(dir, 'manpages.jsonl')
  fs.writeFileSync(corpus, [
    { text: 'grep searches the named input files for lines containing a match to the given pattern', subject: 'grep', man_section: '1', domain: 'text' },
    { text: 'tar is an archiving utility that stores and extracts files from a tape or disk archive', subject: 'tar', man_section: '1', domain: 'archive' },
    { text: 'ps reports a snapshot of the current processes running on the system', subject: 'ps', man_section: '1', domain: 'process' },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n')
  return corpus
}

test('ready=false when the corpus is missing; retrieve returns []', async () => {
  process.env['OPS_CORPUS'] = path.join(os.tmpdir(), 'no-such-ops-corpus.jsonl')
  const m = await import('./ops-brain.js')
  m._resetOpsBrainCache()
  assert.equal(m.opsBrainReady(), false)
  assert.deepEqual(m.opsBrainRetrieve('anything'), [])
})

test('lexical retrieval surfaces the on-topic manpage', async () => {
  process.env['OPS_CORPUS'] = writeCorpus()
  const m = await import('./ops-brain.js')
  m._resetOpsBrainCache()
  assert.equal(m.opsBrainReady(), true)
  const hits = m.opsBrainRetrieve('how do I search files for a matching pattern with grep', 3)
  assert.ok(hits.length > 0)
  assert.equal(hits[0]!.subject, 'grep') // term overlap + subject boost
  assert.equal(hits[0]!.scope, 'operational')
})

test('an unrelated query returns no confident ops hits', async () => {
  process.env['OPS_CORPUS'] = writeCorpus()
  const m = await import('./ops-brain.js')
  m._resetOpsBrainCache()
  const hits = m.opsBrainRetrieve('photosynthesis chlorophyll mitochondria', 3)
  assert.equal(hits.length, 0)
})
