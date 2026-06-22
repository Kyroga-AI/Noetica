/**
 * model-signing.ts — signed-model provenance verification (Sigstore Model Signing v1.0, OpenSSF). Verify the
 * integrity + authenticity of every model we load (Ollama store, noetica-embed) before running it, so a
 * tampered or substituted model (supply-chain attack / poisoned weights) is caught at load. We only CONSUME
 * signatures — the hashing is the caller's; this compares against a trusted manifest. Constant-time compare.
 */

/** Constant-time hex-digest equality (avoid early-exit timing leaks on integrity checks). */
export function digestEquals(a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase()
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

export function verifyModelHash(actualSha256: string, expectedSha256: string): boolean {
  return digestEquals(actualSha256, expectedSha256)
}

export interface ManifestResult { ok: boolean; mismatches: string[]; missing: string[] }

/** Verify every file's hash against the trusted manifest. ok iff all present files match and none are missing. */
export function verifyManifest(files: Array<{ path: string; sha256: string }>, manifest: Record<string, string>): ManifestResult {
  const mismatches: string[] = []
  const seen = new Set<string>()
  for (const f of files) {
    seen.add(f.path)
    const expected = manifest[f.path]
    if (expected == null) mismatches.push(`${f.path}: not in manifest (unexpected file)`)
    else if (!digestEquals(f.sha256, expected)) mismatches.push(`${f.path}: hash mismatch`)
  }
  const missing = Object.keys(manifest).filter((p) => !seen.has(p))
  return { ok: mismatches.length === 0 && missing.length === 0, mismatches, missing }
}
