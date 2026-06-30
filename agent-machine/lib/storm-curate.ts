/**
 * storm-curate — multi-perspective knowledge curation (STORM algorithm).
 *
 * Workspace/one's leap over Notion is graph-native knowledge: you ask for an article and the system
 * researches and writes it from your own corpus. STORM (Stanford, "Synthesis of Topic Outlines through
 * Retrieval and multi-perspective question-asking") is the strongest open recipe for that pre-writing
 * stage. Instead of one model dumping what it half-remembers, STORM:
 *
 *   1. discovers several DISTINCT PERSPECTIVES on the topic (a historian vs an engineer vs a critic ask
 *      different questions),
 *   2. for each perspective runs a short simulated interview — a writer asks, an "expert" answers GROUNDED
 *      in retrieved snippets, and follow-ups dig into gaps,
 *   3. synthesizes the collected Q&A into a hierarchical OUTLINE the article is then written against.
 *
 * The win is coverage: multi-perspective questioning surfaces sub-topics a single pass never asks about,
 * and every answer is retrieval-grounded so the outline is anchored to the corpus, not the model's prior.
 *
 * This module is the orchestration layer only. The LLM and the retriever are INJECTED (`runner`,
 * `retrieve`) so it composes with whatever lane the caller routes through (local OllamaProvider, the
 * sovereign lane, etc.) and so it is unit-testable with stubs — no network dependency lives here.
 */

/** LLM closure: a prompt in, completion text out. */
export type Runner = (prompt: string) => Promise<string>
/** Retrieval closure: a query in, grounding snippets out. */
export type Retrieve = (query: string, k: number) => Promise<string[]> | string[]

export interface QAPair {
  perspective: string
  question: string
  answer: string
  /** Snippets the answer was grounded in. */
  citations: string[]
}

export interface OutlineNode {
  heading: string
  children: OutlineNode[]
}

export interface KnowledgeCuration {
  topic: string
  perspectives: string[]
  conversations: QAPair[]
  outline: OutlineNode[]
}

export interface StormOptions {
  runner: Runner
  retrieve: Retrieve
  /** Number of distinct perspectives to discover. */
  perspectives?: number
  /** Question rounds per perspective (the interview depth). */
  rounds?: number
  /** Snippets retrieved per question. */
  retrieveK?: number
}

/** Parse a model list response into clean lines (strips bullets / numbering / blank lines). */
function parseList(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0 && !/^(?:here|the following|perspectives?|questions?)\b.*:$/i.test(l))
}

/** Step 1 — discover distinct perspectives on the topic. */
export async function discoverPerspectives(topic: string, runner: Runner, n: number): Promise<string[]> {
  const raw = await runner(
    `Topic: "${topic}".\nList ${n} DISTINCT perspectives or stakeholder roles that would each research this ` +
    `topic differently (e.g. a historian, a practitioner, a skeptic). One per line, no commentary.`,
  )
  const list = parseList(raw).slice(0, n)
  return list.length ? list : ['general overview']
}

/**
 * Step 2 — simulate one perspective's interview: ask a question, answer it grounded in retrieval,
 * then ask a follow-up that targets what's still missing. Returns the Q&A trail.
 */
export async function interview(
  topic: string,
  perspective: string,
  opts: { runner: Runner; retrieve: Retrieve; rounds: number; retrieveK: number },
): Promise<QAPair[]> {
  const trail: QAPair[] = []
  let lastQuestion = ''
  for (let round = 0; round < opts.rounds; round++) {
    const askPrompt = round === 0
      ? `As a ${perspective}, ask the single most important question to understand "${topic}". Output only the question.`
      : `As a ${perspective} researching "${topic}", you already asked: "${lastQuestion}".\n` +
        `Ask ONE follow-up question that digs into a gap not yet covered. Output only the question.`
    const question = (await opts.runner(askPrompt)).trim().split('\n')[0]!.trim()
    if (!question) break

    const citations = await opts.retrieve(question, opts.retrieveK)
    const context = (citations as string[]).map((c, i) => `[${i + 1}] ${c}`).join('\n')
    const answer = (await opts.runner(
      `Answer the question using ONLY the sources. If the sources don't cover it, say so briefly.\n` +
      `Question: ${question}\nSources:\n${context || '(none)'}\nAnswer:`,
    )).trim()

    trail.push({ perspective, question, answer, citations: citations as string[] })
    lastQuestion = question
  }
  return trail
}

/** Step 3 — synthesize the collected Q&A into a two-level outline. */
export async function synthesizeOutline(topic: string, conversations: QAPair[], runner: Runner): Promise<OutlineNode[]> {
  const digest = conversations
    .map((c) => `(${c.perspective}) Q: ${c.question}\nA: ${c.answer}`)
    .join('\n\n')
  const raw = await runner(
    `Topic: "${topic}".\nUsing the research below, produce a hierarchical article outline.\n` +
    `Use "# Section" for top-level sections and "## Subsection" for subsections. Headings only, no prose.\n\n${digest}`,
  )
  return parseOutline(raw)
}

/** Parse a markdown-ish "# / ##" heading list into a two-level outline tree. */
export function parseOutline(raw: string): OutlineNode[] {
  const roots: OutlineNode[] = []
  let current: OutlineNode | null = null
  for (const line of raw.split('\n')) {
    const h2 = line.match(/^\s*##\s+(.*\S)/)
    const h1 = line.match(/^\s*#\s+(.*\S)/)
    if (h2 && current) {
      current.children.push({ heading: h2[1]!.trim(), children: [] })
    } else if (h1) {
      current = { heading: h1[1]!.trim(), children: [] }
      roots.push(current)
    } else {
      // Tolerate bullet/numbered top-level headings when the model ignores the # convention.
      const bullet = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
      if (bullet && line.match(/^\s*(?:[-*•]|\d+[.)])/)) {
        current = { heading: bullet, children: [] }
        roots.push(current)
      }
    }
  }
  return roots
}

/**
 * Run the full STORM pre-writing pipeline for `topic`: discover perspectives → interview each →
 * synthesize an outline. Returns the curated knowledge package ready for section-by-section writing.
 */
export async function runStorm(topic: string, opts: StormOptions): Promise<KnowledgeCuration> {
  const perspectives = await discoverPerspectives(topic, opts.runner, opts.perspectives ?? 3)
  const rounds = opts.rounds ?? 2
  const retrieveK = opts.retrieveK ?? 3

  const conversations: QAPair[] = []
  for (const perspective of perspectives) {
    const trail = await interview(topic, perspective, { runner: opts.runner, retrieve: opts.retrieve, rounds, retrieveK })
    conversations.push(...trail)
  }

  const outline = await synthesizeOutline(topic, conversations, opts.runner)
  return { topic, perspectives, conversations, outline }
}
