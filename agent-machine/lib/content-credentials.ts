/**
 * content-credentials.ts — C2PA-style provenance + AI-output marking. EU AI Act Article 50 requires machine-
 * readable marking of generative output (incl. text) by Aug 2026 — a local product must mark even offline.
 * Builds a Content-Credential manifest, a deterministic digest, and a machine-readable marker appended to
 * generated text. (Crypto signing/SynthID image watermarks are the upgrade; this is the always-available base.)
 */
export interface ContentCredential {
  generator: string
  model: string
  aiGenerated: true
  timestamp: string
  sourceRefs: string[]
}

export function makeCredential(opts: { generator?: string; model: string; timestamp: string; sourceRefs?: string[] }): ContentCredential {
  return { generator: opts.generator ?? 'noetica', model: opts.model, aiGenerated: true, timestamp: opts.timestamp, sourceRefs: opts.sourceRefs ?? [] }
}

/** Deterministic manifest digest (djb2 over canonical JSON) — stand-in for a C2PA hard binding. */
export function manifestDigest(cred: ContentCredential): string {
  const canonical = JSON.stringify({ generator: cred.generator, model: cred.model, aiGenerated: cred.aiGenerated, timestamp: cred.timestamp, sourceRefs: [...cred.sourceRefs].sort() })
  let h = 5381
  for (let i = 0; i < canonical.length; i++) h = ((h * 33) ^ canonical.charCodeAt(i)) >>> 0
  return 'cc_' + h.toString(16).padStart(8, '0')
}

/** Append a machine-readable AI-generated marker (Art.50). Idempotent. */
export function markAIGenerated(text: string, cred: ContentCredential): string {
  const marker = `\n<!-- c2pa:ai-generated model="${cred.model}" digest="${manifestDigest(cred)}" -->`
  return text.includes('c2pa:ai-generated') ? text : text + marker
}
