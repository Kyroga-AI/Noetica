import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpClient, parseMcpToolName, mcpToolName, isMcpTool, type Transport } from './mcp-client.js'

/** A fake transport that answers JSON-RPC requests with canned results — no process spawn. */
class FakeTransport implements Transport {
  private handler: (m: any) => void = () => {}
  sent: any[] = []
  tools = [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }]
  async start() { /* nothing to boot */ }
  onMessage(h: (m: any) => void) { this.handler = h }
  send(msg: any) {
    this.sent.push(msg)
    if (msg.id == null) return // notification
    // Answer asynchronously, like a real server.
    queueMicrotask(() => {
      if (msg.method === 'initialize') this.handler({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake' } } })
      else if (msg.method === 'tools/list') this.handler({ jsonrpc: '2.0', id: msg.id, result: { tools: this.tools } })
      else if (msg.method === 'tools/call') {
        if (msg.params.name === 'boom') this.handler({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'kaboom' }], isError: true } })
        else this.handler({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `contents of ${msg.params.arguments.path}` }] } })
      }
    })
  }
  close() {}
}

test('connect does the handshake + discovers tools', async () => {
  const t = new FakeTransport()
  const c = new McpClient('fs', t)
  await c.connect()
  assert.equal(c.isConnected(), true)
  assert.deepEqual(c.listTools().map((x) => x.name), ['read_file'])
  // handshake order: initialize → notifications/initialized → tools/list
  assert.equal(t.sent[0].method, 'initialize')
  assert.equal(t.sent[1].method, 'notifications/initialized')
  assert.equal(t.sent[1].id, undefined)  // a notification has no id
  assert.equal(t.sent[2].method, 'tools/list')
})

test('callTool flattens content blocks to a string', async () => {
  const c = new McpClient('fs', new FakeTransport())
  await c.connect()
  const out = await c.callTool('read_file', { path: '/etc/hosts' })
  assert.equal(out, 'contents of /etc/hosts')
})

test('callTool surfaces tool errors', async () => {
  const c = new McpClient('fs', new FakeTransport())
  await c.connect()
  const out = await c.callTool('boom', {})
  assert.match(out, /Error from fs\/boom: kaboom/)
})

test('tool-name namespacing round-trips', () => {
  assert.equal(mcpToolName('fs', 'read_file'), 'mcp__fs__read_file')
  assert.deepEqual(parseMcpToolName('mcp__fs__read_file'), { server: 'fs', tool: 'read_file' })
  assert.deepEqual(parseMcpToolName('mcp__git__commit_changes'), { server: 'git', tool: 'commit_changes' })
  assert.equal(parseMcpToolName('web_search'), null)   // a built-in, not MCP
  assert.equal(isMcpTool('mcp__fs__read_file'), true)
  assert.equal(isMcpTool('web_search'), false)
})

test('a request rejects on RPC error', async () => {
  class ErrTransport extends FakeTransport {
    override send(msg: any) {
      this.sent.push(msg)
      if (msg.method === 'initialize') queueMicrotask(() => (this as any).handler({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'nope' } }))
    }
  }
  const c = new McpClient('bad', new ErrTransport())
  await assert.rejects(() => c.connect(), /nope/)
})
