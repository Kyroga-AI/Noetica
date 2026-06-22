/**
 * graph-tune.ts — auto prompt tuning (GraphRAG's domain-adaptation stage).
 *
 * Fixed extraction prompts are domain-blind: the same prompt that works for software docs is weak on
 * biomedical or legal text. GraphRAG samples the corpus, detects the domain, and synthesizes a persona
 * + typical entity/claim types to specialize extraction. We do the same — and the resulting persona is
 * threaded into community summarization AND verified-covariate extraction so both adapt to the user's
 * actual material. One cheap LLM call, cached per corpus signature.
 */

import { generateOllamaText } from './ollama.js'

export interface DomainProfile {
  domain: string          // e.g. "software architecture", "clinical research"
  persona: string         // an expert system-prompt prefix for extraction
  entityTypes: string[]   // entity types typical of this domain
  claimTypes: string[]    // covariate/claim types typical of this domain
}

const FALLBACK: DomainProfile = {
  domain: 'general knowledge',
  persona: 'You are a careful analyst extracting structured knowledge from a personal knowledge graph.',
  entityTypes: ['concept', 'system', 'person', 'organization', 'document'],
  claimTypes: ['capability', 'dependency', 'ownership', 'relationship', 'fact'],
}

function safeJson(s: string): Partial<DomainProfile> | null {
  const m = s.match(/\{[\s\S]*\}/); if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Sample the corpus, detect its domain, and synthesize a tuning profile for downstream extraction. */
export async function detectDomain(samples: string[], opts: { model: string }): Promise<DomainProfile> {
  const sample = [...new Set(samples)].filter(Boolean).join('\n').slice(0, 4000)
  if (!sample.trim()) return FALLBACK
  const prompt = `Below is a sample of a user's knowledge corpus. Identify its DOMAIN and produce a tuning profile for an extraction system.

Sample:
${sample}

Return STRICT JSON only:
{"domain":"<2-4 word domain>","persona":"<one sentence: 'You are an expert <role> analyzing <domain>...' — used as a system prompt to specialize extraction>","entityTypes":["<5 entity types typical of this domain>"],"claimTypes":["<5 claim/relationship types typical of this domain>"]}`
  try {
    const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, numCtx: 8192 })
    const j = safeJson(content)
    if (!j || !j.persona) return FALLBACK
    return {
      domain: (j.domain || FALLBACK.domain).slice(0, 60),
      persona: (j.persona || FALLBACK.persona).slice(0, 400),
      entityTypes: Array.isArray(j.entityTypes) ? j.entityTypes.slice(0, 6).map((x) => String(x).slice(0, 24)) : FALLBACK.entityTypes,
      claimTypes: Array.isArray(j.claimTypes) ? j.claimTypes.slice(0, 6).map((x) => String(x).slice(0, 24)) : FALLBACK.claimTypes,
    }
  } catch { return FALLBACK }
}
