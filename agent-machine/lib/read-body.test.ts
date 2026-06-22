/** Tests for the shared, size-capped request-body reader. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import type * as http from 'node:http'
import { readBody } from './read-body.js'

test('reads the full body', async () => {
  const req = new PassThrough()
  const p = readBody(req as unknown as http.IncomingMessage)
  req.end(Buffer.from('hello world'))
  assert.equal(await p, 'hello world')
})

test('rejects a body over the cap (and stops buffering)', async () => {
  const req = new PassThrough()
  const p = readBody(req as unknown as http.IncomingMessage, 16)
  req.write(Buffer.alloc(64, 0x61)) // 64 bytes > 16-byte cap
  await assert.rejects(p, /too large/)
})

test('propagates stream errors', async () => {
  const req = new PassThrough()
  const p = readBody(req as unknown as http.IncomingMessage)
  req.destroy(new Error('boom'))
  await assert.rejects(p, /boom/)
})
