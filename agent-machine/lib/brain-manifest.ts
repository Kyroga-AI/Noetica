/**
 * brain-manifest — the client of the brain injection + update SERVICE.
 *
 * Brains are hosted in a bucket (GCS/S3/CDN) behind a small JSON manifest that lists, per brain, the
 * current version + download URL + sha256 + size. Treating it as a service (not static release assets)
 * gives: versioning, integrity, update detection, and artifacts larger than a release allows (the
 * academic brain is 2.2 GB — over GitHub's 2 GB per-asset cap). The producer publishes the manifest with
 * scripts/publish-brains.sh; the client reads it from NOETICA_BRAIN_MANIFEST_URL.
 */

export interface BrainManifestEntry {
  version: string   // e.g. "2026.06.22" or a content hash — what "installed" is compared against
  url: string       // https download URL of the .tar.gz
  sha256: string    // integrity check after download
  bytes?: number    // size, for progress / UX
  fields?: string[] // academic: the subject fields included
}

export interface BrainManifest {
  schema: number
  updated_at: string
  brains: Record<string, BrainManifestEntry>
}

let _cache: { at: number; manifest: BrainManifest | null } | null = null
const TTL_MS = 60_000 // brief cache so a status poll + a provision don't double-fetch

// The canonical public manifest (a GCS bucket). Override per-machine/build with NOETICA_BRAIN_MANIFEST_URL.
// The big tarballs it points to live in the same bucket; the manifest itself is tiny.
const DEFAULT_MANIFEST_URL = 'https://storage.googleapis.com/noetica-brains/brains/manifest.json'

export function brainManifestUrl(): string {
  return process.env['NOETICA_BRAIN_MANIFEST_URL']?.trim() || DEFAULT_MANIFEST_URL
}

/** Fetch + cache the manifest. Returns null when the fetch fails (the provisioner then falls back to the
 *  static release URL) — so an unpublished bucket is harmless. */
export async function fetchBrainManifest(): Promise<BrainManifest | null> {
  const url = brainManifestUrl()
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.manifest
  let manifest: BrainManifest | null = null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
    if (res.ok) {
      const j = (await res.json()) as BrainManifest
      if (j && typeof j === 'object' && j.brains) manifest = j
    }
  } catch { /* unreachable/invalid → null → static fallback */ }
  _cache = { at: Date.now(), manifest }
  return manifest
}

export function entryFor(manifest: BrainManifest | null, name: string): BrainManifestEntry | null {
  const e = manifest?.brains?.[name]
  return e && e.url ? e : null
}

/** Test seam. */
export function _resetManifestCache(): void { _cache = null }
