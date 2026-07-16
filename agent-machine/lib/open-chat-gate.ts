/**
 * open-chat-gate.ts — the MANDATORY PII gate for the opt-in open-chat commons.
 *
 * An "open" chat becomes searchable by OTHER users' agents (the community commons). That makes it a brand-new
 * egress surface, and the threat here is NOT the injection threat the retrieval pipeline already handles: injection
 * defense (sanitizeRetrieved / stripPotentialInjection / markExternalContent) protects the READER's agent from
 * malicious content. This gate protects the opposite party — the DATA SUBJECT whose personal data sits in the chat —
 * from being surfaced to every searcher. A chat CANNOT enter the commons index unless it clears this gate.
 *
 * Layered by design (respects "local-first Noetica never hard-depends on the cloud plane"):
 *   FLOOR (this module, mandatory, local, deterministic): redact.ts strips structured PII/secrets
 *     (emails, phones, SSNs, cards, API keys, JWTs, IPs) → stable placeholders; egress-hygiene.ts neutralises the
 *     remote-image exfil channel so a stored open chat can't carry a payload that fires in a reader's renderer.
 *   UPGRADE (regis-entity-graph NER→EL→ER→policy-veto, opt-in/entitled, elsewhere): catches NAMED-ENTITY PII
 *     (person names, "my manager Sarah at Acme") that regexes never will. Wired as an enhancement over this floor,
 *     never a hard dependency. This module is the floor that always runs.
 *
 * KEY invariant: this gate DISCARDS the placeholder→value mapping. Cloud-egress redaction keeps the map to
 * un-redact the vendor's reply; the commons must NEVER be able to reverse a redaction, so the map is dropped on
 * the floor. What the index stores is the masked text and nothing else.
 */
import { redactMany, loadPolicy } from './redact.js'
import { scrubMarkdownImages, detectRemoteRenderExfil } from './egress-hygiene.js'

export interface OpenChatMessage { role: string; content: string }

export interface GateFindings {
  /** PII/secret categories masked, e.g. { EMAIL: 2, PHONE: 1 }. */
  pii: Record<string, number>
  /** Total distinct PII/secret values masked. */
  piiCount: number
  /** Remote-render exfil URLs found and neutralised in the content. */
  exfilUrls: string[]
}

export interface GateResult {
  /** True only if the gate RAN to completion. The index MUST refuse to publish when this is false — fail closed. */
  ok: boolean
  /** The fully-redacted, exfil-scrubbed text that is safe to index. Empty when ok is false. */
  redacted: string
  /** What the gate masked/neutralised — surfaced to the user at toggle time for informed consent. */
  findings: GateFindings
  /** Present only when ok is false: why the gate could not run (→ do not index). */
  error?: string
}

/**
 * Run the mandatory floor over a chat's messages. Returns the redacted text safe for the commons index, plus a
 * findings summary for the consent UX. Fails CLOSED: any error → { ok:false }, and callers must not index on false.
 * The placeholder→value mapping produced by redactMany is intentionally NOT returned — the commons never un-redacts.
 */
export function gateOpenChat(messages: OpenChatMessage[]): GateResult {
  try {
    const texts = (messages ?? []).map((m) => `${m.role}: ${m.content ?? ''}`)
    // One placeholder namespace across the whole chat + the user's own sensitive-terms/disabled-categories policy.
    const { redacted, kinds, count } = redactMany(texts, loadPolicy())
    const joined = redacted.join('\n')
    // Neutralise the remote-image exfil channel in the masked text; record any data-bearing remote URLs we found
    // (before scrubbing) so the user sees them. Allowlist is empty: an open chat has no trusted outbound sink.
    const exfil = detectRemoteRenderExfil(joined, [])
    const scrubbed = scrubMarkdownImages(joined, [])
    return {
      ok: true,
      redacted: scrubbed,
      findings: { pii: kinds, piiCount: count, exfilUrls: exfil.urls },
    }
  } catch (e) {
    // Fail closed — a gate that can't run must block publication, never wave the chat through un-redacted.
    return { ok: false, redacted: '', findings: { pii: {}, piiCount: 0, exfilUrls: [] }, error: e instanceof Error ? e.message : 'gate failed' }
  }
}
