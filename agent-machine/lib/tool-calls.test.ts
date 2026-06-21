import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInlineToolCalls } from './tool-calls.js'

const TOOLS = new Set(['list_directory', 'read_file', 'write_file', 'code_execute', 'web_search'])

test('structured <tool_call> tag (the format our system prompt requests)', () => {
  const { calls, cleaned } = parseInlineToolCalls(
    '<tool_call>\n{"name": "list_directory", "arguments": {"path": "~"}}\n</tool_call>',
    TOOLS,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'list_directory')
  assert.deepEqual(calls[0]!.input, { path: '~' })
  assert.equal(cleaned, '')
})

test('```json fenced tool call (the exact shape from the harddrive bug)', () => {
  const text = 'Let me list the root directory.\n```json\n{"name": "list_directory", "arguments": {"path": "~"}}\n```'
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'list_directory')
  // prose survives, the fence is consumed
  assert.equal(cleaned, 'Let me list the root directory.')
})

test('single bare object that is the whole message', () => {
  const { calls } = parseInlineToolCalls('{"name": "read_file", "arguments": {"path": "/tmp/x"}}', TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'read_file')
})

test('multiple pretty-printed bare objects (the qwen-coder write+read case)', () => {
  const text = `{
  "name": "write_file",
  "arguments": { "path": "/tmp/p.txt", "content": "hi" }
}
{
  "name": "read_file",
  "arguments": { "path": "/tmp/p.txt" }
}`
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((c) => c.name), ['write_file', 'read_file'])
  assert.equal(calls[0]!.input['content'], 'hi')
  assert.equal(cleaned, '')
})

test('"parameters" and "input" are accepted as argument aliases', () => {
  const a = parseInlineToolCalls('{"name":"web_search","parameters":{"query":"x"}}', TOOLS)
  assert.deepEqual(a.calls[0]!.input, { query: 'x' })
  const b = parseInlineToolCalls('{"name":"web_search","input":{"query":"y"}}', TOOLS)
  assert.deepEqual(b.calls[0]!.input, { query: 'y' })
})

test('unknown tool names are ignored, not executed', () => {
  const { calls, cleaned } = parseInlineToolCalls('{"name": "rm_rf_everything", "arguments": {}}', TOOLS)
  assert.equal(calls.length, 0)
  // left intact so it surfaces as normal text rather than vanishing
  assert.ok(cleaned.includes('rm_rf_everything'))
})

test('non-tool JSON in prose is preserved, not swallowed', () => {
  const text = 'Here is some config: {"port": 8080, "host": "localhost"} — use it.'
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 0)
  assert.equal(cleaned, text)
})

test('pseudo-code / hallucinated tool syntax yields no calls (cannot be parsed)', () => {
  const text = 'I will call m.write_file("/tmp/x", "data") then #system.read("/tmp/x")'
  const { calls } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 0)
})

test('plain prose with no tool call returns empty + unchanged text', () => {
  const text = 'The capital of France is Paris.'
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 0)
  assert.equal(cleaned, text)
})

test('braces inside string values do not break extraction', () => {
  const { calls } = parseInlineToolCalls('{"name":"write_file","arguments":{"path":"/tmp/x","content":"a } b { c"}}', TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.input['content'], 'a } b { c')
})

test('tool call embedded after prose keeps the prose in cleaned', () => {
  const text = 'Sure, let me check that for you.\n<tool_call>{"name":"list_directory","arguments":{"path":"/etc"}}</tool_call>'
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(cleaned, 'Sure, let me check that for you.')
})

test('single-quoted string value (the qwen code_execute leak) is recovered via JSON5', () => {
  // The exact malformed shape observed: code wrapped in single quotes (invalid JSON),
  // containing embedded double quotes and \n escapes, plus an orphan closing tag.
  const text = `{"name": "code_execute", "arguments": {"language": "python", "code": 'def reverse_string(s):\\n return s[::-1]\\nsentence = "hello world"\\nresult = reverse_string(sentence)\\nprint(result)'}}\n</tool_call>`
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'code_execute')
  assert.equal(calls[0]!.input['language'], 'python')
  assert.ok((calls[0]!.input['code'] as string).includes('return s[::-1]'))
  assert.ok((calls[0]!.input['code'] as string).includes('"hello world"'))
  // nothing leaks — including the orphan </tool_call> tag
  assert.equal(cleaned, '')
})

test('unquoted keys and trailing commas are tolerated', () => {
  const { calls } = parseInlineToolCalls("{name: 'web_search', arguments: {query: 'local-first ai',}}", TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'web_search')
  assert.equal(calls[0]!.input['query'], 'local-first ai')
})

test('orphan </tool_call> with no opening tag still yields the call and clean text', () => {
  const text = `{"name": "list_directory", "arguments": {"path": "~"}}\n</tool_call>`
  const { calls, cleaned } = parseInlineToolCalls(text, TOOLS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'list_directory')
  assert.equal(cleaned, '')
})
