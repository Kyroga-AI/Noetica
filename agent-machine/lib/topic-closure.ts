/**
 * topic-closure — cluster topic/node labels by LEXICAL CLOSURE so the same semantic topic
 * stops fragmenting into separate nodes. In the graph, `noetica`, `notca`, `ntca`,
 * `noetica_probe`, `noetica-works`, `self notca md`, `/tmp/ntca prbe` are all one topic —
 * but they show up scattered because clustering keyed on exact labels.
 *
 * Lexical closure = transitive closure of a lexical-similarity relation (union-find): if
 * A~B and B~C then {A,B,C} are one topic. The relation combines:
 *   • shared core token (exact / prefix, len≥4)
 *   • shared CONSONANT SKELETON (drop vowels) — the key signal for typo/abbreviation
 *     variants: noetica→"ntc", notca→"ntc", ntca→"ntc" all collapse to the same skeleton
 *   • small edit distance on core tokens (≤1, len≥4) for plain typos
 * Canonical label per cluster = the fullest spelled-out form (length × vowel ratio), so
 * `noetica` wins over `notca`/`ntca`.
 *
 * Pure + deterministic. The graph clusterer calls clusterByLexicalClosure(labels).
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
const STOP = new Set(['self', 'tmp', 'test', 'the', 'and', 'for', 'with', 'this', 'that', 'prbe', 'probe', 'works', 'work', 'node', 'data', 'file', 'main'])

/** Core tokens of a label: split on separators, lowercased, length ≥ 3, non-stopword. */
export function coreTokens(label: string): string[] {
  return label.toLowerCase().split(/[\s_\-/.:]+/).map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t))
}

/** Consonant skeleton: drop vowels, collapse consecutive duplicates. "noetica" → "ntc". */
export function consonantSkeleton(word: string): string {
  let out = ''
  for (const ch of word.toLowerCase()) {
    if (ch < 'a' || ch > 'z' || VOWELS.has(ch)) continue
    if (out[out.length - 1] !== ch) out += ch
  }
  return out
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 3
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]!; dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]!
      dp[i] = Math.min(dp[i]! + 1, dp[i - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[m]!
}

/** Do two core tokens denote the same topic root? */
function tokensRelated(a: string, b: string): boolean {
  if (a === b) return true
  // prefix containment (noetica ⊃ noetic), len-guarded
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  const sa = consonantSkeleton(a), sb = consonantSkeleton(b)
  if (sa.length >= 3 && sa === sb) return true                                  // ntc === ntc
  if (sa.length >= 4 && sb.length >= 4 && (sa.includes(sb) || sb.includes(sa))) return true
  if (a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1) return true     // plain typo
  return false
}

class UnionFind {
  parent = new Map<string, string>()
  find(x: string): string { const p = this.parent.get(x) ?? x; if (p === x) return x; const r = this.find(p); this.parent.set(x, r); return r }
  union(a: string, b: string) { this.parent.set(this.find(a), this.find(b)) }
  add(x: string) { if (!this.parent.has(x)) this.parent.set(x, x) }
}

export interface ClosureResult {
  /** Each cluster's labels. */
  clusters: string[][]
  /** label → canonical topic name for its cluster. */
  canonicalOf: Map<string, string>
  /** label → stable cluster index. */
  clusterId: Map<string, number>
}

/** "Fullness" score — prefer the most spelled-out form as the canonical label. */
function fullness(token: string): number {
  const v = [...token].filter((c) => VOWELS.has(c)).length
  return token.length * (1 + v / Math.max(1, token.length))   // length, boosted by vowel ratio
}

/**
 * Cluster labels by lexical closure. Two labels join if ANY of their core tokens are
 * lexically related; clusters are the connected components (transitive closure).
 */
export function clusterByLexicalClosure(labels: string[]): ClosureResult {
  const uniq = [...new Set(labels)]
  const uf = new UnionFind()
  for (const l of uniq) uf.add(l)

  const tokensOf = new Map<string, string[]>()
  for (const l of uniq) tokensOf.set(l, coreTokens(l))

  // Relate labels that share any lexically-related core token (O(n²·t²) — fine for graph sizes).
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const ti = tokensOf.get(uniq[i]!)!, tj = tokensOf.get(uniq[j]!)!
      let related = false
      for (const a of ti) { for (const b of tj) { if (tokensRelated(a, b)) { related = true; break } } if (related) break }
      if (related) uf.union(uniq[i]!, uniq[j]!)
    }
  }

  // Collect components.
  const groups = new Map<string, string[]>()
  for (const l of uniq) { const r = uf.find(l); (groups.get(r) ?? groups.set(r, []).get(r)!).push(l) }

  const clusters: string[][] = []
  const canonicalOf = new Map<string, string>()
  const clusterId = new Map<string, number>()
  let idx = 0
  for (const members of groups.values()) {
    // Canonical = the fullest core token across the cluster (else the shortest label).
    let best = '', bestScore = -1
    for (const m of members) for (const t of tokensOf.get(m)!) { const s = fullness(t); if (s > bestScore) { bestScore = s; best = t } }
    const canonical = best || members.slice().sort((a, b) => a.length - b.length)[0]!
    for (const m of members) { canonicalOf.set(m, canonical); clusterId.set(m, idx) }
    clusters.push(members)
    idx++
  }
  return { clusters, canonicalOf, clusterId }
}
