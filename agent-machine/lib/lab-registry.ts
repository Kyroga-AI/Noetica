import { isLocalEmbedAvailable } from './embed-runtime.js'

export type FunctionalServiceSurface =
  | 'language'
  | 'embedding'
  | 'speech'
  | 'ocr'
  | 'image'
  | 'video'
  | 'translation'
  | 'routing'
  | 'guardrail'
  | 'model-governance'

export interface LabEndpoint {
  surface: FunctionalServiceSurface
  url: string
  healthy: boolean
  lastChecked: Date
  serviceId: string
  status: string
}

const WELL_KNOWN_PORTS: Partial<Record<FunctionalServiceSurface, number>> = {
  embedding:  8126,
  speech:     8127,
  translation: 8128,
  image:      8129,
  language:   8080,
}

const SERVICE_IDS: Partial<Record<FunctionalServiceSurface, string>> = {
  language:         'service://socioprophet/holmes/default@0.1.0',
  embedding:        'service://socioprophet/modality/embedding/default@0.1.0',
  speech:           'service://socioprophet/modality/speech/default@0.1.0',
  ocr:              'service://socioprophet/modality/ocr/default@0.1.0',
  image:            'service://socioprophet/modality/image/default@0.1.0',
  video:            'service://socioprophet/modality/video/default@0.1.0',
  translation:      'service://socioprophet/modality/translation/default@0.1.0',
  routing:          'service://socioprophet/model-router/default@0.1.0',
  guardrail:        'service://socioprophet/guardrail-fabric/default@0.1.0',
  'model-governance': 'service://socioprophet/model-governance-ledger/default@0.1.0',
}

const HEALTH_TIMEOUT_MS = 2_000

export class LabRegistry {
  private _snapshot: LabEndpoint[] = []
  private readonly _registryUrl: string | null

  constructor() {
    this._registryUrl = process.env['NOETICA_LAB_REGISTRY_URL'] ?? null
  }

  async discover(): Promise<LabEndpoint[]> {
    const surfaces = Object.keys(WELL_KNOWN_PORTS) as FunctionalServiceSurface[]
    const endpoints = await Promise.all(surfaces.map(s => this._probeLocal(s)))
    const live = endpoints.filter((e): e is LabEndpoint => e !== null)
    this._snapshot = live
    return live
  }

  async resolve(surface: FunctionalServiceSurface): Promise<LabEndpoint | null> {
    const cached = this._snapshot.find(e => e.surface === surface && e.healthy)
    if (cached) return cached

    const fresh = await this._probeLocal(surface)
    if (fresh) {
      const idx = this._snapshot.findIndex(e => e.surface === surface)
      if (idx >= 0) this._snapshot[idx] = fresh
      else this._snapshot.push(fresh)
    }
    return fresh
  }

  async healthCheck(endpoint: LabEndpoint): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
      const res = await fetch(`${endpoint.url}/health`, { signal: ctrl.signal })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  all(): LabEndpoint[] {
    return [...this._snapshot]
  }

  private async _probeLocal(surface: FunctionalServiceSurface): Promise<LabEndpoint | null> {
    if (surface === 'embedding') {
      // embed-runtime owns port 8126; we don't HTTP-probe it to avoid conflicts.
      if (!isLocalEmbedAvailable()) return null
      return {
        surface,
        url: 'http://localhost:8126',
        healthy: true,
        lastChecked: new Date(),
        serviceId: SERVICE_IDS[surface] ?? `service://local/${surface}@0.0.0`,
        status: 'experimental',
      }
    }

    const port = WELL_KNOWN_PORTS[surface]
    if (!port) return null

    const url = this._registryUrl
      ? `${this._registryUrl}/${surface}`
      : `http://localhost:${port}`

    const endpoint: LabEndpoint = {
      surface,
      url,
      healthy: false,
      lastChecked: new Date(),
      serviceId: SERVICE_IDS[surface] ?? `service://local/${surface}@0.0.0`,
      status: 'experimental',
    }

    endpoint.healthy = await this.healthCheck(endpoint)
    if (!endpoint.healthy) return null
    return endpoint
  }
}
