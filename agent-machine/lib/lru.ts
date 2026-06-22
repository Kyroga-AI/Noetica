/**
 * lru — a minimal bounded LRU map for process-lifetime caches that would otherwise grow without limit.
 *
 * Several module-level `Map` caches (graph-cluster embed/cluster results, model-variant maps) accrue
 * one entry per distinct key seen over the life of the server and are never evicted, so on a long-running
 * instance with an evolving graph they leak memory monotonically. BoundedMap caps entry count and evicts
 * the least-recently-used key. Backed by a `Map` (insertion-ordered): a `get`/`set` re-inserts the key as
 * most-recently-used, so the first key in iteration order is always the LRU victim.
 */
export class BoundedMap<K, V> {
  private m = new Map<K, V>()
  constructor(private cap: number) { this.cap = Math.max(1, cap) }

  get(k: K): V | undefined {
    const v = this.m.get(k)
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v) } // touch → MRU
    return v
  }

  has(k: K): boolean { return this.m.has(k) }

  set(k: K, v: V): void {
    if (this.m.has(k)) this.m.delete(k)
    this.m.set(k, v)
    while (this.m.size > this.cap) {
      const oldest = this.m.keys().next().value as K | undefined
      if (oldest === undefined) break
      this.m.delete(oldest)
    }
  }

  get size(): number { return this.m.size }
}
