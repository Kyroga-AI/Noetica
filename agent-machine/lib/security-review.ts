/**
 * security-review.ts — SELF-HARDENING as a product capability: adversarial security review run on our OWN
 * LOCAL-FIRST models (sovereign, no cloud), AUDITED through scope-d (Event-IR). This is the "harden with our
 * local models in scope-d" the user asked for — the same vuln-class checklist a human reviewer used, now
 * driven by the local mesh and recorded as a scope-d POLICY_DECISION event.
 *
 * Pure parts (vuln classes, prompt, parsing, summary) are unit-tested; reviewCode orchestrates the local model
 * (injected → testable) + the scope-d audit.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface VulnClass { id: string; name: string; hint: string }
export const VULN_CLASSES: VulnClass[] = [
  { id: 'xss', name: 'XSS / HTML injection', hint: 'dangerouslySetInnerHTML, unescaped user content into the DOM' },
  { id: 'path-traversal', name: 'Path traversal / arbitrary file access', hint: 'user-controlled paths without realpath + allowlist' },
  { id: 'oom-dos', name: 'OOM / DoS', hint: 'unbounded body/loop/map growth, no size caps' },
  { id: 'injection', name: 'Command / SQL / template injection', hint: 'user input into shell/query/yaml/template' },
  { id: 'proto-pollution', name: 'Prototype pollution', hint: '__proto__/constructor keys from parsed JSON merged into objects' },
  { id: 'data-loss', name: 'Data loss / persistence', hint: 'non-atomic writes, silent wipe on corrupt state, id collisions' },
  { id: 'redos', name: 'ReDoS', hint: 'catastrophic-backtracking regex on user input' },
  { id: 'authz', name: 'Missing authz / trust boundary', hint: 'mutating endpoints with no auth or input validation' },
  { id: 'secrets', name: 'Secret / PII exposure', hint: 'logging or returning secrets, stack traces in responses' },
]

export interface Finding { severity: Severity; vulnClass: string; detail: string; line?: number; fix?: string }
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

/** Build the adversarial review prompt for a local model: list the vuln classes, demand strict JSON findings. */
export function buildReviewPrompt(code: string, opts: { subject?: string } = {}): string {
  const classes = VULN_CLASSES.map((v) => `- ${v.id}: ${v.name} (${v.hint})`).join('\n')
  return `You are a harsh adversarial security reviewer. Find REAL bugs/vulnerabilities in this code${opts.subject ? ` (${opts.subject})` : ''}, not style nits. Check each class:\n${classes}\n\nReturn STRICT JSON only — an array:\n[{"severity":"critical|high|medium|low","vulnClass":"<id>","detail":"<what+why>","line":<n|null>,"fix":"<concrete fix>"}]\nEmpty array if genuinely clean.\n\nCODE:\n${code.slice(0, 12000)}`
}

/** Parse + validate the model's findings (tolerant of prose around the JSON). */
export function parseFindings(output: string): Finding[] {
  const m = output.match(/\[[\s\S]*\]/)
  if (!m) return []
  let arr: unknown
  try { arr = JSON.parse(m[0]) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const valid = new Set(VULN_CLASSES.map((v) => v.id))
  return arr
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: (SEVERITIES.includes(f['severity'] as Severity) ? f['severity'] : 'medium') as Severity,
      vulnClass: valid.has(String(f['vulnClass'])) ? String(f['vulnClass']) : 'unknown',
      detail: String(f['detail'] ?? '').slice(0, 600),
      line: typeof f['line'] === 'number' ? f['line'] : undefined,
      fix: f['fix'] != null ? String(f['fix']).slice(0, 600) : undefined,
    }))
    .filter((f) => f.detail.length > 0)
}

export function summarize(findings: Finding[]): { critical: number; high: number; medium: number; low: number; total: number; passed: boolean } {
  const c = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) c[f.severity]++
  return { ...c, total: findings.length, passed: c.critical === 0 && c.high === 0 }
}

export interface ReviewResult { findings: Finding[]; summary: ReturnType<typeof summarize>; model: string; audited: boolean }

/**
 * Run a security review on a LOCAL model + emit a scope-d Event-IR audit. generate is injected (defaults to
 * the local Ollama model) so this is unit-testable and runs entirely on-device (tier 'local', no egress).
 */
export async function reviewCode(code: string, opts: { subject?: string; model?: string; generate?: (prompt: string, model: string) => Promise<string> } = {}): Promise<ReviewResult> {
  let model = opts.model ?? ''
  const gen = opts.generate ?? (async (prompt, m) => {
    const { generateOllamaText, listLocalModels } = await import('./ollama.js')
    const chosen = m || (await listLocalModels())[0] || 'qwen2.5:7b'
    model = chosen
    return (await generateOllamaText({ model: chosen, messages: [{ role: 'user', content: prompt }], temperature: 0.1, numCtx: 16384 })).content
  })
  const out = await gen(buildReviewPrompt(code, { subject: opts.subject }), model)
  const findings = parseFindings(out)
  const summary = summarize(findings)
  let audited = false
  try {
    const { emitScopedTelemetry, scopedConfigured } = await import('./scope-d.js')
    emitScopedTelemetry({ kind: 'security-review', allow: summary.passed, provider: 'noetica', model: model || 'local', tier: 'local', scope: opts.subject ?? 'code', reason: `review:${summary.critical}C/${summary.high}H/${summary.medium}M`, source: 'self-hardening' })
    audited = scopedConfigured()
  } catch { /* audit best-effort */ }
  return { findings, summary, model: model || 'local', audited }
}
