/**
 * redact.ts — PII / secret firewall for cloud egress.
 *
 * Noetica is sovereign by default: local + self-hosted models never leak data. The ONE place data can
 * leave the device is the mesh's last rung — escalation to a vendor frontier model. A recurring,
 * unmet community ask ("block PII and secrets before ChatGPT sees them") lives exactly here. This
 * deterministically detects emails, phones, SSNs, cards, API keys/tokens, JWTs, IPs and masks them with
 * stable placeholders ([EMAIL_1]…) BEFORE the prompt egresses; the placeholder→value map stays local, so
 * the vendor's response is un-redacted on the way back. The model reasons over structure, never the secret.
 */

export interface RedactionResult { redacted: string; mapping: Record<string, string>; count: number; kinds: Record<string, number> }

// Order matters: most-specific first (a token shouldn't be partially eaten by a broader pattern).
const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'PRIVKEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'APIKEY', re: /\b(?:sk-[A-Za-z0-9_-]{16,}|rk_(?:live|test)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'CARD', re: /\b(?:\d[ -]?){15,16}\b/g },
  { kind: 'PHONE', re: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { kind: 'IP', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

/** Mask PII/secrets with stable placeholders; identical values reuse the same placeholder. */
export function redact(text: string): RedactionResult {
  if (!text) return { redacted: text, mapping: {}, count: 0, kinds: {} }
  const mapping: Record<string, string> = {}
  const valueToPh = new Map<string, string>()
  const kinds: Record<string, number> = {}
  let out = text
  for (const { kind, re } of PATTERNS) {
    out = out.replace(re, (m) => {
      const seen = valueToPh.get(m)
      if (seen) return seen
      kinds[kind] = (kinds[kind] ?? 0) + 1
      const ph = `[${kind}_${kinds[kind]}]`
      mapping[ph] = m; valueToPh.set(m, ph)
      return ph
    })
  }
  return { redacted: out, mapping, count: Object.keys(mapping).length, kinds }
}

/** Granular control: which categories to skip, plus user-defined sensitive terms to always mask. */
export interface RedactPolicy { disabled?: string[]; terms?: string[] }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Redact several texts under ONE placeholder namespace — identical values share a placeholder across
 *  messages and no two distinct values collide on a placeholder (which per-message redaction would risk).
 *  An optional policy disables categories and/or adds user-defined sensitive terms. */
export function redactMany(texts: string[], policy?: RedactPolicy): { redacted: string[]; mapping: Record<string, string>; count: number; kinds: Record<string, number> } {
  const mapping: Record<string, string> = {}
  const valueToPh = new Map<string, string>()
  const kinds: Record<string, number> = {}
  // User terms first (most specific), then the built-in patterns minus any the policy disabled.
  const termPats = (policy?.terms ?? []).filter((t) => t && t.length >= 2).map((t) => ({ kind: 'CUSTOM', re: new RegExp(escapeRe(t), 'gi') }))
  const pats = [...termPats, ...PATTERNS.filter((p) => !policy?.disabled?.includes(p.kind))]
  const redacted = texts.map((text) => {
    let out = text || ''
    for (const { kind, re } of pats) {
      out = out.replace(re, (m) => {
        const seen = valueToPh.get(m); if (seen) return seen
        kinds[kind] = (kinds[kind] ?? 0) + 1
        const ph = `[${kind}_${kinds[kind]}]`
        mapping[ph] = m; valueToPh.set(m, ph)
        return ph
      })
    }
    return out
  })
  return { redacted, mapping, count: Object.keys(mapping).length, kinds }
}

// User-managed redaction policy (granular AI data-access control). Cached; cleared on save.
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
const POLICY_FILE = path.join(os.homedir(), '.noetica', 'privacy-policy.json')
let _policy: RedactPolicy | null | undefined
export function loadPolicy(): RedactPolicy {
  if (_policy !== undefined) return _policy ?? {}
  try { _policy = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) as RedactPolicy } catch { _policy = null }
  return _policy ?? {}
}
export function savePolicy(p: RedactPolicy): void {
  _policy = { disabled: Array.isArray(p.disabled) ? p.disabled : [], terms: Array.isArray(p.terms) ? p.terms.filter(Boolean).slice(0, 200) : [] }
  try { fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true }); fs.writeFileSync(POLICY_FILE, JSON.stringify(_policy)) } catch { /* best-effort */ }
}

/** Restore placeholders → original values (for un-redacting a vendor response). */
export function unredact(text: string, mapping: Record<string, string>): string {
  if (!text || !mapping) return text
  let out = text
  // longest placeholders first so e.g. [EMAIL_12] isn't clobbered by [EMAIL_1]
  for (const ph of Object.keys(mapping).sort((a, b) => b.length - a.length)) out = out.split(ph).join(mapping[ph]!)
  return out
}
