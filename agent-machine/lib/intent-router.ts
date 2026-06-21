/**
 * intent-router — structured conversational routing (the "bring structure back"
 * layer). A fast, local, cue-based classifier maps each user turn to one of 22
 * intents (the conversational "primes"; the 23rd is the conversation's own
 * evolving objective), each carrying a PLAN: which model capability to use, which
 * retrieval strategy, and which slots to fill.
 *
 * Mined from the user's real Claude-conversation corpus, then named. No model call
 * — pure pattern scoring, so routing is instant even on a CPU box.
 *
 * Key design choices (fix the observed failures):
 *  - summarize_doc / qa_over_doc / research → 'vector-rag' (forced embedding
 *    retrieval of the relevant chunks) + 'general'/'research' model — NOT the
 *    coder, NOT the whole doc stuffed into context. Fast AND grounded.
 *  - code/compute/prove route to the right specialist only when the cue is real.
 */

export type Capability = 'reasoning' | 'code' | 'research' | 'general' | 'writing' | 'concierge' | 'continue' | 'ingest'
export type Retrieval = 'vector-rag' | 'web+vector' | 'kb' | 'episodic' | 'self-model' | 'memory-write' | 'status' | 'program-aided' | 'program-aided+barriers' | 'none'
// The builtin tools an intent is allowed to reach for (BUILTIN_TOOLS in server.ts).
export type Tool = 'read_file' | 'write_file' | 'list_directory' | 'code_execute' | 'web_search' | 'generate_image' | 'remember' | 'ocr'
// The product surface this intent belongs to — must match the UI's ActiveSurface
// union (lib/types/surface.ts) so the client can route to it. '' = stay put.
export type Surface = '' | 'code' | 'canvas' | 'artifacts' | 'notes' | 'projects' | 'govern' | 'evaluate' | 'operate' | 'holographme' | 'cowork' | 'computer'
// The specialist agent ("skill") that fulfills this intent. '' = concierge handles it.
export type Skill = '' | 'coding-agent' | 'research-agent' | 'analytics-agent' | 'writing-agent' | 'planning-agent' | 'governance-sentinel' | 'security-agent' | 'vision-agent' | 'memory-keeper'

export interface Intent { id: number; name: string; cues: RegExp; model: Capability; retrieval: Retrieval; slots: string[]; tools: Tool[]; surface: Surface; skill: Skill }
export interface IntentPlan { id: number; name: string; model: Capability; retrieval: Retrieval; slots: string[]; tools: Tool[]; surface: Surface; skill: Skill; score: number }

// The 22 intents (+ the 23rd pole = the live conversation objective). Cues are
// scored by match count; ties broken by specificity (longer/rarer cue wins).
const INTENTS: Intent[] = [
  { id: 0, name: 'build_implement', model: 'code', retrieval: 'kb', slots: ['target', 'requirements'], tools: ['write_file', 'code_execute', 'read_file'], surface: 'code', skill: 'coding-agent', cues: /\b(build|create|implement|add (a|an|the)|set up|develop|scaffold|stand up|wire (up|in)|(write|create|make|generate) (me )?(a |an |some )?(\w+ )?(function|script|program|class|method|module|cli|command|app|code|snippet|regex|algorithm|parser|query))\b/i },
  { id: 1, name: 'fix_debug', model: 'code', retrieval: 'kb', slots: ['symptom', 'location'], tools: ['read_file', 'code_execute', 'write_file'], surface: 'code', skill: 'coding-agent', cues: /\b(fix|broken|does ?n'?t work|not working|error|crash(ed|ing)?|bug|fail(s|ed|ing)?|stuck|hang(s|ing)?|busted)\b/i },
  { id: 2, name: 'research_lookup', model: 'research', retrieval: 'web+vector', slots: ['question', 'sources'], tools: ['web_search', 'read_file'], surface: 'canvas', skill: 'research-agent', cues: /\b(research|find out|look up|search for|who (is|was|discovered)|when did|latest|how much|what'?s the (price|salary|rate))\b/i },
  { id: 3, name: 'summarize_doc', model: 'general', retrieval: 'vector-rag', slots: ['doc', 'focus'], tools: ['read_file'], surface: 'artifacts', skill: 'writing-agent', cues: /\b(summari[sz]e|tl;?dr|key points|main points|overview of|the gist|brief me)\b/i },
  { id: 4, name: 'qa_over_doc', model: 'general', retrieval: 'vector-rag', slots: ['doc', 'questions'], tools: ['read_file'], surface: 'artifacts', skill: 'analytics-agent', cues: /\b(according to (the|this)|in the (doc|paper|report|file)|from the (attached|uploaded)|the document says|based on (the|this) (doc|paper|report))\b/i },
  { id: 5, name: 'explain_teach', model: 'reasoning', retrieval: 'kb', slots: ['topic', 'depth'], tools: ['web_search', 'read_file'], surface: 'notes', skill: 'planning-agent', cues: /\b(explain|how does|what does .* (mean|do)|teach me|walk me through|help me understand|why is it)\b/i },
  { id: 6, name: 'plan_nextsteps', model: 'reasoning', retrieval: 'episodic', slots: ['objective', 'horizon'], tools: [], surface: 'projects', skill: 'planning-agent', cues: /\b(what'?s next|next steps?|gaps?|move .* forward|road ?map|priorit|what'?s left|the plan|best next)\b/i },
  { id: 7, name: 'review_audit', model: 'reasoning', retrieval: 'kb', slots: ['target', 'criteria'], tools: ['read_file', 'code_execute'], surface: 'govern', skill: 'governance-sentinel', cues: /\b(review|audit|harden|assess|critique|go over|reassess|gaps assessment)\b/i },
  { id: 8, name: 'compare_benchmark', model: 'reasoning', retrieval: 'kb', slots: ['items', 'dimension'], tools: ['web_search'], surface: 'evaluate', skill: 'analytics-agent', cues: /\b(compare|vs\.?|versus|parity|benchmark|better than|superiority|difference between|on par)\b/i },
  { id: 9, name: 'self_identity', model: 'general', retrieval: 'self-model', slots: ['aspect'], tools: [], surface: 'holographme', skill: 'governance-sentinel', cues: /\b(your ?self|how do you work|what are you|your (construction|architecture|design|self|repos?|stack)|do you know yourself|who built you)\b/i },
  { id: 10, name: 'preferences_memory', model: 'general', retrieval: 'memory-write', slots: ['preference'], tools: ['remember'], surface: 'notes', skill: 'memory-keeper', cues: /\b(remember (this|that)|my preference|i prefer|don'?t (do|add|use|ever)|from now on|always (use|do)|never (use|do))\b/i },
  { id: 11, name: 'configure_ops', model: 'code', retrieval: 'kb', slots: ['target', 'env'], tools: ['code_execute', 'list_directory', 'write_file'], surface: 'operate', skill: 'security-agent', cues: /\b(install|set ?up|configure|provision|deploy|brew |npm |pip |docker|podman|build the app|reinstall|reboot)\b/i },
  { id: 12, name: 'file_ingest', model: 'ingest', retrieval: 'none', slots: ['path'], tools: ['read_file'], surface: 'artifacts', skill: 'writing-agent', cues: /\b((upload|ingest|attach|load|add)\s+(this\s+|the\s+|my\s+|a\s+|an\s+)?(file|doc|document|paper|pdf|report|attachment|spreadsheet)s?|drag\s+(and|&)\s+drop)\b/i },
  { id: 13, name: 'file_ops', model: 'code', retrieval: 'none', slots: ['path', 'operation'], tools: ['list_directory', 'read_file', 'write_file', 'ocr'], surface: 'operate', skill: 'coding-agent', cues: /\b(read the file|find (the )?files?|list (the )?files?|directory|folder|move (the )?file|in my (downloads|documents|desktop)|(read|extract|get) (the )?text (from|in)|what does (this|the) (image|screenshot|photo)|ocr)\b/i },
  { id: 14, name: 'status_check', model: 'general', retrieval: 'status', slots: ['component'], tools: [], surface: 'operate', skill: 'governance-sentinel', cues: /\b(is it (running|working|up|on)|status|does it work|did it (work|boot|build)|health|still (broke|busted|working))\b/i },
  { id: 15, name: 'code_review', model: 'code', retrieval: 'kb', slots: ['diff'], tools: ['read_file'], surface: 'code', skill: 'coding-agent', cues: /\b(review (this|my|the) (code|pr|diff|change)|code review|look at (this|my) (code|pr))\b/i },
  { id: 16, name: 'compute_math', model: 'reasoning', retrieval: 'program-aided', slots: ['expression'], tools: ['code_execute'], surface: 'canvas', skill: 'analytics-agent', cues: /\b(compute|calculate|evaluate|solve for|integral|derivative|determinant|probability of|what'?s \d)\b/i },
  { id: 17, name: 'prove_reason', model: 'reasoning', retrieval: 'program-aided+barriers', slots: ['claim'], tools: ['code_execute'], surface: 'canvas', skill: 'analytics-agent', cues: /\b(prove|derive|show that|is it true that|theorem|lower bound|why does .* hold)\b/i },
  { id: 18, name: 'write_draft', model: 'writing', retrieval: 'kb', slots: ['type', 'audience'], tools: ['write_file'], surface: 'notes', skill: 'writing-agent', cues: /\b(write (me|a|an)|draft (a|an|the)|compose|rewrite|reword|write up)\b/i },
  { id: 19, name: 'converse_smalltalk', model: 'concierge', retrieval: 'none', slots: [], tools: [], surface: '', skill: '', cues: /^(\s*)(hi|hey|hello|good (morning|evening|afternoon)|how are you|sup|yo)\b/i },
  { id: 20, name: 'confirm_steer', model: 'continue', retrieval: 'none', slots: [], tools: [], surface: '', skill: '', cues: /^(\s*)(yes|ok(ay)?|proceed|go( ahead)?|continue|do it|sure|lets? (go|do it|proceed))\b/i },
  { id: 21, name: 'meta_capability', model: 'general', retrieval: 'self-model', slots: [], tools: [], surface: 'holographme', skill: 'governance-sentinel', cues: /\b(what can you do|your capabilities|what are you capable|how can you help|what do you do)\b/i },
]

/** Classify a user turn into its intent plan. ctx.hasDoc routes ambiguous
 *  questions to qa_over_doc when a document is loaded (so questions ground on it).
 *  Pure pattern scoring — instant, no model. */
export function classifyIntent(text: string, ctx: { hasDoc?: boolean } = {}): IntentPlan {
  const t = text.trim()
  let best: Intent | null = null
  let bestScore = 0
  for (const it of INTENTS) {
    const m = t.match(it.cues)
    if (m) {
      // specificity: longer matched cue text scores higher than a 2-letter hit
      const score = 1 + Math.min(3, (m[0]?.trim().length ?? 0) / 6)
      if (score > bestScore) { bestScore = score; best = it }
    }
  }
  // Doc present + a question with no strong intent → answer over the doc (grounded).
  if (ctx.hasDoc && /\?/.test(t) && (!best || bestScore < 1.5) && !/^(\s*)(yes|ok|proceed|go|sure)\b/i.test(t)) {
    best = INTENTS[4]! ; bestScore = 1.5 // qa_over_doc
  }
  if (!best) { // default: general question, vector-grounded if a doc is around
    return ctx.hasDoc
      ? { id: 4, name: 'qa_over_doc', model: 'general', retrieval: 'vector-rag', slots: [], tools: ['read_file'], surface: 'artifacts', skill: 'analytics-agent', score: 0 }
      : { id: 21, name: 'general', model: 'general', retrieval: 'kb', slots: [], tools: ['read_file', 'web_search'], surface: '', skill: '', score: 0 }
  }
  return { id: best.id, name: best.name, model: best.model, retrieval: best.retrieval, slots: best.slots, tools: best.tools, surface: best.surface, skill: best.skill, score: Number(bestScore.toFixed(2)) }
}

/** Look up an intent definition by name (for the embedding classifier's label). */
export function intentByName(name: string): Intent | undefined {
  return INTENTS.find((i) => i.name === name)
}

/** Build an IntentPlan from an intent definition + a score (used when the Tier-0
 *  embedding classifier, not the regex cues, decided the intent). */
export function planFromIntent(it: Intent, score: number): IntentPlan {
  return { id: it.id, name: it.name, model: it.model, retrieval: it.retrieval, slots: it.slots, tools: it.tools, surface: it.surface, skill: it.skill, score: Number(score.toFixed(2)) }
}

/** Map an intent capability to the router TaskType used by ROUTING_TABLE. */
export function capabilityToTask(model: Capability): string {
  switch (model) {
    case 'code': return 'coding'
    case 'reasoning': return 'reasoning'
    case 'research': return 'research'
    case 'writing': return 'writing'
    case 'concierge': return 'chat'
    default: return 'general'
  }
}

/** Does this intent want document/vector grounding? */
export function wantsVectorRag(r: Retrieval): boolean { return r === 'vector-rag' || r === 'web+vector' }

/** Project an intent onto the 6-column action basis (or the meta/embedding row). This
 *  is the row→tangent-direction map: which fundamental operation the intent performs.
 *  The action's polarity then derives the route (read→interactive/faithful, write→
 *  deliberate/generative) — grounding model selection in the algebra. 'meta' = the +1
 *  embedding row (second-order: acts on other actions, not on a topic). */
export type Action = 'retrieve' | 'create' | 'evaluate' | 'transform' | 'sense' | 'execute' | 'meta'
const INTENT_ACTION: Record<string, Action> = {
  qa_over_doc: 'retrieve', research_lookup: 'retrieve', summarize_doc: 'retrieve', // read-first (extractive); falls to transform on miss
  self_identity: 'retrieve', meta_capability: 'retrieve', file_ops: 'retrieve',
  review_audit: 'evaluate', compare_benchmark: 'evaluate', code_review: 'evaluate', status_check: 'evaluate',
  build_implement: 'create', preferences_memory: 'create',
  fix_debug: 'transform', explain_teach: 'transform', write_draft: 'transform', compute_math: 'transform', prove_reason: 'transform',
  file_ingest: 'sense',
  configure_ops: 'execute',
  plan_nextsteps: 'meta', converse_smalltalk: 'meta', confirm_steer: 'meta',
}
export function intentToAction(name: string): Action { return INTENT_ACTION[name] ?? 'transform' }
