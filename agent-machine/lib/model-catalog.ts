/**
 * model-catalog.ts — the AI·Models "Labs" catalog, Apple-aligned + conformant to sourceos-spec.
 *
 * Apple Intelligence lessons: a small (~3B) ON-DEVICE foundation model + a LARGER SERVER model (PCC),
 * routed by difficulty/privacy; and ONE base + swappable task-specific LoRA ADAPTERS (not N full models).
 * We map that straight onto our estate: one ~3B on-device base + a per-modality adapter for each SociOS lab
 * (embedding/timeseries/translation/video/ocr/image/nlp/graph) + a larger server tier — routed by the
 * isolation policy (sensitivity → residency), and recorded as a ModelCarryRouteReceipt.
 *
 * Fields conform to sourceos-spec: ModelResidency (residencyState/quantization/cacheTier) and
 * SourceOSModelCarryRef (carryPolicy). Tier maps to ModelResidency + our isolation local/edge/cloud.
 */
import type { Sensitivity } from './isolation-policy.js'

export type ModelTier = 'on-device' | 'edge' | 'server' // Apple: on-device + PCC server (we add edge)
export type ResidencyState =
  | 'unavailable' | 'downloadable' | 'cached' | 'loading' | 'loaded-cold' | 'loaded-warm' | 'pinned' | 'evictable' | 'failed'
export type CacheTier = 'ram' | 'nvme' | 'object-store' | 'network-cache' | 'none'
export type CarryPolicy = 'reference-only' | 'download-on-demand' | 'preload-reference' | 'disabled'

export interface ModelEntry {
  id: string
  kind: 'base' | 'adapter' // one base + swappable LoRA adapters (Apple pattern)
  modality?: string
  lab?: string             // the SociOS-Linux lab repo that authors this adapter
  tier: ModelTier
  paramsB: number          // billions of params — ~3 on-device (Apple), larger server
  quantization?: string    // Apple on-device ≈ 3.7 bpw mixed 2/4-bit
  residencyState: ResidencyState
  cacheTier: CacheTier
  carryPolicy: CarryPolicy
  provider: string
}

/** The eight SociOS opt-in tuning labs → one LoRA adapter each (per-modality, on-device). */
export const SOCIOS_LABS: Array<{ lab: string; modality: string }> = [
  { lab: 'embeddinglab', modality: 'embedding' },
  { lab: 'timeserieslab', modality: 'timeseries' },
  { lab: 'translationlab', modality: 'translation' },
  { lab: 'videolab', modality: 'video' },
  { lab: 'ocrlab', modality: 'ocr' },
  { lab: 'imagelab', modality: 'image' },
  { lab: 'nlplab', modality: 'nlp' },
  { lab: 'graphlab', modality: 'graph' },
]

export interface Catalog { models: ModelEntry[]; note: string }

export function modelCatalog(): Catalog {
  const base: ModelEntry = {
    id: 'base.on-device', kind: 'base', tier: 'on-device', paramsB: 3, quantization: '4-bit (mixed 2/4)',
    residencyState: 'loaded-warm', cacheTier: 'ram', carryPolicy: 'preload-reference', provider: 'ollama',
  }
  const adapters: ModelEntry[] = SOCIOS_LABS.map(({ lab, modality }) => ({
    id: `adapter.${modality}`, kind: 'adapter', modality, lab, tier: 'on-device', paramsB: 0.05,
    quantization: '4-bit', residencyState: 'cached', cacheTier: 'nvme', carryPolicy: 'download-on-demand', provider: 'ollama',
  }))
  const server: ModelEntry = {
    id: 'server.pcc', kind: 'base', tier: 'server', paramsB: 70, residencyState: 'downloadable',
    cacheTier: 'network-cache', carryPolicy: 'reference-only', provider: 'claude',
  }
  return {
    models: [base, ...adapters, server],
    note: 'Apple-aligned: ~3B on-device base + swappable LoRA adapters (one per SociOS lab) + a larger server (PCC) tier; routed by isolation/residency.',
  }
}

/** Route to a model tier by sensitivity (conforms to isolation-policy + ModelCarryRouteReceipt): high stays
 *  on-device, low may reach the server — the Apple privacy tier. */
export function routeToTier(sensitivity: Sensitivity): ModelTier {
  return sensitivity === 'high' ? 'on-device' : sensitivity === 'medium' ? 'edge' : 'server'
}
