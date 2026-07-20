'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * GeoSurface — GAIA / Orion Field-Intelligence map (P5.14).
 *
 * Renders OrionMapMarker places from the knowledge graph on an interactive OSM×maplibre map.
 * Backend: /api/graph/places (LLM-geocode) → /api/graph/geo (OrionMapMarker v0.1).
 * Tile requests go to tile.openstreetmap.org; marker data itself stays on-device.
 */

type Marker = { id: string; layerGroup: string; severity: string; coordinates: [number, number]; title: string }
type GeoResp = { markers: Marker[]; count: number; attribution?: { texts?: string[] }; boundary?: string; note?: string }

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

const SEV: Record<string, { c: string; r: number }> = {
  info:     { c: '#3b82f6', r: 5 },
  low:      { c: 'var(--color-accent)', r: 6 },
  medium:   { c: '#eab308', r: 7 },
  high:     { c: '#f97316', r: 8 },
  critical: { c: '#ef4444', r: 10 },
}
const sevR = (s: string): number => (SEV[s] ?? SEV.info).r

const LAYER: Record<string, { c: string; label: string }> = {
  natural_hazard: { c: '#ef4444', label: 'Natural hazard' },
  facility_asset: { c: '#3b82f6', label: 'Facility / asset' },
  cyber_exposure: { c: '#a855f7', label: 'Cyber exposure' },
  field_report:   { c: '#14b8a6', label: 'Field report' },
  fused_incident: { c: '#f97316', label: 'Fused incident' },
  gated_disabled: { c: '#64748b', label: 'Gated (disabled)' },
  unknown:        { c: '#94a3b8', label: 'Unknown' },
}
const layerOf = (g: string) => LAYER[g] ?? LAYER.unknown

type MLMap = import('maplibre-gl').Map

export function GeoSurface() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<MLMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [data, setData]         = useState<GeoResp | null>(null)
  const [err, setErr]           = useState('')
  const [busy, setBusy]         = useState(false)
  const [sel, setSel]           = useState<Marker | null>(null)
  const [hidden, setHidden]     = useState<Set<string>>(new Set())
  const [showCells, setShowCells] = useState(false)
  const [cellData, setCellData]   = useState<{ cell: string; count: number; center: [number, number] }[]>([])

  const toggleLayer = (g: string) =>
    setHidden((h) => { const n = new Set(h); n.has(g) ? n.delete(g) : n.add(g); return n })

  // Initialise maplibre map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    void (async () => {
      const ml = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      const map = new ml.Map({
        container: containerRef.current,
        style: {
          version: 8,
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: [0, 20],
        zoom: 1.5,
        attributionControl: { compact: false },
      })

      map.on('load', () => {
        if (cancelled) { map.remove(); return }

        map.addSource('ofif', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        // H3 cell density heatmap source
        map.addSource('h3-cells', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        // Base circle — color and size from OFIF layer + severity
        map.addLayer({
          id: 'ofif-circles',
          type: 'circle',
          source: 'ofif',
          paint: {
            'circle-color':         ['get', 'color'],
            'circle-radius':        ['get', 'radius'],
            'circle-opacity':       0.82,
            'circle-stroke-width':  1.5,
            'circle-stroke-color':  '#ffffff',
          },
        })

        // Selected ring
        map.addLayer({
          id: 'ofif-selected',
          type: 'circle',
          source: 'ofif',
          filter: ['==', ['get', 'id'], ''],
          paint: {
            'circle-color':        'transparent',
            'circle-radius':       ['get', 'radius'],
            'circle-stroke-width': 3,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-opacity': 0.9,
          },
        })

        // Cell density — rendered before OFIF circles so markers sit on top
        map.addLayer({
          id: 'h3-heat',
          type: 'circle',
          source: 'h3-cells',
          paint: {
            'circle-color':   '#7c3aed',
            'circle-radius':  ['interpolate', ['linear'], ['get', 'count'], 1, 10, 5, 22, 20, 40],
            'circle-opacity': 0.28,
            'circle-stroke-width': 0,
            'circle-blur':    0.6,
          },
        })

        map.on('click', 'ofif-circles', (e) => {
          if (!e.features?.length) return
          const props = e.features[0].properties as { id: string; title: string; layerGroup: string; severity: string }
          const geom  = e.features[0].geometry as unknown as { coordinates: [number, number] }
          setSel({ id: props.id, title: props.title, layerGroup: props.layerGroup, severity: props.severity, coordinates: geom.coordinates })
          map.setFilter('ofif-selected', ['==', ['get', 'id'], props.id])
        })
        map.on('click', (e) => {
          // Click outside any marker → deselect
          const hit = map.queryRenderedFeatures(e.point, { layers: ['ofif-circles'] })
          if (!hit.length) { setSel(null); map.setFilter('ofif-selected', ['==', ['get', 'id'], '']) }
        })
        map.on('mouseenter', 'ofif-circles', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'ofif-circles', () => { map.getCanvas().style.cursor = '' })

        mapRef.current = map
        setMapReady(true)
      })
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Push updated GeoJSON whenever data or hidden-layers change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const markers = data?.markers ?? []
    const features = markers
      .filter((m) => !hidden.has(m.layerGroup))
      .map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: m.coordinates },
        properties: {
          id:         m.id,
          title:      m.title,
          layerGroup: m.layerGroup,
          severity:   m.severity,
          color:      layerOf(m.layerGroup).c,
          radius:     sevR(m.severity),
        },
      }))
    const src = mapRef.current.getSource('ofif') as { setData: (d: unknown) => void } | undefined
    src?.setData({ type: 'FeatureCollection', features })
  }, [mapReady, data, hidden])

  // Fetch H3 cell density whenever the layer is toggled on or markers change
  useEffect(() => {
    if (!showCells || !mapReady) return
    const m = data?.markers ?? []
    if (!m.length) { setCellData([]); return }
    const points = m.map((mk) => ({ lon: mk.coordinates[0], lat: mk.coordinates[1] }))
    void fetch(amUrl('/api/geo/cells'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'aggregate', points, res: 0.01 }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { cells?: { cell: string; count: number; center: [number, number] }[] } | null) => { if (d?.cells) setCellData(d.cells) })
      .catch(() => { /* silent */ })
  }, [showCells, mapReady, data])

  // Push H3 cell GeoJSON to the map layer
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const src = mapRef.current.getSource('h3-cells') as { setData: (d: unknown) => void } | undefined
    if (!src) return
    if (!showCells) { src.setData({ type: 'FeatureCollection', features: [] }); return }
    const features = cellData.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: c.center },
      properties: { count: c.count, cell: c.cell },
    }))
    src.setData({ type: 'FeatureCollection', features })
  }, [mapReady, showCells, cellData])

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
      await fetch(amUrl('/api/graph/places?refresh=1'))
      await loadGeo()
    } catch (e) { setErr(e instanceof Error ? e.message : 'detection failed') }
    finally { setBusy(false) }
  }, [loadGeo])

  useEffect(() => {
    void (async () => {
      try {
        const j = await loadGeo()
        if (j && j.count === 0 && j.note) await detect()
      } catch (e) { setErr(e instanceof Error ? e.message : 'failed to load — is the backend running?') }
    })()
  }, [loadGeo, detect])

  const markers = data?.markers ?? []
  const layerGroups = [...new Set(markers.map((m) => m.layerGroup))].sort()

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border-tertiary)] px-5 py-3">
        <div className="text-base font-semibold text-[var(--color-text-primary)]">Geo</div>
        <span className="rounded bg-[#eff6ff] px-1.5 py-px text-[11px] font-medium text-[#1d4ed8]">GAIA · Orion Field Intelligence</span>
        <button onClick={() => void detect()} disabled={busy}
          className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)] disabled:opacity-50">
          {busy ? 'Detecting…' : 'Detect places'}
        </button>
        <button onClick={() => setShowCells((v) => !v)} disabled={markers.length === 0}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${showCells ? 'border-[#7c3aed] bg-[#ede9fe] text-[#7c3aed]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>
          <span className="h-2 w-2 rounded-full" style={{ background: showCells ? '#7c3aed' : 'var(--color-text-tertiary)' }} />
          Cell density
        </button>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{markers.length} marker{markers.length === 1 ? '' : 's'}</span>
        {err && <span className="text-[11px] text-[#dc2626]">{err}</span>}
      </div>

      {/* OFIF layer toggles */}
      {layerGroups.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--color-border-tertiary)] px-5 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Layers</span>
          {layerGroups.map((g) => {
            const off = hidden.has(g)
            const n   = markers.filter((m) => m.layerGroup === g).length
            return (
              <button key={g} onClick={() => toggleLayer(g)} title={off ? 'Show' : 'Hide'}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition"
                style={{ borderColor: 'var(--color-border-secondary)', opacity: off ? 0.35 : 1 }}>
                <span className="h-2 w-2 rounded-full" style={{ background: layerOf(g).c }} />
                <span className="text-[var(--color-text-secondary)]">{layerOf(g).label}</span>
                <span className="text-[var(--color-text-tertiary)]">{n}</span>
              </button>
            )
          })}
          {/* severity legend */}
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Severity</span>
          {Object.entries(SEV).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
              <span className="rounded-full" style={{ display: 'inline-block', width: v.r, height: v.r, background: 'var(--color-text-tertiary)' }} />
              {k}
            </span>
          ))}
        </div>
      )}

      {/* Map container */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full w-full" />

        {/* No-data overlay */}
        {markers.length === 0 && !busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]/90 px-5 py-4 text-center backdrop-blur-sm">
              <div className="text-xs font-medium text-[var(--color-text-primary)]">No markers yet</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Mention places in documents or chat,<br />then &ldquo;Detect places&rdquo; above.</div>
            </div>
          </div>
        )}

        {/* Selected marker panel */}
        {sel && (
          <div className="absolute bottom-8 left-4 right-4 max-w-sm rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]/95 px-4 py-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{sel.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: layerOf(sel.layerGroup).c }} />
                  {layerOf(sel.layerGroup).label}
                  <span className="text-[var(--color-text-tertiary)]">·</span>
                  <span>{sel.severity}</span>
                  <span className="text-[var(--color-text-tertiary)]">·</span>
                  <span className="tabular-nums">{sel.coordinates[1].toFixed(2)}, {sel.coordinates[0].toFixed(2)}</span>
                </div>
              </div>
              <button onClick={() => { setSel(null); mapRef.current?.setFilter('ofif-selected', ['==', ['get', 'id'], '']) }}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-xs">✕</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
