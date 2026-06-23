/**
 * brain-scope — the THREE brains, kept as SEPARATE STORES so none can pollute another.
 *
 *   academic    — curated knowledge (MIT-OCW STEM). Store: the OCW `_brain` JSONL (dense vectors),
 *                 read by lib/study-brain.ts. Shippable, non-personal.
 *   operational — runbooks / ops knowledge (manpages). Store: ~/.noetica/ops-corpus (lexical text),
 *                 read by lib/ops-brain.ts. Shippable, non-personal.
 *   chat        — per-user conversational memory. Store: the HellGraph atomspace. PERSONAL, never shipped.
 *
 * Each brain is its own store retrieved by its own lane; they only compose at the retrieval layer.
 * Because chat lives in a DIFFERENT store from academic/operational, a user's conversation can never
 * contaminate the shipped knowledge (and vice-versa) — separation by construction, not by filtering.
 * The `scope` tag below makes the boundary explicit so a future shared-store path can also enforce it.
 */
export const BrainScope = {
  Academic: 'academic',
  Operational: 'operational',
  Chat: 'chat',
} as const
export type BrainScope = typeof BrainScope[keyof typeof BrainScope]

export const ALL_SCOPES: BrainScope[] = [BrainScope.Academic, BrainScope.Operational, BrainScope.Chat]

/** The shippable, non-personal knowledge brains — everything except the per-user chat brain. */
export const KNOWLEDGE_SCOPES: BrainScope[] = [BrainScope.Academic, BrainScope.Operational]

export function isKnowledgeScope(s: string): boolean {
  return s === BrainScope.Academic || s === BrainScope.Operational
}
export function isChatScope(s: string): boolean { return s === BrainScope.Chat }
