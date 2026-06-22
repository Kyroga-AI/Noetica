/**
 * injection-classifier.ts — cheap pre-model classifier for prompt-injection / jailbreak attempts on the
 * INPUT side (Prompt Guard role). Complements rag-trust (which sanitizes RETRIEVED content): this scores the
 * user/agent prompt itself. Deterministic heuristic; a learned 22-86M encoder is the upgrade.
 */
const PATTERNS: Array<{ re: RegExp; flag: string }> = [
  { re: /ignore (?:all )?(?:previous|prior|above) (?:instructions|prompts?)/i, flag: 'override-instructions' },
  { re: /disregard (?:the )?(?:system|above|previous)/i, flag: 'disregard-system' },
  { re: /you are (?:now )?(?:a |an |in )?(?:dan|developer mode|jailbroken|unrestricted)/i, flag: 'persona-jailbreak' },
  { re: /pretend (?:to be|you (?:are|can))/i, flag: 'roleplay-bypass' },
  { re: /(?:reveal|print|show|repeat) (?:your |the )?(?:system )?(?:prompt|instructions|rules)/i, flag: 'prompt-extraction' },
  { re: /(?:without|with no|no) (?:any )?(?:restrictions|filters|guardrails|safety|limits|rules)\b/i, flag: 'disable-safety' },
  { re: /\bbase64\b|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i, flag: 'obfuscation' },
  { re: /do anything now|no longer (?:bound|restricted)/i, flag: 'unbounded' },
]

export function injectionScore(text: string): { score: number; flags: string[] } {
  const flags = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.flag)
  // saturating score: each distinct flag adds, capped at 1
  const score = Math.min(1, flags.length * 0.34)
  return { score: Number(score.toFixed(2)), flags }
}

export function isLikelyInjection(text: string, threshold = 0.34): boolean {
  return injectionScore(text).score >= threshold
}
