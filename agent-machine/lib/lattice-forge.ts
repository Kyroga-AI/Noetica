/**
 * lattice-forge.ts — integrate with SocioProphet/lattice-forge: express Noetica's managed runtimes (Ollama
 * models, the noetica-embed Rust sidecar, the XTTS voice sidecar) as CONFORMANT lattice-forge RuntimeAsset
 * manifests (apiVersion lattice.socioprophet.dev/v1) with channels, artifacts, SLSA/in-toto provenance, SBOM,
 * and a sigstore signature slot. This is the `prop:latticeForgeSubstrate` the GAIA ProphetArtifact references —
 * so a Noetica runtime can be governed/attested/released the same way the rest of the platform's are.
 */
export const LATTICE_API_VERSION = 'lattice.socioprophet.dev/v1'

export interface RuntimeChannel { name: string; type: string; trusted: boolean }
export interface RuntimeArtifact { name: string; role: 'model-weights' | 'oci-image' | 'sbom' | 'lockfile' | 'binary'; digest?: string }
export interface RuntimeAsset {
  apiVersion: string
  kind: 'RuntimeAsset'
  metadata: { name: string; version: string; createdAt: string; labels?: Record<string, string> }
  spec: {
    runtimeClass: string
    languages: string[]
    channels: RuntimeChannel[]
    artifacts: RuntimeArtifact[]
    provenance: { attestations: string[]; sourceRefs: string[]; builderId: string }
    sbom?: { formats: string[]; digest?: string }
    signature?: { type: string; digest?: string }
  }
}

const base = (name: string, version: string, createdAt: string, labels?: Record<string, string>) => ({
  apiVersion: LATTICE_API_VERSION, kind: 'RuntimeAsset' as const,
  metadata: { name, version, createdAt, ...(labels ? { labels } : {}) },
})

/** An Ollama model → conformant RuntimeAsset (the local-inference runtime). */
export function modelRuntimeAsset(model: string, opts: { createdAt: string; digest?: string }): RuntimeAsset {
  return {
    ...base(`ollama-${model.replace(/[^a-z0-9._-]/gi, '-')}`, model.split(':')[1] ?? 'latest', opts.createdAt, { prophetArtifact: `noetica.model.${model}`, ownerRepo: 'SocioProphet/noetica', safetyClass: 'standard' }),
    spec: {
      runtimeClass: 'model', languages: ['gguf'],
      channels: [{ name: 'ollama', type: 'ollama', trusted: true }],
      artifacts: [{ name: model, role: 'model-weights', ...(opts.digest ? { digest: opts.digest } : {}) }],
      provenance: { attestations: ['in-toto'], sourceRefs: [`ollama://${model}`], builderId: 'noetica-runtime-manager' },
      sbom: { formats: ['cyclonedx'] },
      signature: { type: 'sigstore' },
    },
  }
}

/** A Noetica sidecar (embed / voice) → conformant RuntimeAsset. */
export function sidecarRuntimeAsset(name: string, opts: { version: string; createdAt: string; languages: string[]; runtimeClass: string }): RuntimeAsset {
  return {
    ...base(name, opts.version, opts.createdAt, { prophetArtifact: `noetica.sidecar.${name}`, ownerRepo: 'SocioProphet/noetica', safetyClass: 'standard' }),
    spec: {
      runtimeClass: opts.runtimeClass, languages: opts.languages,
      channels: [{ name: 'prophet-core', type: 'prophet', trusted: true }],
      artifacts: [{ name: `${name}-binary`, role: 'binary' }],
      provenance: { attestations: ['slsa', 'in-toto'], sourceRefs: [`git://github.com/SocioProphet/noetica#main:${name}`], builderId: 'noetica-runtime-manager' },
      sbom: { formats: ['spdx', 'cyclonedx'] },
      signature: { type: 'sigstore' },
    },
  }
}

// Required fields per the lattice-forge RuntimeAsset schema.
const REQUIRED_SPEC = ['runtimeClass', 'languages', 'channels', 'artifacts', 'provenance'] as const

export function conformsToLattice(asset: RuntimeAsset): { conforms: boolean; missing: string[] } {
  const missing: string[] = []
  if (asset.apiVersion !== LATTICE_API_VERSION) missing.push('apiVersion')
  if (asset.kind !== 'RuntimeAsset') missing.push('kind')
  if (!asset.metadata?.name) missing.push('metadata.name')
  for (const k of REQUIRED_SPEC) if (asset.spec?.[k] == null) missing.push(`spec.${k}`)
  if (!asset.spec?.provenance?.builderId) missing.push('spec.provenance.builderId')
  return { conforms: missing.length === 0, missing }
}
