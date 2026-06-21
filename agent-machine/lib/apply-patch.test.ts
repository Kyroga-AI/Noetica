import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEdit, applyEdits, editSummary } from './apply-patch.js'

test('applyEdit replaces a unique occurrence', () => {
  const r = applyEdit('const x = 1\nconst y = 2', 'const x = 1', 'const x = 42')
  assert.ok(r.ok)
  assert.equal(r.ok && r.content, 'const x = 42\nconst y = 2')
  assert.equal(r.ok && r.replacements, 1)
})

test('applyEdit fails when old_string is not found', () => {
  const r = applyEdit('hello world', 'goodbye', 'hi')
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.error : '', /not found/)
})

test('applyEdit fails on ambiguous (non-unique) match without replace_all', () => {
  const r = applyEdit('a\na\na', 'a', 'b')
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.error : '', /not unique.*3 places/)
})

test('applyEdit with replace_all changes every occurrence', () => {
  const r = applyEdit('a\na\na', 'a', 'b', { replaceAll: true })
  assert.ok(r.ok)
  assert.equal(r.ok && r.content, 'b\nb\nb')
  assert.equal(r.ok && r.replacements, 3)
})

test('applyEdit rejects empty and identical strings', () => {
  assert.equal(applyEdit('x', '', 'y').ok, false)
  assert.equal(applyEdit('x', 'x', 'x').ok, false)
})

test('applyEdit preserves exact whitespace/indentation in the match', () => {
  const src = 'function f() {\n    return 1\n}'
  const r = applyEdit(src, '    return 1', '    return 42')
  assert.ok(r.ok)
  assert.equal(r.ok && r.content, 'function f() {\n    return 42\n}')
})

test('applyEdits applies a sequence, later edits see earlier changes', () => {
  const r = applyEdits('let a = 1', [
    { oldString: 'let a = 1', newString: 'let a = 2' },
    { oldString: 'let a = 2', newString: 'const a = 2' },
  ])
  assert.ok(r.ok)
  assert.equal(r.ok && r.content, 'const a = 2')
  assert.equal(r.ok && r.replacements, 2)
})

test('applyEdits fails atomically on the first bad edit and names it', () => {
  const r = applyEdits('x = 1', [
    { oldString: 'x = 1', newString: 'x = 2' },
    { oldString: 'nope', newString: 'y' },
  ])
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.error : '', /edit 2\/2/)
})

test('editSummary reports replacements and line delta', () => {
  assert.match(editSummary('a\nb', 'a\nb\nc', 1), /1 replacement, \+1 line/)
})
