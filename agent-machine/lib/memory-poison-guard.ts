/**
 * Memory Poison Guard
 *
 * Detects attempts to poison the agent's memory via the `remember` built-in tool.
 * Ported from promptfoo redteam/plugins/agentic/memoryPoisoning.ts patterns.
 *
 * Usage: wrap the existing remember tool with wrapRememberWithPoisonGuard() for
 * logging and auditing — does NOT block writes, only logs warnings.
 */

export interface MemoryPoisonResult {
  flagged: boolean
  patterns: string[]
  confidence: number
}

// Patterns that signal memory poisoning attempts.
// Ported from promptfoo memoryPoisoning grader rubric + IPI heuristics.
const POISON_PATTERNS: { label: string; re: RegExp }[] = [
  {
    label: 'override-forget',
    re: /ignore previous|forget everything|override memory|disregard prior/i,
  },
  {
    label: 'role-confusion',
    re: /you are now|act as|pretend you are|your new identity/i,
  },
  {
    label: 'instruction-injection',
    re: /system:|<system>|<<SYS>>|\[INST\]/i,
  },
  {
    label: 'exfiltration-attempt',
    re: /send to|report to|relay to|forward to.*http/i,
  },
]

/**
 * Analyse a string that is about to be written into agent memory.
 * Returns flagged=true when one or more poison patterns match.
 */
export function detectMemoryPoisonAttempt(content: string): MemoryPoisonResult {
  const matched: string[] = []

  for (const { label, re } of POISON_PATTERNS) {
    if (re.test(content)) {
      matched.push(label)
    }
  }

  return {
    flagged: matched.length > 0,
    patterns: matched,
    confidence: Math.min(matched.length / POISON_PATTERNS.length, 1.0),
  }
}

export type Logger = { warn: (msg: string) => void }

/**
 * Wraps a `remember` function with poison detection.
 * On a positive detection the call is still executed (audit, not block)
 * but a warning is emitted through the supplied logger.
 */
export function wrapRememberWithPoisonGuard<T>(
  rememberFn: (content: string) => T,
  logger: Logger,
): (content: string) => T {
  return (content: string): T => {
    const result = detectMemoryPoisonAttempt(content)
    if (result.flagged) {
      logger.warn(
        `[memory-poison-guard] Possible memory poisoning attempt detected ` +
          `(confidence=${result.confidence.toFixed(2)}, patterns=${result.patterns.join(', ')}). ` +
          `Content preview: ${content.slice(0, 120)}`,
      )
    }
    return rememberFn(content)
  }
}
