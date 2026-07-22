/**
 * federation-participant — Noetica's client half of the org super-peer
 * (prophet-platform apps/hellgraph-service/src/federation.ts is the server half).
 *
 * The membership model: the user opts in ONCE by pasting the org's federation base key.
 * This module then keeps a sovereign FederatedAtomSpace bootstrapped from that key and
 * PUMPS the local knowledge graph into it — local writes percolate to the org graph
 * automatically, no publish button. Until the org admits this machine's writer key the
 * participant is silently local-only (reads replicate in, nothing leaves) — that is the
 * correct unadmitted behavior, not an error.
 *
 * Atoms travel as the engine's regis mapping (nodeToEntry): content-addressed handles,
 * so re-pumping the same node collapses to one atom — the pump can be naive and safe.
 * Nodes only in this slice (matching the engine's regis slice); edges are a follow-up.
 *
 * Transport: Hyperswarm discovery by base key (optional dep, FEDERATION_SWARM=0 or
 * absence degrades to direct replication only). State lives under ~/.noetica via the
 * at-rest helpers, same as every sovereign store here.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { FederatedAtomSpace, getHellGraph, nodeToEntry } from '@socioprophet/hellgraph'
import { readJson, writeJson } from './at-rest.js'

// lazy: ESM imports hoist, so a test's process.env assignment must still win
const statePath = (): string =>
  process.env['FEDERATION_STATE'] || path.join(os.homedir(), '.noetica', 'federation.json')
const PUMP_MS = Number(process.env['FEDERATION_PUMP_MS'] || 15_000)

interface FederationState { baseKey: string }

let fas: FederatedAtomSpace | null = null
let swarm: { destroy: () => Promise<void> } | null = null
let pumpTimer: ReturnType<typeof setInterval> | null = null
let lastError = ''
const pumped = new Set<string>()

/** The live FederatedAtomSpace (tests pipe replication streams through this). */
export function federationHandle(): FederatedAtomSpace | null {
  return fas
}

export function federationStatus(): Record<string, unknown> {
  if (!fas) return { enabled: false, ...(lastError ? { lastError } : {}) }
  return {
    enabled: true,
    baseKey: fas.baseKey(),
    // the key the ORG ADMIN must admit — the UI surfaces this for the one-time opt-in
    writerKey: fas.localWriterKey(),
    writable: fas.isWritable(),
    pumped: pumped.size,
    ...(lastError ? { lastError } : {}),
  }
}

/** One pump pass: every local graph node not yet federated → appendEntry (only when
 *  admitted). Exported for tests; production runs it on an interval. */
export async function pumpOnce(): Promise<number> {
  if (!fas) return 0
  await fas.update()
  if (!fas.isWritable()) return 0                    // unadmitted → local-only, silently
  const g = getHellGraph()
  let sent = 0
  for (const node of g.allNodes() as Array<{ id: string; labels?: string[]; properties?: Record<string, unknown> }>) {
    if (pumped.has(node.id)) continue
    const entry = nodeToEntry({ node_id: node.id, kind: node.labels?.[0] || 'Node',
                                attrs: node.properties ?? {} })
    await fas.appendEntry(entry)
    pumped.add(node.id)
    sent++
  }
  return sent
}

async function joinSwarmIfEnabled(baseKey: string): Promise<void> {
  if (process.env['FEDERATION_SWARM'] === '0') return
  try {
    const { default: Hyperswarm } = await import('hyperswarm' as string) as { default: new () => {
      join: (topic: Buffer, opts?: Record<string, unknown>) => unknown
      on: (ev: string, fn: (conn: unknown) => void) => void
      destroy: () => Promise<void>
    } }
    const s = new Hyperswarm()
    s.on('connection', (conn) => { fas?.replicateThrough(conn) })
    s.join(Buffer.from(baseKey, 'hex'), { server: false, client: true })
    swarm = s
    console.log('[federation] hyperswarm joined — replicating to the org by base key')
  } catch (e) {
    console.error(`[federation] swarm unavailable (hyperswarm optional) — direct replication only: ${String((e as Error)?.message ?? e)}`)
  }
}

async function open(baseKey: string): Promise<void> {
  const dir = process.env['FEDERATION_DIR'] || path.join(os.homedir(), '.noetica', 'federation')
  fas = await FederatedAtomSpace.create(dir, { bootstrap: baseKey })
  await joinSwarmIfEnabled(baseKey)
  if (!pumpTimer && process.env['FEDERATION_PUMP'] !== '0') {
    pumpTimer = setInterval(() => { void pumpOnce().catch((e) => { lastError = String((e as Error)?.message ?? e) }) }, PUMP_MS)
    pumpTimer.unref?.()                              // never hold the process open for the pump
  }
  lastError = ''
}

/** THE one-time opt-in: persist the org base key and join its federation. Returns the
 *  writer key the org admin must admit. Everything after admission is automatic. */
export async function optIn(baseKey: string): Promise<{ writerKey: string }> {
  if (!/^[0-9a-f]{64}$/i.test(baseKey)) throw new Error('baseKey must be the org federation key (64 hex chars)')
  await open(baseKey)
  writeJson(statePath(), { baseKey } satisfies FederationState)
  return { writerKey: fas!.localWriterKey() }
}

/** Leave the federation: stop pumping + discovery and forget the opt-in. Already-shared
 *  atoms remain in the org graph (revocation of PAST contributions is an org-side
 *  governance action, not a client toggle). */
export async function optOut(): Promise<void> {
  if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null }
  if (swarm) { await swarm.destroy().catch(() => {}); swarm = null }
  const anyFas = fas as unknown as { close?: () => Promise<void> } | null
  await anyFas?.close?.()?.catch?.(() => {})
  fas = null
  pumped.clear()
  writeJson(statePath(), { baseKey: '' })
}

/** Boot hook: rejoin a previously opted-in federation (no-op when never opted in). */
export async function initFederation(): Promise<void> {
  const state = readJson<FederationState>(statePath())
  if (!state?.baseKey) return
  try {
    await open(state.baseKey)
    console.log(`[federation] rejoined org federation — writer=${fas?.localWriterKey().slice(0, 12)}… writable=${fas?.isWritable()}`)
  } catch (e) {
    lastError = String((e as Error)?.message ?? e)
    console.error(`[federation] rejoin failed (machine continues unfederated): ${lastError}`)
  }
}
