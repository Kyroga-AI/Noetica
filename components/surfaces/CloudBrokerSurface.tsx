'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

/**
 * CloudBrokerSurface — the C2 control plane over cloud compute. Brokers a workload to the cheapest satisfying
 * provider across GCP/Azure/AWS/IBM + the local mesh (live Azure prices when "Live prices" is on), shows the
 * ranked quotes + savings + the agentplane-conformant placement, and lists lattice-forge runtime provenance.
 */
type Quote = { sku: { provider: string; name: string; region: string; vcpus: number; memGiB: number; gpu?: { type: string; count: number; memGiB: number }; priceSource?: 'live' | 'list' }; effectivePerHour: number; totalUsd: number; spot: boolean }
type Provision = { provider: string; sku: string; region: string; state: string; usdPerHour: number; executor: { name: string; caps: Record<string, unknown> }; createCommand: string; error?: string }
type BrokerResp = {
  best: Quote | null; ranked: Quote[]; considered: number; cheapestCloud: Quote | null; priceSource?: string
  savings: { absUsd: number; pct: number }
  placement: { apiVersion: string; kind: string; lane: string; chosenExecutor: string | null; effectiveBackend: string; objective: { value: number; perHour: number; spot: boolean } }
  provision?: Provision | null
}
type RuntimeAsset = { name?: string; role?: string; runtimeClass?: string; digest?: string; _conformance?: { conforms: boolean; missing: string[] } }
type FleetExecutor = { name: string; provider?: string; region?: string; usdPerHour?: number; state?: string; caps?: { os?: string; arch?: string; gpu?: string } }
type FleetSwarm = { swarmId: string; backend: string; mounted: boolean; members: number; live: number }
type FleetResp = { count: number; totalUsdPerHour: number; byProvider: Record<string, number>; byState: Record<string, number>; executors: FleetExecutor[]; swarms?: FleetSwarm[]; liveMembers?: number }

const PROVIDER_COLOR: Record<string, string> = {
  gcp: 'bg-[#e8f0fe] text-[#1a73e8]', azure: 'bg-[#e5f1fb] text-[#0078d4]', aws: 'bg-[#fff3e0] text-[#ec912d]',
  ibm: 'bg-[#f0f0ff] text-[#4f46e5]', local: 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
}

export function CloudBrokerSurface() {
  const [gpu, setGpu] = useState('A100')
  const [count, setCount] = useState(1)
  const [hours, setHours] = useState(24)
  const [spot, setSpot] = useState(true)
  const [live, setLive] = useState(false)
  const [excludeLocal, setExcludeLocal] = useState(true)
  const [resp, setResp] = useState<BrokerResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [runtimes, setRuntimes] = useState<RuntimeAsset[]>([])
  const [fleet, setFleet] = useState<FleetResp | null>(null)

  const [provisioning, setProvisioning] = useState(false)

  function reqBody(extra: Record<string, unknown> = {}) {
    const request: Record<string, unknown> = { hours, spot, excludeLocal }
    if (gpu !== 'none') request.gpu = { type: gpu, count }
    return JSON.stringify({ request, live, ...extra })
  }

  async function broker() {
    setLoading(true); setErr('')
    try {
      const r = await fetch(amUrl('/api/cap/cloud-broker'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: reqBody() })
      if (!r.ok) throw new Error(`broker ${r.status}`)
      setResp(await r.json() as BrokerResp)
    } catch (e) { setErr(e instanceof Error ? e.message : 'broker failed — is the backend running?') }
    finally { setLoading(false) }
  }

  async function provision() {
    setProvisioning(true); setErr('')
    try {
      const r = await fetch(amUrl('/api/cap/cloud-broker'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: reqBody({ provision: true, swarmId: 'session' }) })
      if (!r.ok) throw new Error(`provision ${r.status}`)
      setResp(await r.json() as BrokerResp)
      loadFleet()   // a new executor was registered — refresh the fleet panel
    } catch (e) { setErr(e instanceof Error ? e.message : 'provision failed') }
    finally { setProvisioning(false) }
  }

  function loadFleet() {
    void fetch(amUrl('/api/fleet')).then((r) => r.ok ? r.json() : null).then((j: FleetResp | null) => { if (j) setFleet(j) }).catch(() => {})
  }
  useEffect(() => {
    void fetch(amUrl('/api/cap/runtime-assets'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.ok ? r.json() : null).then((j: { assets?: RuntimeAsset[] } | null) => { if (j?.assets) setRuntimes(j.assets) }).catch(() => {})
    loadFleet()
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Cloud Broker</div>
      <p className="mb-5 max-w-2xl text-xs text-[var(--color-text-secondary)]">Route a workload to the cheapest satisfying provider across GCP / Azure / AWS / IBM and the local mesh — governed by scope-d, provenance-stamped, and emitted as an agentplane placement. Turn on <span className="font-medium">Live prices</span> to rank against real Azure rates.</p>

      {/* Workload form */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">GPU
          <select value={gpu} onChange={(e) => setGpu(e.target.value)} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
            <option value="A100">A100</option><option value="L4">L4 / A10</option><option value="none">CPU only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Count
          <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} className="w-16 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]">Hours
          <input type="number" min={1} value={hours} onChange={(e) => setHours(Math.max(1, +e.target.value))} className="w-20 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={spot} onChange={(e) => setSpot(e.target.checked)} /> Spot</label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={excludeLocal} onChange={(e) => setExcludeLocal(e.target.checked)} /> Cloud only</label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live prices</label>
        <button onClick={broker} disabled={loading} className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">{loading ? 'Brokering…' : 'Broker to cheapest'}</button>
      </div>

      {err && <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{err}</div>}

      {resp && (
        <div className="mt-5">
          {resp.best && (
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-2xl border border-[#bbf7d0] bg-[var(--color-accent-bg)] px-4 py-3">
              <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-accent)]">Cheapest</div><div className="text-sm font-bold text-[var(--color-text-primary)]"><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${PROVIDER_COLOR[resp.best.sku.provider] ?? ''}`}>{resp.best.sku.provider}</span>{resp.best.sku.name} · {resp.best.sku.region}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Total ({hours}h{resp.best.spot ? ', spot' : ''})</div><div className="text-sm font-bold text-[var(--color-accent)]">${resp.best.totalUsd}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Savings vs dearest</div><div className="text-sm font-semibold text-[var(--color-text-primary)]">${resp.savings.absUsd} ({resp.savings.pct}%)</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Prices</div><div className="text-xs font-medium text-[var(--color-text-secondary)]">{resp.priceSource}</div></div>
            </div>
          )}
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-[var(--color-border-secondary)] text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]"><th className="py-1.5">Provider</th><th>SKU</th><th>Region</th><th>Specs</th><th className="text-right">$/hr</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {resp.ranked.map((q, i) => (
                <tr key={i} className={`border-b border-[var(--color-border-tertiary)] ${i === 0 ? 'font-semibold' : ''}`}>
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${PROVIDER_COLOR[q.sku.provider] ?? ''}`}>{q.sku.provider}</span></td>
                  <td className="font-mono text-[11px]">{q.sku.name}</td><td>{q.sku.region}</td>
                  <td className="text-[var(--color-text-secondary)]">{q.sku.gpu ? `${q.sku.gpu.count}× ${q.sku.gpu.type}` : `${q.sku.vcpus} vCPU`}</td>
                  <td className="text-right">${q.effectivePerHour}{q.spot ? ' ·spot' : ''} <span title={q.sku.priceSource === 'live' ? 'real-time billing API' : 'static list estimate — no live API for this provider'} className={`ml-1 rounded px-1 py-0.5 text-[11px] font-semibold ${q.sku.priceSource === 'live' ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>{q.sku.priceSource === 'live' ? 'live' : 'list'}</span></td><td className="text-right">${q.totalUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {resp.placement && (
            <div className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">agentplane placement</span> · {resp.placement.kind} · lane {resp.placement.lane} · executor <span className="font-mono">{resp.placement.chosenExecutor ?? '—'}</span> · backend {resp.placement.effectiveBackend}
            </div>
          )}

          {/* Provision the cheapest pick into the fleet + swarm */}
          {resp.best && resp.best.sku.provider !== 'local' && (
            <div className="mt-3">
              <button onClick={provision} disabled={provisioning} className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-50">
                {provisioning ? 'Provisioning…' : `⊕ Provision cheapest (${resp.best.sku.provider})`}
              </button>
              {resp.provision && (
                <div className="mt-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                  <div><span className="font-semibold text-[var(--color-text-primary)]">{resp.provision.executor.name}</span> · state <span className={`font-semibold ${resp.provision.state === 'ready' ? 'text-[var(--color-accent)]' : resp.provision.state === 'failed' ? 'text-[#dc2626]' : 'text-[var(--color-attention)]'}`}>{resp.provision.state}</span> · ${resp.provision.usdPerHour}/hr · joins fleet + swarm</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">{resp.provision.createCommand}</div>
                  {resp.provision.error && <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">⚠ {resp.provision.error}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lattice-forge runtime provenance */}
      {/* Fleet — provisioned cloud executors (the C2/swarm inventory) */}
      <div className="mt-7">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Fleet <span className="text-[11px] font-normal text-[var(--color-text-tertiary)]">(provisioned executors)</span></div>
          {fleet && fleet.count > 0 && (
            <div className="text-[11px] text-[var(--color-text-secondary)]">{fleet.count} executor{fleet.count === 1 ? '' : 's'} · <span className="font-semibold text-[var(--color-accent)]">${fleet.totalUsdPerHour}/hr</span> · {Object.entries(fleet.byProvider).map(([p, n]) => `${n} ${p}`).join(', ')}</div>
          )}
        </div>
        {!fleet || fleet.count === 0
          ? <div className="text-xs text-[var(--color-text-tertiary)]">No executors provisioned yet — broker a workload above and hit Provision to spin up the swarm.</div>
          : <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {fleet.executors.map((e, i) => {
                const dot = e.state === 'ready' ? 'bg-[var(--color-accent)]' : e.state === 'provisioning' ? 'bg-[var(--color-attention)]' : e.state === 'failed' ? 'bg-[#dc2626]' : 'bg-[var(--color-text-tertiary)]'
                return (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} /><span className="truncate font-mono text-[11px] text-[var(--color-text-primary)]">{e.name}</span></div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{e.provider} · {e.region} · {e.caps?.gpu ?? e.caps?.arch ?? 'cpu'} · {e.state}</div>
                    </div>
                    {typeof e.usdPerHour === 'number' && <span className="shrink-0 text-[11px] font-semibold text-[var(--color-text-secondary)]">${e.usdPerHour}/hr</span>}
                  </div>
                )
              })}
            </div>}

        {/* Swarms — the local shared-volume coordination layer (agents that joined a swarm) */}
        {fleet?.swarms && fleet.swarms.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">Swarms <span className="text-[11px] text-[var(--color-text-tertiary)]">· {fleet.liveMembers ?? 0} live member{(fleet.liveMembers ?? 0) === 1 ? '' : 's'} on the shared volume</span></div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {fleet.swarms.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${s.live > 0 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-tertiary)]'}`} /><span className="truncate font-mono text-[11px] text-[var(--color-text-primary)]">{s.swarmId}</span></div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{s.backend}{s.mounted ? ' · mounted' : ''} · {s.live}/{s.members} agent{s.members === 1 ? '' : 's'} live</div>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-[var(--color-text-secondary)]">{s.live}/{s.members}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-7">
        <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Runtime registry <span className="text-[11px] font-normal text-[var(--color-text-tertiary)]">(lattice-forge provenance)</span></div>
        {runtimes.length === 0
          ? <div className="text-xs text-[var(--color-text-tertiary)]">No runtime assets (backend offline?).</div>
          : <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {runtimes.map((a, i) => (
                <div key={i} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                  <div className="flex items-center justify-between"><span className="truncate font-mono text-[11px] text-[var(--color-text-primary)]">{a.name}</span>{a._conformance && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${a._conformance.conforms ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[#fef2f2] text-[#dc2626]'}`}>{a._conformance.conforms ? 'conformant' : 'gaps'}</span>}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{a.role}{a.runtimeClass ? ` · ${a.runtimeClass}` : ''}</div>
                </div>
              ))}
            </div>}
      </div>
    </div>
  )
}
