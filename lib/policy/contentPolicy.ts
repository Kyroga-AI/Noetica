export type PolicyProfile = 'default' | 'strict' | 'permissive'

export interface PolicyCheckResult {
  admitted: boolean
  profile: PolicyProfile
  reason?: string
  flagged_pattern?: string
}

// Patterns that are blocked under 'default' and 'strict' profiles.
// 'permissive' logs but does not block.
const BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bignore (all )?(previous|prior|above) instructions?\b/i,
    reason: 'Prompt injection attempt detected.',
  },
  {
    pattern: /\bforget (everything|all instructions|your system prompt)\b/i,
    reason: 'Prompt injection attempt detected.',
  },
  {
    pattern: /\b(jailbreak|dan mode|do anything now|pretend you have no restrictions)\b/i,
    reason: 'Jailbreak attempt detected.',
  },
  {
    pattern: /\b(synthesize|manufacture|produce)\b.{0,60}\b(nerve agent|chemical weapon|bioweapon|sarin|vx gas|ricin)\b/i,
    reason: 'Prohibited content: CBRN weapons.',
  },
  {
    pattern: /\b(step.by.step|instructions? for|how to (make|create|build)).{0,80}\b(explosive|ied|bomb)\b/i,
    reason: 'Prohibited content: explosive device instructions.',
  },
  {
    pattern: /\bcsam\b|child (sexual|porn|explicit)/i,
    reason: 'Prohibited content: CSAM.',
  },
]

export function checkContentPolicy(text: string, profile: string = 'default'): PolicyCheckResult {
  const resolvedProfile = resolveProfile(profile)

  for (const { pattern, reason } of BLOCK_PATTERNS) {
    if (pattern.test(text)) {
      const admitted = resolvedProfile === 'permissive'
      return {
        admitted,
        profile: resolvedProfile,
        reason: admitted ? `Policy flag (non-blocking in permissive mode): ${reason}` : reason,
        flagged_pattern: pattern.source,
      }
    }
  }

  return { admitted: true, profile: resolvedProfile }
}

function resolveProfile(profile: string): PolicyProfile {
  if (profile === 'strict' || profile === 'permissive') return profile
  return 'default'
}
