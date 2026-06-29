// Sprint contract: generates binary pass/fail criteria + shell test commands BEFORE
// the coding loop starts. The generator receives the criteria so it knows what "done"
// means; the evaluator grades against them precisely. This is what separates principled
// evaluation from vibes — every finding maps to a specific broken contract item.

export interface SprintContract {
  criteria: string[]      // human-readable binary requirements ("login form submits to /api/auth")
  testCommands: string[]  // shell commands that exit 0 when criterion passes, non-zero when it fails
}

export type ContractGenerateFn = (prompt: string, temperature: number) => Promise<string>

const CONTRACT_SYS = `You are a technical QA architect. Given a task, produce a sprint contract:
- criteria: specific binary requirements. Each must be falsifiable ("login button POSTs to /api/auth", not "good UX").
- testCommands: one shell command per criterion that exits 0 when the criterion passes.
  Commands may use: curl, node -e, python3 -c, cat, grep, jq, ls, test.
  They run in the workspace directory AFTER the server has started (if applicable).
  Prefer file-content checks for pure logic tasks; API checks for server tasks.
  Example criterion: "users endpoint returns 200 with list"
  Example command:   "curl -sf http://localhost:8000/api/users | python3 -c \\"import sys,json; assert isinstance(json.load(sys.stdin),list)\\""

Generate 4–8 criteria. Return ONLY valid JSON, no markdown:
{"criteria":["..."],"testCommands":["..."]}`

/** Generate a sprint contract for a task. Falls back to an empty contract on error (non-blocking). */
export async function generateContract(
  task: string,
  generate: ContractGenerateFn,
): Promise<SprintContract> {
  const empty: SprintContract = { criteria: [], testCommands: [] }
  try {
    const raw = await generate(`${CONTRACT_SYS}\n\nTask: ${task}`, 0.15)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return empty
    const parsed = JSON.parse(match[0]) as { criteria?: unknown; testCommands?: unknown }
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria.map(String).slice(0, 10) : []
    const testCommands = Array.isArray(parsed.testCommands) ? parsed.testCommands.map(String).slice(0, 10) : []
    // Align arrays — pad shorter side with empty strings so indices stay in sync
    while (testCommands.length < criteria.length) testCommands.push('')
    return { criteria, testCommands: testCommands.slice(0, criteria.length) }
  } catch {
    return empty
  }
}

/** Format contract criteria as a numbered block for system prompts. */
export function contractBlock(contract: SprintContract): string {
  if (!contract.criteria.length) return ''
  return `\n\nSUCCESS CRITERIA — your solution must satisfy ALL of these:\n${contract.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
}
