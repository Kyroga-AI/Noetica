/**
 * tritrpc-transport.ts — the TypeScript BINDING to TriRPC. NOT a codec reimplementation.
 *
 * Byte-exact framing (TritPack243/AEAD) is delegated to the canonical Rust codec
 * (SocioProphet/tritrpc rust/tritrpc_v1), reached over the UDS TriRPC sockets that
 * sourceos-a2a-mcp-bootstrap provides (`.mcp/servers.json → UDS`). This side only:
 *   1. builds a canonical-JSON envelope (header/sender/payload/error),
 *   2. speaks it (newline-delimited JSON) to the gateway socket, which frames it, and
 *   3. emits rpc.* receipt events (envelope_hash + latency/bytes) for agentplane sealing.
 * Conforms to tritrpc/spec/transport/receipt_binding.md. Per [[reference_tritrpc]], the TS side stays a
 * thin binding; byte-parity lives in Rust/Go — we never hand-roll the wire codec here.
 */
import net from 'node:net'
import { createHash, randomUUID } from 'node:crypto'

export interface TriRpcEnvelope {
  header: { version: number; msg_id: string; ts_ms: number }
  sender: { service: string; method: string; metadata?: Record<string, string> }
  payload?: unknown
  error?: { code: number; message: string }
}

export type RpcEventType = 'rpc.request.sent' | 'rpc.response.received' | 'rpc.retry' | 'rpc.fail'
export interface RpcEvent {
  type: RpcEventType
  transport: 'tritrpc'
  envelope_hash: string
  route_id?: string
  peer_id?: string
  request_bytes?: number
  response_bytes?: number
  latency_ms?: number
  retry_count?: number
  failure_class?: string
  ts_ms: number
}

// JCS-ish canonical JSON (stable key order) so the envelope_hash is deterministic across peers.
function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') {
    return Object.keys(x as Record<string, unknown>).sort().reduce<Record<string, unknown>>((o, k) => {
      o[k] = sortKeys((x as Record<string, unknown>)[k]); return o
    }, {})
  }
  return x
}
const canonical = (o: unknown) => JSON.stringify(sortKeys(o))
export function envelopeHash(env: TriRpcEnvelope): string {
  return 'sha256:' + createHash('sha256').update(canonical(env)).digest('hex')
}

export function buildEnvelope(service: string, method: string, payload?: unknown, metadata?: Record<string, string>): TriRpcEnvelope {
  return { header: { version: 1, msg_id: randomUUID(), ts_ms: Date.now() }, sender: { service, method, ...(metadata ? { metadata } : {}) }, payload }
}

export interface TriRpcOptions {
  socketPath: string
  route_id?: string
  peer_id?: string
  timeoutMs?: number
  onEvent?: (e: RpcEvent) => void
}

/** A UDS-socket client speaking canonical-JSON envelopes to the a2a-mcp TriRPC gateway. */
export class TriRpcClient {
  constructor(private opts: TriRpcOptions) {}

  private emit(e: Omit<RpcEvent, 'transport' | 'ts_ms'>) {
    this.opts.onEvent?.({ transport: 'tritrpc', ts_ms: Date.now(), route_id: this.opts.route_id, peer_id: this.opts.peer_id, ...e })
  }

  call(service: string, method: string, payload?: unknown, metadata?: Record<string, string>): Promise<TriRpcEnvelope> {
    const env = buildEnvelope(service, method, payload, metadata)
    const hash = envelopeHash(env)
    const line = canonical(env) + '\n'
    const requestBytes = Buffer.byteLength(line)
    const started = Date.now()
    this.emit({ type: 'rpc.request.sent', envelope_hash: hash, request_bytes: requestBytes })

    return new Promise<TriRpcEnvelope>((resolve, reject) => {
      const sock = net.createConnection(this.opts.socketPath)
      let buf = ''
      let settled = false
      const done = (fn: () => void) => { if (!settled) { settled = true; sock.destroy(); fn() } }
      const timer = setTimeout(() => {
        this.emit({ type: 'rpc.fail', envelope_hash: hash, failure_class: 'deadline_exceeded', latency_ms: Date.now() - started })
        done(() => reject(new Error('tritrpc timeout')))
      }, this.opts.timeoutMs ?? 10_000)

      sock.on('connect', () => sock.write(line))
      sock.on('data', (d: Buffer) => {
        buf += d.toString()
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        clearTimeout(timer)
        const respLine = buf.slice(0, nl)
        try {
          const resp = JSON.parse(respLine) as TriRpcEnvelope
          this.emit({ type: 'rpc.response.received', envelope_hash: hash, response_bytes: Buffer.byteLength(respLine), latency_ms: Date.now() - started })
          if (resp.error) done(() => reject(new Error(`tritrpc ${resp.error!.code}: ${resp.error!.message}`)))
          else done(() => resolve(resp))
        } catch (e) {
          this.emit({ type: 'rpc.fail', envelope_hash: hash, failure_class: 'decode_error', latency_ms: Date.now() - started })
          done(() => reject(e instanceof Error ? e : new Error('decode error')))
        }
      })
      sock.on('error', (e) => {
        clearTimeout(timer)
        this.emit({ type: 'rpc.fail', envelope_hash: hash, failure_class: 'upstream_unreachable', latency_ms: Date.now() - started })
        done(() => reject(e))
      })
    })
  }
}
