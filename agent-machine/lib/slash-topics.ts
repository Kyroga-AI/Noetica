/**
 * slash-topics — ground graph topics in the Blekko slash-topic taxonomy (SocioProphet/slash-topics),
 * instead of naming clusters from ad-hoc token frequency alone. The taxonomy is 482 curated topics
 * across 19 high-level categories (computers, science, business, …) — the "fossil record" of the
 * blekko `/topic` map, vendored at data/slash-topics-core.json.
 *
 * classifyTerms() matches a cluster's member terms against topic-name vocabulary and returns the
 * best canonical topic + its category, or null when nothing meaningfully overlaps (caller then
 * falls back to deterministic synthesis). This turns "model-router, model-store, …" into the
 * canonical "Cloud"/"Artificial Intelligence"/"Databases" where the taxonomy actually covers it.
 */
import RAW from '../data/slash-topics-core.json'

interface SlashTopic { name: string; slash: string; category: string }
const TOPICS = RAW as SlashTopic[]

// Words too generic to anchor a topic match on their own.
const GENERIC = new Set(['the', 'and', 'for', 'data', 'system', 'systems', 'service', 'services', 'tech', 'app', 'apps', 'tool', 'tools', 'new', 'web'])
function toks(s: string): string[] {
  return s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/i).filter((t) => t.length >= 3 && !GENERIC.has(t))
}

const topicTokens = new Map<string, string[]>()
for (const t of TOPICS) {
  const tk = toks(t.name)
  if (tk.length) topicTokens.set(t.name, tk)
}

/** The 19 top-level categories — the coarse class layer. */
export const SLASH_CATEGORIES = [...new Set(TOPICS.map((t) => t.category))]

export interface TopicMatch { topic: string; category: string; score: number; matched: string[] }

/**
 * Best taxonomy topic for a set of cluster terms, or null. Scored by how much of the topic's OWN
 * name the cluster covers (so a 2-word topic fully hit beats a 1-word coincidence), with a small
 * bump per matched token. Requires a real hit — a full multi-word topic, or a cluster term that
 * exactly IS a single-word topic — so generic single-word overlaps don't mislabel a cluster.
 */
export function classifyTerms(terms: string[]): TopicMatch | null {
  const cluster = new Set(terms.flatMap(toks))
  if (!cluster.size) return null
  let best: TopicMatch | null = null
  for (const [name, tk] of topicTokens) {
    const matched = tk.filter((w) => cluster.has(w))
    if (!matched.length) continue
    const score = matched.length / tk.length + (tk.length > 1 && matched.length === tk.length ? 0.5 : 0) + matched.length * 0.01
    if (!best || score > best.score) {
      const cat = TOPICS.find((t) => t.name === name)!.category
      best = { topic: name, category: cat, score, matched }
    }
  }
  if (best && (best.matched.length >= 2 || best.score >= 0.99)) return best
  return null
}

/** "artificial-intelligence" → "Artificial Intelligence" */
export function titleCaseTopic(name: string): string {
  return name.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
