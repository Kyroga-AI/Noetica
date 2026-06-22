/**
 * memory-decay.ts — salience-based decay + principled forgetting for self-writing memory.
 *
 * A memory store that only GROWS accumulates noise and risks self-reinforcing error (FadeMem arXiv 2601.18642,
 * SSGM 2603.11768). Bi-temporal validity handles "is this still true"; this handles "is this still WORTH
 * keeping". Salience fuses base importance × access frequency × Ebbinghaus recency decay — frequently/recently
 * used memories stay sharp, stale ones fade and can be pruned to a budget. Pure + deterministic + offline.
 */

export interface DecayMemory {
  id: string
  createdAt: number          // epoch ms
  lastAccess?: number        // epoch ms; defaults to createdAt
  accessCount?: number       // times retrieved/used
  importance?: number        // 0..1 base salience (e.g. user-pinned = 1)
  pinned?: boolean           // never decays / never evicted
}

export interface DecayOpts {
  halfLifeDays?: number      // base Ebbinghaus half-life for an unaccessed memory
  now?: number               // epoch ms (injectable for determinism/testing)
}

/**
 * Salience in [0,1]. Access frequency strengthens the memory (slows decay, hippocampal consolidation);
 * recency follows an Ebbinghaus forgetting curve; base importance scales the whole thing. Pinned = 1.
 */
export function salience(m: DecayMemory, opts: DecayOpts = {}): number {
  if (m.pinned) return 1
  const now = opts.now ?? Date.now()
  const halfLifeDays = opts.halfLifeDays ?? 30
  const lastAccess = m.lastAccess ?? m.createdAt
  const days = Math.max(0, (now - lastAccess) / 86_400_000)
  const access = Math.max(0, m.accessCount ?? 0)
  const strength = 1 + Math.log2(1 + access)                     // more uses → longer effective half-life
  const halfLife = halfLifeDays * strength
  const retention = Math.pow(0.5, days / halfLife)               // 2^(-Δt/halfLife) ∈ (0,1]
  const importance = Math.min(1, Math.max(0, m.importance ?? 0.5))
  return importance * retention
}

/** Memories sorted by descending salience, each annotated with its score. */
export function decayRank<T extends DecayMemory>(mems: T[], opts: DecayOpts = {}): Array<T & { salience: number }> {
  return mems
    .map((m) => ({ ...m, salience: salience(m, opts) }))
    .sort((a, b) => b.salience - a.salience)
}

/**
 * Keep at most `budget` memories by salience (pinned always kept and not counted against eviction first).
 * Returns the survivors and the evicted set, plus the salience threshold applied.
 */
export function pruneToBudget<T extends DecayMemory>(mems: T[], budget: number, opts: DecayOpts = {}): { keep: T[]; evict: T[]; threshold: number } {
  const pinned = mems.filter((m) => m.pinned)
  const rest = decayRank(mems.filter((m) => !m.pinned), opts)
  const room = Math.max(0, budget - pinned.length)
  const kept = rest.slice(0, room)
  const evicted = rest.slice(room)
  const threshold = kept.length ? kept[kept.length - 1]!.salience : 0
  const strip = (x: T & { salience: number }) => { const { salience: _s, ...rest } = x; return rest as unknown as T }
  return { keep: [...pinned, ...kept.map(strip)], evict: evicted.map(strip), threshold }
}

/** Mark a memory as accessed now — bumps count + recency so it resists decay. */
export function touch<T extends DecayMemory>(m: T, now?: number): T & { lastAccess: number; accessCount: number } {
  return { ...m, lastAccess: now ?? Date.now(), accessCount: (m.accessCount ?? 0) + 1 }
}
