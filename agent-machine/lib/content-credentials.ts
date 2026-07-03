/**
 * content-credentials.ts — C2PA-style provenance + AI-output marking. EU AI Act Article 50 requires machine-
 * readable marking of generative output (incl. text) by Aug 2026 — a local product must mark even offline.
 * Builds a Content-Credential manifest, a deterministic digest, and a machine-readable marker appended to
 * generated text. (Crypto signing/SynthID image watermarks are the upgrade; this is the always-available base.)
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

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

/** SHA-256 hash of the response text — stored in the compliance log instead of the raw content. */
export function responseHash(text: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface ComplianceLogEntry {
  event: 'ai_generated_response'
  complianceStandard: 'EU-AI-Act-Art50'
  model: string
  generator: string
  responseHash: string
  digest: string
  timestamp: string
  markedAt: string
}

/**
 * Record an EU AI Act Art.50 compliance event. Writes a JSONL line to logsDir/ai-act.log
 * when logsDir is non-null. Pass logsDir:null in tests to skip the write.
 * Raw response text is never stored — only its SHA-256 hash.
 */
export function logAIActEvent(opts: { responseText: string; cred: ContentCredential; logsDir: string | null }): ComplianceLogEntry {
  const sanitize = (s: string) => s.replace(/\r/g, '').replace(/\n/g, '')
  const entry: ComplianceLogEntry = {
    event: 'ai_generated_response',
    complianceStandard: 'EU-AI-Act-Art50',
    model: sanitize(opts.cred.model),
    generator: sanitize(opts.cred.generator),
    responseHash: responseHash(opts.responseText),
    digest: manifestDigest(opts.cred),
    timestamp: sanitize(opts.cred.timestamp),
    markedAt: new Date().toISOString(),
  }
  if (opts.logsDir) {
    try {
      fs.appendFileSync(path.join(opts.logsDir, 'ai-act.log'), JSON.stringify(entry) + '\n', 'utf8')
    } catch { /* log failure must never throw */ }
  }
  return entry
}

export interface C2PAEventPayload {
  standard: 'EU-AI-Act-Art50'
  generator: string
  model: string
  aiGenerated: true
  digest: string
  timestamp: string
}

/** Build the SSE event payload for the c2pa_credential event type. */
export function buildC2PAEventPayload(cred: ContentCredential): C2PAEventPayload {
  return {
    standard: 'EU-AI-Act-Art50',
    generator: cred.generator,
    model: cred.model,
    aiGenerated: true,
    digest: manifestDigest(cred),
    timestamp: cred.timestamp,
  }
}
