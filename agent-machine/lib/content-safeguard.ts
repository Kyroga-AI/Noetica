/**
 * content-safeguard — policy-driven content classification gate (gpt-oss-safeguard analog).
 *
 * Noetica ships an attested *uncensored* sovereign lane: a vetted operator gets a model that
 * won't refuse legitimate security / dual-use / sensitive work. "Uncensored" is NOT "ungoverned" —
 * even that lane must hard-block the small set of categories that are illegal everywhere and carry
 * no legitimate use (CSAE, credible mass-casualty / bioweapon synthesis facilitation). gpt-oss-safeguard
 * is OpenAI's open-weights policy-reasoning classifier for exactly this: you hand it a written policy
 * and it labels content against it, rather than baking refusals into the generation model.
 *
 * This module is the deterministic floor of that design: a fast, transparent, local-only classifier
 * over a declared policy set. It runs BEFORE egress / generation, returns an auditable per-policy
 * verdict, and never depends on a network call. A model escalation hook (`classifyWithModel`) can
 * layer gpt-oss-safeguard-20b on top for the ambiguous middle, but the hard-block floor is rule-based
 * so it cannot be jailbroken away by prompt injection into the classifier.
 *
 * Design choices:
 *  - Severity, not a boolean: callers decide their own threshold per lane (uncensored lane blocks only
 *    `prohibited`; a default lane may also block `high`).
 *  - Policies are data, not code — a deployment can add/disable categories without a rebuild.
 *  - Deterministic + order-independent: the same text always yields the same verdict (auditable).
 */

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'prohibited'

const SEVERITY_RANK: Record<Severity, number> = {
  none: 0, low: 1, medium: 2, high: 3, prohibited: 4,
}

/** Is `a` at least as severe as `b`? */
export function atLeast(a: Severity, b: Severity): boolean {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b]
}

export interface Policy {
  /** Stable id, e.g. "csae", "mass-casualty". */
  id: string
  /** Human-readable description of what this policy forbids (the gpt-oss-safeguard "policy text"). */
  description: string
  /** Severity assigned when this policy matches. */
  severity: Severity
  /** Trigger patterns. A policy matches when ANY pattern matches. */
  patterns: RegExp[]
  /** Phrases that, if present, exonerate an otherwise-matching policy (reduces false positives). */
  exempts?: RegExp[]
}

export interface PolicyHit {
  policyId: string
  severity: Severity
  description: string
  /** The substrings that triggered the match (for the audit log — never the surrounding secret). */
  matches: string[]
}

export interface SafeguardVerdict {
  /** Highest severity across all hits. */
  severity: Severity
  hits: PolicyHit[]
  /** True when nothing matched. */
  clean: boolean
}

/**
 * The hard-block floor: categories illegal everywhere with no legitimate use. These stay `prohibited`
 * in EVERY lane, including the attested uncensored lane. Kept deliberately narrow — this is not a
 * morality filter, it is the legal floor.
 */
export const PROHIBITED_FLOOR: Policy[] = [
  {
    id: 'csae',
    description: 'Child sexual abuse / exploitation material or solicitation.',
    severity: 'prohibited',
    patterns: [
      /\bchild\s+(?:sexual|porn|abuse\s+material)\b/i,
      /\bcsam\b/i,
      /\bminor[s]?\b[^.\n]{0,40}\b(?:sexual|explicit|nude|nudes)\b/i,
      /\b(?:sexual|explicit)\b[^.\n]{0,40}\bminor[s]?\b/i,
    ],
  },
  {
    id: 'mass-casualty',
    description: 'Operational facilitation of mass-casualty weapons (bio/chem/nuclear synthesis or deployment).',
    severity: 'prohibited',
    patterns: [
      /\b(?:synthesi[sz]e|culture|weaponi[sz]e|aerosoli[sz]e)\b[^.\n]{0,40}\b(?:anthrax|smallpox|ricin|sarin|nerve\s+agent|pathogen)\b/i,
      /\bbuild\b[^.\n]{0,30}\b(?:nuclear|dirty)\s+(?:bomb|device)\b/i,
      /\b(?:enrich|weapons[-\s]?grade)\b[^.\n]{0,20}\b(?:uranium|plutonium)\b/i,
    ],
    // Defensive / academic framing is not facilitation.
    exempts: [/\b(?:detect|defen[sc]e|defensive|countermeasure|protect against|history of|symptoms of)\b/i],
  },
]

/** Optional default-lane policies (NOT applied to the uncensored lane). Advisory severities. */
export const DEFAULT_LANE_POLICIES: Policy[] = [
  {
    id: 'credible-threat',
    description: 'Credible, specific threat of violence against a named person or place.',
    severity: 'high',
    patterns: [/\b(?:i (?:will|am going to)|we will)\b[^.\n]{0,30}\b(?:kill|shoot|bomb|attack)\b[^.\n]{0,40}\b(?:at|on|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i],
  },
]

function policyHit(text: string, p: Policy): PolicyHit | null {
  if (p.exempts?.some((e) => e.test(text))) return null
  const matches: string[] = []
  for (const re of p.patterns) {
    const m = text.match(re)
    if (m) matches.push(m[0].slice(0, 80))
  }
  if (!matches.length) return null
  return { policyId: p.id, severity: p.severity, description: p.description, matches }
}

/**
 * Classify `text` against a policy set. Pure + deterministic.
 * Defaults to the prohibited floor only — pass an explicit set to widen.
 */
export function classify(text: string, policies: Policy[] = PROHIBITED_FLOOR): SafeguardVerdict {
  const hits: PolicyHit[] = []
  for (const p of policies) {
    const hit = policyHit(text ?? '', p)
    if (hit) hits.push(hit)
  }
  const severity = hits.reduce<Severity>(
    (acc, h) => (SEVERITY_RANK[h.severity] > SEVERITY_RANK[acc] ? h.severity : acc),
    'none',
  )
  return { severity, hits, clean: hits.length === 0 }
}

export interface GateDecision {
  allowed: boolean
  verdict: SafeguardVerdict
  /** Why it was blocked (empty when allowed) — safe to surface to the operator + audit log. */
  reason: string
}

/**
 * The sovereign (uncensored, attested) lane gate: blocks ONLY the prohibited legal floor.
 * Everything else — security research, dual-use, sensitive but lawful — passes.
 */
export function gateSovereignLane(text: string): GateDecision {
  const verdict = classify(text, PROHIBITED_FLOOR)
  const allowed = !atLeast(verdict.severity, 'prohibited')
  return {
    allowed,
    verdict,
    reason: allowed ? '' : `blocked by prohibited-floor policy: ${verdict.hits.map((h) => h.policyId).join(', ')}`,
  }
}

/**
 * The default lane gate: blocks the prohibited floor AND default-lane policies at/above `threshold`.
 */
export function gateDefaultLane(text: string, threshold: Severity = 'high'): GateDecision {
  const verdict = classify(text, [...PROHIBITED_FLOOR, ...DEFAULT_LANE_POLICIES])
  const allowed = !atLeast(verdict.severity, threshold)
  return {
    allowed,
    verdict,
    reason: allowed ? '' : `blocked at severity ${verdict.severity} (≥ ${threshold}): ${verdict.hits.map((h) => h.policyId).join(', ')}`,
  }
}

/**
 * Escalation hook: when the deterministic floor is clean but a deployment wants gpt-oss-safeguard-20b
 * to reason over a free-text policy, wire it here. The model returns a severity; the caller still
 * unions it with the rule floor so the model can only ESCALATE, never override a hard block.
 */
export async function classifyWithModel(
  text: string,
  policyText: string,
  runner: (prompt: string) => Promise<string>,
): Promise<Severity> {
  const floor = classify(text, PROHIBITED_FLOOR)
  if (atLeast(floor.severity, 'prohibited')) return 'prohibited' // never downgrade the floor
  const prompt =
    `You are a content policy classifier. Policy:\n${policyText}\n\n` +
    `Content:\n${text}\n\n` +
    `Reply with exactly one word — the severity: none | low | medium | high | prohibited.`
  const raw = (await runner(prompt)).trim().toLowerCase()
  const word = raw.match(/none|low|medium|high|prohibited/)?.[0] as Severity | undefined
  const modelSeverity = word ?? 'none'
  // Union with the floor: take the more severe of the two.
  return atLeast(modelSeverity, floor.severity) ? modelSeverity : floor.severity
}
