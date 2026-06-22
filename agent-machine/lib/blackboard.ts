/**
 * blackboard.ts — shared typed workspace for multi-agent coordination (Google ADK session.state, Hearsay-II
 * lineage). Agents coordinate indirectly by reading/writing keyed artifacts rather than threading everything
 * through one message stream — so specialists can be added/removed without rewiring, and intermediate
 * artifacts persist with per-key write history.
 */
export interface BoardEntry<T = unknown> { value: T; by: string; version: number; at: number }

export class Blackboard {
  private store = new Map<string, BoardEntry>()
  private log: Array<{ key: string; by: string; version: number }> = []

  write(key: string, value: unknown, by: string, at = 0): void {
    const prev = this.store.get(key)
    const version = (prev?.version ?? 0) + 1
    this.store.set(key, { value, by, version, at })
    this.log.push({ key, by, version })
  }

  read<T = unknown>(key: string): T | undefined { return this.store.get(key)?.value as T | undefined }
  has(key: string): boolean { return this.store.has(key) }
  keys(): string[] { return [...this.store.keys()] }
  version(key: string): number { return this.store.get(key)?.version ?? 0 }
  history(key: string): Array<{ by: string; version: number }> { return this.log.filter((l) => l.key === key) }
  /** Snapshot for checkpointing / handoff. */
  snapshot(): Record<string, unknown> { return Object.fromEntries([...this.store].map(([k, v]) => [k, v.value])) }
}
