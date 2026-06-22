/**
 * orion-markers.ts — project detected places into the OrionMapMarker v0.1 contract from
 * SocioProphet/orion-field-intelligence (schemas/orion-map-marker.v0_1.schema.json).
 *
 * Pure + tested so the OSM × GAIA map and the /api/graph/geo endpoint share one faithful implementation.
 * Honors the OFIF boundary: markers are READ-ONLY field views (action_enabled:false) — scanner/sweep/recon
 * stay in SCOPE-D. Coordinates are [lon, lat] (GeoJSON order), as the schema's prefixItems require.
 */

export type OrionLayerGroup = 'natural_hazard' | 'facility_asset' | 'cyber_exposure' | 'field_report' | 'fused_incident' | 'gated_disabled' | 'unknown'
export type OrionSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'
export type OrionEvidenceGrade = 'fixture.synthetic' | 'public_source.unverified' | 'public_source.versioned' | 'public_source.attributed' | 'operator_report.unverified' | 'fused.inferred' | 'policy_gated.action'
export type OrionPolicyState = 'public_view_allowed' | 'internal_view_allowed' | 'unverified_source' | 'attribution_required' | 'action_gated' | 'scope_required' | 'authorization_required' | 'expired'

export interface OrionMapMarker {
  schema_version: '0.1.0'
  marker_id: string
  event_ref: string
  layer_group: OrionLayerGroup
  coordinates: [number, number]   // [lon, lat]
  title: string
  severity: OrionSeverity
  confidence: number
  evidence_grade: OrionEvidenceGrade
  policy_state: OrionPolicyState
  source_count: number
  selectable: boolean
  action_enabled: boolean
  action_disabled_reason?: string
}

export interface DetectedPlace { name: string; lat: number | null; lon: number | null; type: string }

/** Slugify into the marker_id pattern: ^[a-z0-9][a-z0-9._-]*$ */
export function markerSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'
}

export function placeLayerGroup(type: string): OrionLayerGroup {
  switch (type) {
    case 'facility': return 'facility_asset'
    case 'city': case 'region': case 'country': case 'landmark': return 'field_report'
    default: return 'unknown'
  }
}

/**
 * Project geocoded places (those with numeric coords) into OrionMapMarkers. Severity can be lifted per
 * place name via opts.severityOf (e.g. from GAIA abandonment signals); defaults to 'info'.
 */
export function placesToMarkers(places: DetectedPlace[], opts: { severityOf?: (name: string) => OrionSeverity } = {}): OrionMapMarker[] {
  return places
    .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number' && Math.abs(p.lon!) <= 180 && Math.abs(p.lat!) <= 90)
    .map((p, i): OrionMapMarker => {
      const id = `${markerSlug(p.name)}-${i}`
      return {
        schema_version: '0.1.0',
        marker_id: `orion-marker-${id}`,
        event_ref: `orion-evt-${id}`,
        layer_group: placeLayerGroup(p.type),
        coordinates: [p.lon!, p.lat!],
        title: p.name,
        severity: opts.severityOf?.(p.name) ?? 'info',
        confidence: 0.5,
        evidence_grade: 'fused.inferred',          // LLM-classified from graph concepts
        policy_state: 'attribution_required',        // OSM basemap → ODbL
        source_count: 1,
        selectable: true,
        action_enabled: false,                       // OFIF boundary: no scanner/sweep/recon/dispatch
        action_disabled_reason: 'read-only field view; active actions are SCOPE-D scope-gated',
      }
    })
}

export const OSM_ATTRIBUTION = { required: true, texts: ['© OpenStreetMap contributors'], license_refs: ['ODbL-1.0'] } as const
export const ORION_FIELD_BOUNDARY = 'Advisory field view — not for navigation, routing, dispatch, or safety-critical use.'
