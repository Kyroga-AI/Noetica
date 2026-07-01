/**
 * narration — the concierge's announcer voice. Turns the structured routing/grounding
 * decisions into plain, first-person narration of WHAT it's doing and WHY at each
 * stage: which model, for what purpose, why it's escalating. The user sees the agent
 * reason about its own execution and feels the progress — and the voice surface can
 * speak these lines verbatim. Templated (no model call), so it's instant.
 */

// Friendly, tier-aware label for a model — what the user hears, not the raw id.
export function modelLabel(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('extractive')) return 'document extractor'
  if (m.includes('llama3.2:3b') || m.includes('3b')) return 'fast local model'
  if (m.includes('coder')) return 'code model'
  if (m.includes('deepseek-r1') || m.includes('r1')) return 'reasoning model'
  if (m.includes('qwen2.5:14b') || m.includes('14b')) return 'large local model'
  if (m.includes('qwen2.5:7b') || m.includes('7b')) return 'balanced local model'
  if (m.includes('claude') && m.includes('sonnet')) return 'cloud reasoning model (Claude)'
  if (m.includes('claude')) return 'fast cloud model (Claude)'
  if (m.includes('gpt-5') || m.includes('gpt-4')) return 'cloud model (GPT)'
  return model
}

// What the user is trying to get done — the PURPOSE, phrased as an action.
const PURPOSE: Record<string, string> = {
  plan_nextsteps: 'map out the next steps and gaps',
  build_implement: 'build this',
  fix_debug: 'track down what is going wrong',
  research_lookup: 'research this',
  summarize_doc: 'summarize the document',
  qa_over_doc: 'answer from your document',
  explain_teach: 'explain this clearly',
  review_audit: 'review this',
  compare_benchmark: 'compare these',
  compute_math: 'work this out',
  prove_reason: 'reason this through',
  write_draft: 'draft this',
  code_review: 'review the code',
  configure_ops: 'set this up',
  file_ops: 'work with your files',
  status_check: 'check the status',
  self_identity: 'tell you about myself',
  preferences_memory: 'note your preference',
  meta_capability: 'show what I can do',
  converse_smalltalk: 'chat',
}
export function purposeFor(intent: string): string {
  return PURPOSE[intent] ?? 'work on this'
}

export type NarrationStage = 'route' | 'escalate' | 'retrieve' | 'extract' | 'generate' | 'dispatch' | 'working' | 'adapt'
export interface Narration { stage: NarrationStage; text: string; model?: string; purpose?: string }

/** Heartbeat for a slow stage — the "not frozen" signal. The single most important
 *  line: it tells the user the agent is alive and working, just taking its time. */
export function narrateWorking(model: string): Narration {
  return { stage: 'working', text: `Still working — running on the ${modelLabel(model)} locally, so give it a moment. Not stuck.`, model }
}

/** When the chosen path doesn't fit and the agent switches — narrate the adjustment,
 *  not just the destination, so the user follows the reasoning. */
export function narrateAdapt(text: string): Narration {
  return { stage: 'adapt', text }
}

/** "Using the fast local model to answer from your document." */
export function narrateRoute(model: string, intent: string, opts: { fast?: boolean; concierge?: boolean } = {}): Narration {
  const label = modelLabel(model)
  const purpose = purposeFor(intent)
  const text = opts.concierge
    ? `Handling this myself on the ${label} — quick and local.`
    : opts.fast
      ? `Using the ${label} to ${purpose} — keeping it responsive.`
      : `Using the ${label} to ${purpose}.`
  return { stage: 'route', text, model, purpose }
}

/** "This needs more depth — bringing in the reasoning model to map out the plan." */
export function narrateEscalation(model: string, intent: string, reason: string): Narration {
  const label = modelLabel(model)
  const why = reason.includes('confidence') ? "I want to be sure I've got this right"
    : reason.includes('unresolved') ? "we've gone a couple of rounds, so let me bring more to bear"
      : 'this needs more depth'
  return { stage: 'escalate', text: `${why[0]!.toUpperCase()}${why.slice(1)} — bringing in the ${label} to ${purposeFor(intent)}.`, model, purpose: purposeFor(intent) }
}

/** "Pulling the 4 most relevant passages from your document." */
export function narrateRetrieve(passages: number): Narration {
  return { stage: 'retrieve', text: passages > 0
    ? `Pulling the ${passages} most relevant passage${passages === 1 ? '' : 's'} from your document.`
    : `Gathering what I already know that's relevant.` }
}

/** "Answering straight from the document's own words, cited — nothing invented." */
export function narrateExtract(): Narration {
  return { stage: 'extract', text: `Answering straight from the document's own words and citing them — so nothing is invented.` }
}

/** "Composing the answer with the balanced local model." */
export function narrateGenerate(model: string): Narration {
  return { stage: 'generate', text: `Composing the answer with the ${modelLabel(model)}.`, model }
}

/** "Kicking off the research in the background — I'll bring it back when it's ready." */
export function narrateDispatch(capability: string): Narration {
  const what = capability === 'research' ? 'research' : capability === 'reasoning' ? 'planning' : capability === 'code' ? 'the build' : 'the work'
  return { stage: 'dispatch', text: `Kicking off ${what} in the background — I'll bring it back when it's ready.` }
}
