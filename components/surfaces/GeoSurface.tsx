'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * GeoSurface — the GAIA / Orion Field-Intelligence map (P5.14), sovereign edition.
 *
 * Renders the places the system has detected in the knowledge graph as OrionMapMarkers on an OFFLINE,
 * dependency-free equirectangular world plot. No external map tiles (those would leak the user's queries +
 * locations to a tile vendor — antithetical to a local-first sovereign app), so the basemap is a schematic
 * graticule + rough continent silhouettes. Marker PLACEMENT is exact (projected from [lon,lat]); the basemap is
 * reference-only. Backend: /api/graph/places (LLM-geocodes graph entities) → /api/graph/geo (OrionMapMarker v0.1).
 * Read-only + ODbL-attributed; honors the OFIF advisory boundary (no action UI).
 */
type Marker = { id: string; layerGroup: string; severity: string; coordinates: [number, number]; title: string }
type GeoResp = { markers: Marker[]; count: number; attribution?: { texts?: string[] }; boundary?: string; note?: string }

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

const W = 720, H = 360
const projX = (lon: number) => ((lon + 180) / 360) * W
const projY = (lat: number) => ((90 - lat) / 180) * H

const SEV: Record<string, { c: string; r: number }> = {
  info: { c: '#3b82f6', r: 3.5 }, low: { c: '#22c55e', r: 4 }, medium: { c: '#eab308', r: 4.5 },
  high: { c: '#f97316', r: 5 }, critical: { c: '#ef4444', r: 6 },
}

// Rough continent outlines in [lon,lat] — recognizable reference only, NOT cartographically precise.
const CONTINENTS: Array<[number, number][]> = [
  [[-160, 68], [-95, 70], [-52, 47], [-80, 25], [-115, 30], [-130, 50], [-160, 68]],         // N. America
  [[-80, 8], [-35, 0], [-35, -23], [-72, -54], [-80, 8]],                                     // S. America
  [[-10, 58], [28, 70], [40, 48], [12, 36], [-9, 43], [-10, 58]],                             // Europe
  [[-17, 34], [52, 11], [40, -35], [12, -35], [-17, 15], [-17, 34]],                          // Africa
  [[28, 70], [180, 67], [145, 40], [120, 8], [75, 8], [45, 12], [40, 48], [28, 70]],          // Asia
  [[113, -11], [153, -20], [148, -39], [115, -35], [113, -11]],                               // Australia
]
const polyPath = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${projX(p[0]).toFixed(1)} ${projY(p[1]).toFixed(1)}`).join(' ') + ' Z'

export function GeoSurface() {
  const [data, setData] = useState<GeoResp | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Marker | null>(null)

  const loadGeo = useCallback(async (): Promise<GeoResp | null> => {
    const r = await fetch(amUrl('/api/graph/geo'))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as GeoResp
    setData(j)
    return j
  }, [])

  const detect = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      await fetch(amUrl('/api/graph/places?refresh=1'))   // LLM-geocode the graph's place entities
      await loadGeo()
    } catch (e) { setErr(e instanceof Error ? e.message : 'detection failed') }
    finally { setBusy(false) }
  }, [loadGeo])

  useEffect(() => {
    void (async () => {
      try {
        const j = await loadGeo()
        if (j && j.count === 0 && j.note) await detect()   // first run: populate then re-render
      } catch (e) { setErr(e instanceof Error ? e.message : 'failed to load — is the backend running?') }
    })()
  }, [loadGeo, detect])

  const markers = data?.markers ?? []
  const graticule = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = []
    for (let lon = -180; lon <= 180; lon += 30) lines.push({ x1: projX(lon), y1: 0, x2: projX(lon), y2: H, major: lon === 0 })
    for (let lat = -90; lat <= 90; lat += 30) lines.push({ x1: 0, y1: projY(lat), x2: W, y2: projY(lat), major: lat === 0 })
    return lines
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 flex items-center gap-3">
        <div className="text-lg font-semibold text-[var(--color-text-primary)]">Geo</div>
        <span className="rounded bg-[#eff6ff] px-1.5 py-px text-[9px] font-medium text-[#1d4ed8]">GAIA · Orion Field Intelligence</span>
        <button onClick={() => void detect()} disabled={busy} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)] disabled:opacity-50">{busy ? 'detecting…' : 'detect places'}</button>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">{markers.length} marker{markers.length === 1 ? '' : 's'}</span>
      </div>
      <p className="mb-4 max-w-2xl text-xs text-[var(--color-text-secondary)]">Places detected in your knowledge graph, plotted offline — no external map tiles, so nothing about where you look leaves the device. The basemap is schematic; marker positions are exact.</p>

      {err && <div className="mb-4 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-[11px] text-[#b91c1c]">{err}</div>}

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ background: 'var(--color-background-primary)' }}>
          {CONTINENTS.map((c, i) => <path key={i} d={polyPath(c)} fill="var(--color-background-tertiary)" stroke="var(--color-border-secondary)" strokeWidth={0.5} />)}
          {graticule.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--color-border-secondary)" strokeWidth={l.major ? 0.8 : 0.4} strokeDasharray={l.major ? '' : '2 3'} opacity={0.6} />)}
          {markers.map((m) => {
            const s = SEV[m.severity] ?? SEV.info
            const x = projX(m.coordinates[0]), y = projY(m.coordinates[1])
            return (
              <g key={m.id} onClick={() => setSel(m)} style={{ cursor: 'pointer' }}>
                <circle cx={x} cy={y} r={s.r} fill={s.c} fillOpacity={0.75} stroke="#fff" strokeWidth={0.8} />
                {sel?.id === m.id && <circle cx={x} cy={y} r={s.r + 3} fill="none" stroke={s.c} strokeWidth={1.2} />}
                <title>{m.title} · {m.severity}</title>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
        {Object.entries(SEV).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: v.c }} />{k}</span>
        ))}
      </div>

      {sel && (
        <div className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">{sel.title}</div>
            <button onClick={() => setSel(null)} className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">close</button>
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{sel.layerGroup.replace(/_/g, ' ')} · severity {sel.severity} · {sel.coordinates[1].toFixed(2)}, {sel.coordinates[0].toFixed(2)}</div>
        </div>
      )}

      {markers.length === 0 && !busy && !err && (
        <div className="mt-4 text-[11px] text-[var(--color-text-tertiary)]">No geo-referenced places in the graph yet. Mention places in your documents/chats, then “detect places”.</div>
      )}

      <p className="mt-5 text-[10px] text-[var(--color-text-tertiary)]">
        {data?.attribution?.texts?.join(' · ') ?? '© OpenStreetMap contributors'}
        {data?.boundary ? ` — ${data.boundary}` : ''}
      </p>
    </div>
  )
}
