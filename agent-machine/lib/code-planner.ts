// code-planner.ts — the first agent in the 3-agent architecture.
// Expands a terse task into a structured plan: tech stack + ordered feature list with
// explicit dependency edges. The generator sees the plan so it knows what to build before
// it writes a line of code. Without a planner, the generator re-derives architecture on
// every attempt; with one, it inherits a stable skeleton that doesn't shift under repair.

export interface CodeFeature {
  id: number
  name: string           // short name ("user auth", "dashboard charts")
  description: string    // full implementation spec for just this feature
  depends: number[]      // IDs of features this one builds on
  testHint: string       // how to verify this feature in isolation
}

export interface CodePlan {
  title: string
  techStack: string          // "React 18 + FastAPI + SQLite"
  setupCommands: string[]    // shell commands to run once before coding (npm init, pip install, etc.)
  features: CodeFeature[]
  aiFeatures: string[]       // AI-specific capabilities to weave in (optional, used by generator prompt)
}

export type PlanGenerateFn = (prompt: string, temperature: number) => Promise<string>

const PLANNER_SYS = `You are a technical product manager and software architect. Given a task description, produce a structured implementation plan.

Rules:
- features must be ordered from foundation to product (infra before UI, data model before endpoints, etc.)
- each feature must be small enough to implement in one focused coding session (~200-400 lines)
- depends[] must only reference IDs of features that appear earlier in the list
- setupCommands are one-time shell commands (npm init, pip install, git init); do NOT include build or run commands
- techStack must be concise: "React + FastAPI + SQLite", not a paragraph
- aiFeatures is optional — only include if the task genuinely calls for AI (NLP, generation, RAG, etc.)

Respond with ONLY valid JSON (no markdown):
{
  "title": "short descriptive title",
  "techStack": "...",
  "setupCommands": ["npm init -y", "pip install fastapi uvicorn"],
  "features": [
    {"id": 1, "name": "data model", "description": "...", "depends": [], "testHint": "..."},
    {"id": 2, "name": "REST API", "description": "...", "depends": [1], "testHint": "..."}
  ],
  "aiFeatures": ["semantic search", "summarisation"]
}`

/** Detect whether a task is complex enough to warrant full feature decomposition. */
export function isComplexTask(task: string): boolean {
  const t = task.toLowerCase()
  if (task.length > 120) return true
  return /\b(app|application|dashboard|system|platform|full.?stack|multi.?page|crud|rest api|web|saas|tool|suite)\b/.test(t)
}

/** Expand a task into a structured plan. Falls back to a minimal single-feature plan on error. */
export async function planTask(task: string, generate: PlanGenerateFn): Promise<CodePlan> {
  const fallback: CodePlan = {
    title: task.slice(0, 60),
    techStack: 'python3',
    setupCommands: [],
    features: [{ id: 1, name: 'core', description: task, depends: [], testHint: 'run the verify command' }],
    aiFeatures: [],
  }
  try {
    const raw = await generate(`${PLANNER_SYS}\n\nTask: ${task}`, 0.2)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    const parsed = JSON.parse(match[0]) as Partial<CodePlan>
    const features: CodeFeature[] = Array.isArray(parsed.features)
      ? parsed.features
          .map((f) => ({
            id: Number(f.id ?? 0),
            name: String(f.name ?? ''),
            description: String(f.description ?? ''),
            depends: Array.isArray(f.depends) ? f.depends.map(Number) : [],
            testHint: String(f.testHint ?? ''),
          }))
          .filter((f) => f.id > 0 && f.name)
          .slice(0, 12)
      : fallback.features
    if (!features.length) return fallback
    return {
      title: String(parsed.title ?? task.slice(0, 60)),
      techStack: String(parsed.techStack ?? 'python3'),
      setupCommands: Array.isArray(parsed.setupCommands) ? parsed.setupCommands.map(String).slice(0, 6) : [],
      features,
      aiFeatures: Array.isArray(parsed.aiFeatures) ? parsed.aiFeatures.map(String).slice(0, 4) : [],
    }
  } catch {
    return fallback
  }
}

/** Format a feature for injection into a generator system prompt. */
export function featurePromptBlock(feature: CodeFeature, plan: CodePlan, completedFeatures: CodeFeature[]): string {
  const priorWork = completedFeatures.length > 0
    ? `\n\nALREADY IMPLEMENTED (do not re-implement, just build on top):\n${completedFeatures.map((f) => `- ${f.name}: ${f.description.slice(0, 120)}`).join('\n')}`
    : ''
  return `Tech stack: ${plan.techStack}\n\nImplement feature: ${feature.name}\n${feature.description}${priorWork}\n\nVerification hint: ${feature.testHint}`
}
