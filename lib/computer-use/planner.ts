// Agent S-style hierarchical planner.
// Manager decomposes the user goal into an ordered subtask list;
// the worker loop executes each subtask with its own computer-use session.

export interface SubTask {
  id: string
  title: string           // short human-readable label, e.g. "Open Calculator"
  instruction: string     // detailed instruction for the worker agent
  appContext: string      // likely app: "Safari", "Finder", "TextEdit", etc.
  webSearchQuery?: string // search query to fetch UI instructions for this step
  done: boolean
  failed: boolean
  summary?: string        // what actually happened
}

export interface Plan {
  goal: string
  subTasks: SubTask[]
  reasoning: string
  createdAt: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL    = 'https://api.openai.com/v1/chat/completions'

const PLANNER_SYSTEM = `You are a computer use task planner. Given a high-level goal, decompose it into an ordered list of sub-tasks that a computer-use agent can execute step-by-step.

For each sub-task provide:
- title: short action label (< 10 words)
- instruction: detailed step-by-step instruction for the agent
- appContext: the macOS application most likely involved (e.g. "Safari", "Finder", "TextEdit", "System Preferences", "Terminal")
- webSearchQuery: (optional) a web search query to find UI instructions, e.g. "how to open new tab Safari macOS"

Rules:
- Break complex goals into 2-8 concrete sub-tasks
- Each sub-task should be completeable in ≤ 10 UI actions
- Be specific about which app to use
- If the goal is already simple (single app, clear action), return 1 sub-task

Respond with JSON only: { "reasoning": "...", "subTasks": [ { "title": "...", "instruction": "...", "appContext": "...", "webSearchQuery": "..." }, ... ] }`

export async function planGoal(
  goal: string,
  apiKey: string,
  provider: 'anthropic' | 'openai',
  modelId: string,
  relevantMemory: string
): Promise<Plan> {
  const userContent = relevantMemory
    ? `Goal: ${goal}\n\nRelevant past experience:\n${relevantMemory}`
    : `Goal: ${goal}`

  let planJson: { reasoning: string; subTasks: Array<{ title: string; instruction: string; appContext: string; webSearchQuery?: string }> }

  if (provider === 'anthropic') {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        system: PLANNER_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
    const data = await res.json() as { content: Array<{ type: string; text?: string }> }
    const text = data.content.find((b) => b.type === 'text')?.text ?? '{}'
    planJson = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''))
  } else {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    planJson = JSON.parse(data.choices[0].message.content)
  }

  return {
    goal,
    reasoning: planJson.reasoning ?? '',
    createdAt: new Date().toISOString(),
    // planJson comes from parsing the model's JSON response — a malformed or
    // missing entry (e.g. null, or a step with no title) must not crash the
    // renderer downstream, so drop anything that isn't a usable step.
    subTasks: (planJson.subTasks ?? [])
      .filter((t): t is NonNullable<typeof t> => !!t && typeof t.title === 'string' && t.title.length > 0)
      .map((t) => ({
        id: crypto.randomUUID(),
        title: t.title,
        instruction: t.instruction ?? '',
        appContext: t.appContext ?? 'unknown',
        webSearchQuery: t.webSearchQuery,
        done: false,
        failed: false,
      })),
  }
}

// Fetch UI hints from the web (via DuckDuckGo instant answer API — no key required).
export async function fetchUiHints(query: string): Promise<string> {
  if (!query.trim()) return ''
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`
    const res = await fetch(url)
    const data = await res.json() as { AbstractText?: string; RelatedTopics?: Array<{ Text?: string }> }
    const parts = [
      data.AbstractText,
      ...(data.RelatedTopics ?? []).slice(0, 2).map((t) => t.Text),
    ].filter(Boolean)
    return parts.join('\n').slice(0, 500)
  } catch {
    return ''
  }
}
