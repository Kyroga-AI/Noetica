/**
 * slash-topic-scope.ts — the SCOPING half of SocioProphet/slash-topics (complements the existing
 * slash-topics.ts taxonomy classification). Governed, signed, replayable `/topic` SCOPES for retrieval:
 * a topic pack is a named include/exclude constraint set; applying it to retrieval candidates yields a
 * scoped result + a deterministic replay receipt (audit/replay), per the slash-topics "policy membrane +
 * deterministic receipts" model.
 */
export interface TopicPack {
  topic: string                 // e.g. "/security"
  version: string
  include: string[]
  exclude?: string[]
  signature?: string
}

export interface ReplayReceipt { topic: string; version: string; inputCount: number; keptCount: number; criteria: string }
export interface ScopedResult<T> { kept: T[]; dropped: number; receipt: ReplayReceipt }

const matchesScope = (text: string, pack: TopicPack): boolean => {
  const t = text.toLowerCase()
  if (pack.exclude?.some((x) => t.includes(x.toLowerCase()))) return false
  if (pack.include.length === 0) return true
  return pack.include.some((i) => t.includes(i.toLowerCase()))
}

/** Apply a `/topic` scope to retrieval candidates → kept set + deterministic replay receipt. */
export function applyScope<T extends { text: string }>(items: T[], pack: TopicPack): ScopedResult<T> {
  const kept = items.filter((it) => matchesScope(it.text, pack))
  return {
    kept,
    dropped: items.length - kept.length,
    receipt: { topic: pack.topic, version: pack.version, inputCount: items.length, keptCount: kept.length, criteria: `include[${pack.include.join('|')}] exclude[${(pack.exclude ?? []).join('|')}]` },
  }
}

/** Deterministic content digest of a topic pack (djb2) — stand-in for the slash-topics sigstore signature. */
export function packDigest(pack: Omit<TopicPack, 'signature'>): string {
  const canonical = JSON.stringify({ topic: pack.topic, version: pack.version, include: [...pack.include].sort(), exclude: [...(pack.exclude ?? [])].sort() })
  let h = 5381
  for (let i = 0; i < canonical.length; i++) h = ((h * 33) ^ canonical.charCodeAt(i)) >>> 0
  return 'pack_' + h.toString(16).padStart(8, '0')
}

export function conformsToTopicPack(p: Partial<TopicPack>): { conforms: boolean; missing: string[] } {
  const missing: string[] = []
  if (!p.topic || !p.topic.startsWith('/')) missing.push('topic (must start with /)')
  if (!p.version) missing.push('version')
  if (!Array.isArray(p.include)) missing.push('include')
  return { conforms: missing.length === 0, missing }
}
