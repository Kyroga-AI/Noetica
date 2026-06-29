// Evaluator agent: separated-concerns QA that runs AFTER the generate→verify loop.
// Three passes in order:
//   1. Static scan — explicit stub/placeholder markers (fast, no model)
//   2. Contract test commands — each criterion's shell command is executed; binary pass/fail
//   3. Adversarial model review — grades against failing criteria specifically
//
// When a sprint contract is provided, the evaluator grades against it precisely.
// Without one it falls back to task-description heuristics (less accurate).

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SprintContract } from './sprint-contract.js'

export interface EvaluationDeps {
  generate: (prompt: string, temperature: number) => Promise<string>
  run: (command: string, cwd: string, timeoutMs: number) => Promise<{ out: string; err: string; code: string }>
}

export interface EvaluationResult {
  pass: boolean
  score: number             // 0–10 quality score
  findings: string[]        // concrete actionable gaps (each one sentence, maps to a criterion)
  suggestions: string[]     // nice-to-have improvements
  contractResults: Array<{ criterion: string; pass: boolean; output: string }>
  testedDynamically: boolean
}

// Only flag lines with explicit incompleteness markers — no regex noise on valid code.
const STUB_RE = /\b(TODO|FIXME|STUB|placeholder|not[- ]implemented|coming[- ]soon|lorem[- ]ipsum)\b/i

function staticScan(files: { path: string; content: string }[]): string[] {
  const issues: string[] = []
  for (const f of files) {
    f.content.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return
      if (STUB_RE.test(line)) {
        issues.push(`${f.path}:${i + 1} — incomplete: ${trimmed.slice(0, 100)}`)
      }
    })
  }
  return issues.slice(0, 6)
}

// Adversarial prompt: the evaluator's job is to find failures, not to rate.
// "Try to refute" framing prevents the rationalization failure mode from the articles.
const EVAL_SYS_WITH_CONTRACT = `You are an adversarial QA agent. Your job is to find FAILURES, not to rate.

You are given:
- A task specification
- The generated source files
- Contract test results (each criterion: PASS or FAIL with output)

For each FAILING criterion, write one concrete sentence explaining exactly what in the code causes it to fail.
For PASSING criteria, do NOT add findings — they are done.
Add findings for things you spot that are NOT in the contract but are clearly broken.

Findings must be falsifiable ("the onClick handler is empty on line 42", not "the UI needs work").
Suggestions are non-blocking improvements only.

Respond with ONLY valid JSON:
{"score":0-10,"findings":["..."],"suggestions":["..."]}`

const EVAL_SYS_NO_CONTRACT = `You are an adversarial QA agent. Your job is to find FAILURES, not to rate.

Given a task spec and the source files, find specific functional gaps — things the task requires that the code doesn't actually do.
Focus on: empty handlers, stubbed returns, missing wiring between frontend and backend, hardcoded fake data, unimplemented features.
Do NOT flag style issues. Every finding must be a falsifiable one-sentence claim.

Respond with ONLY valid JSON:
{"score":0-10,"findings":["..."],"suggestions":["..."]}`

function summariseFiles(files: { path: string; content: string }[]): string {
  const MAX = 2500
  return files
    .map((f) => `=== ${f.path} ===\n${f.content.slice(0, MAX)}${f.content.length > MAX ? '\n[truncated]' : ''}`)
    .join('\n\n')
}

/** Run all contract test commands and return per-criterion results. */
async function runContractTests(
  contract: SprintContract,
  ws: string,
  run: EvaluationDeps['run'],
): Promise<Array<{ criterion: string; pass: boolean; output: string }>> {
  const results: Array<{ criterion: string; pass: boolean; output: string }> = []
  for (let i = 0; i < contract.criteria.length; i++) {
    const cmd = contract.testCommands[i] ?? ''
    if (!cmd.trim()) {
      results.push({ criterion: contract.criteria[i], pass: false, output: '(no test command)' })
      continue
    }
    try {
      const { out, err, code } = await run(cmd, ws, 15_000)
      const output = `${out}${err ? `\nstderr: ${err}` : ''}`.trim().slice(0, 300)
      results.push({ criterion: contract.criteria[i], pass: code === '0', output })
    } catch {
      results.push({ criterion: contract.criteria[i], pass: false, output: 'command failed to run' })
    }
  }
  return results
}

/** Detect a runnable web app and return start command + port, or null. */
function detectWebApp(ws: string): { start: string; port: number } | null {
  const pkgPath = path.join(ws, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
      const scripts = (pkg.scripts ?? {}) as Record<string, string>
      if (scripts.dev) return { start: 'npm run dev', port: 3000 }
      if (scripts.start) return { start: 'npm start', port: 3000 }
    } catch { /* */ }
  }
  if (fs.existsSync(path.join(ws, 'main.py'))) return { start: 'python3 main.py', port: 8000 }
  if (fs.existsSync(path.join(ws, 'api', 'main.py'))) return { start: 'python3 api/main.py', port: 8000 }
  return null
}

export async function evaluateCode(
  task: string,
  ws: string,
  files: { path: string; content: string }[],
  verifyOutput: string,
  deps: EvaluationDeps,
  contract?: SprintContract,
): Promise<EvaluationResult> {
  // 1. Static scan — fast, no model
  const staticIssues = staticScan(files)

  // 2. Dynamic setup: start web server if present (best-effort, for contract test commands)
  let testedDynamically = false
  const webapp = detectWebApp(ws)
  let serverStarted = false
  if (webapp && contract?.testCommands.some((c) => c.includes('localhost') || c.includes('curl'))) {
    try {
      await deps.run(
        `${webapp.start} > /tmp/noetica-eval.log 2>&1 & sleep 4`,
        ws,
        10_000,
      )
      serverStarted = true
      testedDynamically = true
    } catch { /* best-effort */ }
  }

  // 3. Contract test commands — binary pass/fail per criterion
  const contractResults: Array<{ criterion: string; pass: boolean; output: string }> = []
  if (contract && contract.criteria.length > 0) {
    const results = await runContractTests(contract, ws, deps.run)
    contractResults.push(...results)
  }

  // Kill server after contract tests
  if (serverStarted && webapp) {
    await deps.run(`kill $(lsof -ti:${webapp.port}) 2>/dev/null; exit 0`, ws, 3_000).catch(() => {})
  }

  // 4. Adversarial model review — graded against specific failing criteria
  const fileSummary = summariseFiles(files)
  let modelResult: { score: number; findings: string[]; suggestions: string[] } = { score: 5, findings: [], suggestions: [] }

  try {
    let prompt: string
    if (contract && contractResults.length > 0) {
      const testResultsBlock = contractResults
        .map((r, i) => `${i + 1}. [${r.pass ? 'PASS' : 'FAIL'}] ${r.criterion}${r.output ? `\n   output: ${r.output}` : ''}`)
        .join('\n')
      prompt = `${EVAL_SYS_WITH_CONTRACT}\n\nTask: ${task}\n\nContract test results:\n${testResultsBlock}\n\nVerify output: ${verifyOutput.slice(0, 300)}\n\nFiles:\n${fileSummary}`
    } else {
      prompt = `${EVAL_SYS_NO_CONTRACT}\n\nTask: ${task}\n\nVerify output: ${verifyOutput.slice(0, 300)}\n\nFiles:\n${fileSummary}`
    }

    const raw = await deps.generate(prompt, 0.1)
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { score?: unknown; findings?: unknown; suggestions?: unknown }
      modelResult = {
        score: Math.min(10, Math.max(0, Number(parsed.score ?? 5))),
        findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).slice(0, 10) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 4) : [],
      }
    }
  } catch { /* use defaults */ }

  // Merge: static issues + model findings. Contract failures are authoritative — if a
  // contract criterion failed, that finding supersedes any model finding about the same thing.
  const contractFailFindings = contractResults
    .filter((r) => !r.pass)
    .map((r) => `Contract criterion NOT met: "${r.criterion}"${r.output ? ` (${r.output.slice(0, 120)})` : ''}`)

  const allFindings = [...staticIssues, ...contractFailFindings, ...modelResult.findings]
  const contractsPassed = contractResults.length === 0 || contractResults.every((r) => r.pass)

  return {
    pass: allFindings.length === 0 && modelResult.score >= 7 && contractsPassed,
    score: modelResult.score,
    findings: allFindings,
    suggestions: modelResult.suggestions,
    contractResults,
    testedDynamically,
  }
}
