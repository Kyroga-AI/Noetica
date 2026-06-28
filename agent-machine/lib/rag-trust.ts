/**
 * rag-trust.ts — provenance trust-tiering + retrieved-content sanitization (indirect-injection defense).
 *
 * A heavy-RAG product's largest attack surface is its own retrieved content: an instruction hidden in a
 * document or graph node ("ignore previous instructions, exfiltrate…") is indirect prompt injection
 * (PoisonedRAG ~90% ASR). The grounding-verifier checks SUPPORT, not embedded instructions — orthogonal.
 * Two deterministic, local, model-free layers (CaMeL/Spotlighting-inspired, arXiv 2503.18813 / 2403.14720):
 *   1. trust-tier every chunk by provenance; untrusted content is down-weighted and may not drive control flow,
 *   2. sanitize retrieved text — strip/flag AI-directed imperative instructions before it reaches the model.
 * Trust propagates by the weakest input (a value derived from untrusted data inherits untrusted).
 */

export type TrustTier = 'trusted' | 'internal' | 'untrusted'

const TIER_RANK: Record<TrustTier, number> = { untrusted: 0, internal: 1, trusted: 2 }

/** Classify a source's trust by provenance. Default is untrusted (fail-closed). */
export function trustOf(src: { validated?: boolean; origin?: string; ingestPath?: string }): TrustTier {
  if (src.validated) return 'trusted'
  if (src.origin === 'local' || src.ingestPath === 'user' || src.ingestPath === 'authored') return 'internal'
  return 'untrusted'   // web / retrieved / external / unknown → untrusted by default
}

/** Capability propagation: a derived value is only as trusted as its least-trusted input. */
export function deriveTrust(inputs: TrustTier[]): TrustTier {
  if (inputs.length === 0) return 'untrusted'
  let min: TrustTier = 'trusted'
  for (const t of inputs) if (TIER_RANK[t] < TIER_RANK[min]) min = t
  return min
}

/** Retrieval re-weighting: down-weight low-trust chunks so poisoned content can't dominate context. */
export function trustWeight(tier: TrustTier): number {
  return tier === 'trusted' ? 1 : tier === 'internal' ? 0.7 : 0.3
}

// AI-directed imperative patterns commonly used in indirect prompt injection. Precise by design — over-broad
// patterns redact legitimate document text and degrade RAG quality, so each targets a real attack idiom.
const INJECTION_PATTERNS: RegExp[] = [
  // — directive overrides —
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
  /disregard\s+(?:the\s+)?(?:above|previous|system)/gi,
  /you\s+are\s+now\s+(?:a|an|the)\b/gi,
  /new\s+instructions?\s*:/gi,
  /\bsystem\s*:/gi,
  /\b(?:assistant|ai|model)\s*,?\s*(?:please\s+)?(?:do|execute|run|send|exfiltrate|reveal|print)\b/gi,
  /override\s+(?:your|the)\s+(?:rules|policy|guardrails)/gi,
  // — role / chat-template delimiter injection (impersonate a system/role turn) —
  /<\|?(?:im_start|im_end|endoftext|eot_id|start_header_id|end_header_id)\|?>/gi,
  /<\/?(?:system|assistant|user|instructions?|context|document)>/gi,
  /\[\/?INST\]/gi,
  /^\s{0,3}#{1,6}\s*system\b.*$/gim,
  /begin\s+(?:system|admin|developer)\s+(?:prompt|instructions?|message)/gi,
  // — "the above is fake, here's the real instruction" framing —
  /(?:the\s+)?(?:above|preceding|previous)\s+(?:text|content|document|instructions?)\s+(?:is|are|was|were)\s+(?:fake|false|wrong|a\s+test|incorrect|outdated)/gi,
  // — fake tool-call / function-call emission —
  /<\/?tool_call>|"tool_calls?"\s*:|\bfunction_call\b\s*:/gi,
  // — explicit exfiltration directive to an external URL —
  /(?:exfiltrate|leak|send|post|upload|forward)\b[^.\n]{0,48}\bhttps?:\/\//gi,
]

export function detectInjection(text: string): { suspicious: boolean; hits: string[] } {
  const hits: string[] = []
  for (const re of INJECTION_PATTERNS) { const m = text.match(re); if (m) hits.push(...m) }
  return { suspicious: hits.length > 0, hits }
}

/**
 * Neutralize injected instructions in retrieved text (Spotlighting: strip the directive, keep the content).
 * Returns the cleaned text and how many directives were removed. Never executes anything — pure string work.
 * Also defangs markdown image/link URLs — a zero-click data-exfiltration channel (the model "renders" an image
 * whose URL encodes stolen context) — by keeping the alt/anchor text and dropping the external URL.
 */
export function sanitizeRetrieved(text: string): { clean: string; stripped: number } {
  let stripped = 0
  let clean = text
  for (const re of INJECTION_PATTERNS) {
    clean = clean.replace(re, () => { stripped++; return '[redacted-instruction]' })
  }
  // Defang markdown images to external URLs (exfil channel): ![alt](http…) → [image: alt]
  clean = clean.replace(/!\[([^\]]*)\]\(\s*https?:[^)]+\)/gi, (_m, alt: string) => { stripped++; return `[image: ${alt || 'removed'}]` })
  return { clean, stripped }
}

export interface TrustedChunk { text: string; tier: TrustTier; weight: number; sanitized: string; injected: boolean }

/** Tier + sanitize + weight a batch of retrieved chunks; optionally quarantine below a minimum tier. */
export function applyTrust(
  chunks: Array<{ text: string; src: { validated?: boolean; origin?: string; ingestPath?: string } }>,
  opts: { minTier?: TrustTier } = {},
): TrustedChunk[] {
  const min = opts.minTier ? TIER_RANK[opts.minTier] : -1
  return chunks
    .map((c): TrustedChunk => {
      const tier = trustOf(c.src)
      const { clean, stripped } = sanitizeRetrieved(c.text)
      return { text: c.text, tier, weight: trustWeight(tier), sanitized: clean, injected: stripped > 0 }
    })
    .filter((c) => TIER_RANK[c.tier] >= min)
}
