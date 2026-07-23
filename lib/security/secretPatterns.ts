/**
 * secretPatterns — detect credentials pasted into free text.
 *
 * Powers chat-input secret detection (warn + redact-by-default before a key is
 * persisted into session storage, memory extraction, or an open-chat publish)
 * and the open-chat gate. Patterns are deliberately conservative: each one keys
 * on a vendor-specific prefix or structure, because a false positive here eats
 * legitimate message content. Notably ABSENT: bare 64-hex (sha256 digests and
 * federation keys look identical — dev chat is full of digests).
 */

export interface SecretHit {
  kind: string
  index: number
  length: number
  /** Last 4 characters — enough to recognize which key it was, useless to an attacker. */
  last4: string
}

// Order matters: more specific prefixes first (sk-ant- must win over a generic sk-).
const PATTERNS: Array<[kind: string, re: RegExp]> = [
  ['anthropic',   /sk-ant-[A-Za-z0-9_-]{24,}/g],
  ['openai',      /sk-(?:proj-|svcacct-|None-)?[A-Za-z0-9_-]{32,}/g],
  ['github',      /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/g],
  ['gitlab',      /glpat-[A-Za-z0-9_-]{20,}/g],
  ['aws',         /AKIA[0-9A-Z]{16}/g],
  ['google',      /AIza[0-9A-Za-z_-]{35}/g],
  ['slack',       /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['stripe',      /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['huggingface', /hf_[A-Za-z0-9]{30,}/g],
  ['jwt',         /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
]

export function detectSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = []
  const claimed: Array<[number, number]> = []
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      // First (most specific) pattern wins an overlapping span.
      if (claimed.some(([s, e]) => start < e && end > s)) continue
      claimed.push([start, end])
      hits.push({ kind, index: start, length: m[0].length, last4: m[0].slice(-4) })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** Replace each detected secret with an inert marker that still identifies WHICH key it was. */
export function redactSecrets(text: string, hits?: SecretHit[]): string {
  const found = hits ?? detectSecrets(text)
  let out = ''
  let pos = 0
  for (const h of found) {
    out += text.slice(pos, h.index) + `[redacted ${h.kind} key …${h.last4}]`
    pos = h.index + h.length
  }
  return out + text.slice(pos)
}
