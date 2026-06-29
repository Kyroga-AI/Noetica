import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractBlock } from './sprint-contract.js'
import type { SprintContract } from './sprint-contract.js'

test('contractBlock: formats empty contract as empty string', () => {
  const c: SprintContract = { criteria: [], testCommands: [] }
  assert.equal(contractBlock(c), '')
})

test('contractBlock: formats criteria and test commands', () => {
  const c: SprintContract = {
    criteria: ['login returns 200', 'users list is array'],
    testCommands: ['curl -sf http://localhost:8000/login | grep 200', 'curl -sf http://localhost:8000/users | python3 -c "import sys,json; assert isinstance(json.load(sys.stdin),list)"'],
  }
  const block = contractBlock(c)
  assert.ok(block.includes('login returns 200'))
  assert.ok(block.includes('users list is array'))
  assert.ok(block.includes('SUCCESS CRITERIA'))
})

test('contractBlock: handles mismatched arrays gracefully', () => {
  const c: SprintContract = { criteria: ['a', 'b'], testCommands: ['echo a'] }
  assert.doesNotThrow(() => contractBlock(c))
})
