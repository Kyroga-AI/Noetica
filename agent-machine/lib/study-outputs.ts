/**
 * study-outputs.ts — NotebookLM-class research outputs (briefing doc, study guide, audio-overview script),
 * provenance-grounded, with one differentiator NotebookLM/Watson can't match: DEFINITIONS come from the
 * FRONTIER-AUTHORED canon (canonDef), not the local 7B. NotebookLM's study-guide glossary is whatever Gemini
 * says; ours is authoritative where the canon covers the term, and only falls back to the model otherwise.
 *
 * The generate (LLM) and canon-lookup functions are INJECTED, so the assembly/parsing core is deterministic
 * and unit-testable with no live model — same pattern as raptor.ts. Production binds generateOllamaText + canonDef.
 */

export type Generate = (prompt: string) => Promise<string>
export type CanonLookup = (term: string) => string | null

export interface Definition { term: string; definition: string; source: 'canon' | 'model' }
export interface StudyGuide {
  definitions: Definition[]
  shortAnswer: string[]
  essayQuestions: string[]
  glossary: Definition[]
}
export interface Briefing { themes: string[]; keyFacts: string[]; quotes: string[]; summary: string }
export interface DialogueTurn { speaker: 'Host' | 'Guest'; line: string }
export type AudioFormat = 'brief' | 'critique' | 'debate'

/** Robustly pull a JSON value out of an LLM response (handles ```json fences and surrounding prose). */
export function extractJson<T>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1]! : raw
  // find the first balanced object/array
  const start = body.search(/[[{]/)
  if (start < 0) return null
  const open = body[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++
    else if (body[i] === close) { depth--; if (depth === 0) { try { return JSON.parse(body.slice(start, i + 1)) as T } catch { return null } } }
  }
  return null
}

const joinSources = (sources: string[], cap = 8000): string =>
  sources.map((s, i) => `[${i + 1}] ${s}`).join('\n\n').slice(0, cap)

/** Briefing doc: executive summary of the sources — themes, key facts, notable quotes (NotebookLM "Briefing"). */
export async function generateBriefing(sources: string[], generate: Generate): Promise<Briefing> {
  const out = await generate(
    `From the sources below, produce a briefing as JSON with keys: "themes" (3-6 strings), "keyFacts" (4-8 ` +
    `strings), "quotes" (1-4 verbatim notable quotes), "summary" (one paragraph). Use ONLY the sources.\n\n` +
    `${joinSources(sources)}\n\nJSON:`)
  const p = extractJson<Partial<Briefing>>(out) ?? {}
  return {
    themes: p.themes ?? [], keyFacts: p.keyFacts ?? [], quotes: p.quotes ?? [],
    summary: p.summary ?? '',
  }
}

/**
 * Study guide (NotebookLM "Study Guide"): definitions, short-answer questions, essay questions, glossary.
 * Definitions/glossary entries are OVERRIDDEN by the frontier-authored canon wherever it covers the term —
 * the authoritative-definitions differentiator. `lookupCanon` returns a canon def or null.
 */
export async function generateStudyGuide(sources: string[], generate: Generate, lookupCanon?: CanonLookup): Promise<StudyGuide> {
  const out = await generate(
    `From the sources below, produce an exam study guide as JSON with keys: "terms" (6-12 key term strings), ` +
    `"definitions" (array of {term, definition}), "shortAnswer" (5-8 question strings), "essayQuestions" ` +
    `(2-4 strings), "glossary" (array of {term, gloss}). Use ONLY the sources.\n\n${joinSources(sources)}\n\nJSON:`)
  const p = extractJson<{ definitions?: Array<{ term: string; definition: string }>; shortAnswer?: string[]; essayQuestions?: string[]; glossary?: Array<{ term: string; gloss: string }> }>(out) ?? {}
  // canon wins over the model for any term it covers (frontier-authored, never 7B-authored)
  const ground = (term: string, modelDef: string): Definition => {
    const canon = lookupCanon?.(term)
    return canon ? { term, definition: canon, source: 'canon' } : { term, definition: modelDef, source: 'model' }
  }
  return {
    definitions: (p.definitions ?? []).map((d) => ground(d.term, d.definition)),
    shortAnswer: p.shortAnswer ?? [],
    essayQuestions: p.essayQuestions ?? [],
    glossary: (p.glossary ?? []).map((g) => ground(g.term, g.gloss)),
  }
}

/** Audio-overview script (NotebookLM "Audio Overview"): a two-host dialogue the TTS layer voices. */
export async function generateAudioScript(sources: string[], generate: Generate, format: AudioFormat = 'brief'): Promise<DialogueTurn[]> {
  const style = format === 'debate' ? 'a debate where Host and Guest argue opposing readings'
    : format === 'critique' ? 'a critical discussion that probes weaknesses and open questions'
    : 'a concise, friendly deep-dive'
  const out = await generate(
    `Write ${style} between two hosts about the sources, as JSON: an array of {speaker, line} where speaker is ` +
    `"Host" or "Guest". 8-16 turns, natural spoken style, grounded ONLY in the sources.\n\n${joinSources(sources)}\n\nJSON:`)
  const arr = extractJson<Array<{ speaker?: string; line?: string }>>(out) ?? []
  return arr
    .filter((t) => t && typeof t.line === 'string' && t.line.trim().length > 0)
    .map((t) => ({ speaker: t.speaker === 'Guest' ? 'Guest' : 'Host', line: t.line! }))
}
