/**
 * exec-verify — verification by EXECUTION, the strong form of test-time compute.
 *
 * The critic's self-consistency (majority vote) is weak: it can't fix a systematically
 * wrong model and can outvote a correct-but-minority answer. For VERIFIABLE postures
 * (compute, code) the right move is to RUN the computation and trust what executes —
 * deterministic, not popular. This is "program-of-thought": translate the problem into
 * a short program, execute it, and treat the executed result as the verified answer.
 *
 * Pure + dependency-injected (generate / execute are passed in) so it's unit-testable
 * with fakes; the server wires the real Ollama generator + sandboxed code executor.
 */

const FENCE_RE = /```(?:python|py)?\s*([\s\S]*?)```/i

/** Pull the first fenced (or bare) code block out of a model reply. */
export function extractCode(text: string): string | null {
  const m = text.match(FENCE_RE)
  if (m && m[1] && m[1].trim()) return m[1].trim()
  // No fence — accept the whole thing only if it looks like code (has print/assignment).
  if (/\bprint\s*\(/.test(text) || /^[a-z_]\w*\s*=/im.test(text)) return text.trim()
  return null
}

/** The verified answer is what the program printed last — its final non-empty line. */
export function extractFinalAnswer(output: string): string | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    // drop noise the sandbox prepends (exit codes, chart markers, headers)
    .filter((l) => !/^\[(chart|workspace|exit)/i.test(l) && !/^exit:/i.test(l) && !/^\$/.test(l))
  if (lines.length === 0) return null
  return lines[lines.length - 1]!.slice(0, 200)
}

/** Normalize a numeric-ish answer for comparison ("1,234.0" ≈ "1234"). */
export function normalizeAnswer(s: string): string {
  const num = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (num) { const n = Number(num[0]); if (isFinite(n)) return String(n) }
  return s.toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 60)
}

export interface ExecVerifyDeps {
  /** Generate text from the local model (temperature low for determinism). */
  generate: (prompt: string, temperature: number) => Promise<string>
  /** Run code in the sandbox; returns combined stdout text. */
  execute: (language: 'python' | 'javascript', code: string) => Promise<string>
}

export interface ProgramOfThought {
  answer: string        // the executed (verified) final answer
  code: string          // the program that produced it
  output: string        // raw execution output
}

const POT_PROMPT = (question: string) =>
  `You are a precise calculator. Write a short, correct Python 3 program that computes the answer to the problem below and prints ONLY the final answer on the last line (a bare number when the answer is numeric — no words, no units).\n\nProblem: ${question}\n\nReturn only the Python program in a single \`\`\`python code block.`

/**
 * Program-of-thought verification: ask the model for a program, execute it, return the
 * verified answer. Returns null when no runnable program or no usable output is produced
 * (caller falls back to the natural-language candidates).
 */
export async function programOfThought(question: string, deps: ExecVerifyDeps): Promise<ProgramOfThought | null> {
  let text: string
  try { text = await deps.generate(POT_PROMPT(question), 0.1) } catch { return null }
  const code = extractCode(text)
  if (!code) return null
  let output: string
  try { output = await deps.execute('python', code) } catch { return null }
  const answer = extractFinalAnswer(output)
  if (!answer) return null
  // Reject obvious execution failures surfaced in the output.
  if (/\b(Traceback|SyntaxError|NameError|Error:)\b/.test(output) && !/^-?\d/.test(answer)) return null
  return { answer, code, output }
}

// ── Code-posture verify-repair ────────────────────────────────────────────────
// For "write code" tasks, the verifier is execution against tests. We ask the model
// for a self-contained solution PLUS assert-based tests, run them, and repair on
// failure — keeping the candidate that actually passes. This is the out-loop coding
// lever: a small model + a real test loop beats a bigger model one-shot, because code
// is verifiable. Scope: self-contained Python/JS the sandbox can run (algorithmic /
// scripting). Repo-scale multi-file edits in unrunnable languages abstain (→ null).

const PASS_MARKER = 'ALL_TESTS_PASSED'
const ERR_RE = /\b(Traceback|SyntaxError|NameError|TypeError|AssertionError|ReferenceError|Error:|FAILED)\b/

/** Choose a sandbox-runnable language, or null to abstain (unrunnable → normal path). */
export function pickRunnableLanguage(question: string): 'python' | 'javascript' | null {
  const q = question.toLowerCase()
  if (/\b(typescript|\bts\b|rust|golang|\bgo\b|c\+\+|\bjava\b|\bc#\b|kotlin|swift|sql|bash|shell)\b/.test(q)) return null
  if (/\b(javascript|\bjs\b|node|typescript|react|typescript)\b/.test(q)) return 'javascript'
  return 'python'
}

/** Did the executed solution+tests pass? Marker present AND no error/failure in output. */
export function testsPassed(output: string): boolean {
  return output.includes(PASS_MARKER) && !ERR_RE.test(output.replace(PASS_MARKER, ''))
}

const codeVerifyPrompt = (question: string, lang: 'python' | 'javascript', priorFailure?: string) => {
  const printPass = lang === 'python' ? `print("${PASS_MARKER}")` : `console.log("${PASS_MARKER}")`
  const testStyle = lang === 'python' ? 'assert-based tests' : 'console.assert / throw-based tests'
  return `${question}\n\nWrite a complete, self-contained ${lang} solution, then 3–6 ${testStyle} that exercise it (including edge cases). Everything must run top-to-bottom; on success print exactly ${printPass} on the last line. ${priorFailure ? `\n\nYour previous attempt FAILED with:\n${priorFailure}\n\nFix the bug and return a corrected version.` : ''}\nReturn ONLY one \`\`\`${lang} code block.`
}

export interface CodeVerifyResult {
  solution: string
  language: 'python' | 'javascript'
  output: string
  passed: boolean
  attempts: number
}

/** Generate → run tests → repair, up to maxRepairs extra rounds. Returns the passing
 *  solution, or the best failing attempt, or null if no runnable code was produced. */
export async function codeVerifyRepair(question: string, deps: ExecVerifyDeps, maxRepairs = 1): Promise<CodeVerifyResult | null> {
  const language = pickRunnableLanguage(question)
  if (!language) return null
  let prior: string | undefined
  let last: { code: string; output: string } | null = null
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    let text: string
    try { text = await deps.generate(codeVerifyPrompt(question, language, prior), attempt === 0 ? 0.2 : 0.45) } catch { break }
    const code = extractCode(text)
    if (!code) continue
    let output: string
    try { output = await deps.execute(language, code) } catch { output = 'execution failed to run' }
    last = { code, output }
    if (testsPassed(output)) return { solution: code, language, output, passed: true, attempts: attempt + 1 }
    prior = output.slice(-700)
  }
  if (last) return { solution: last.code, language, output: last.output, passed: false, attempts: maxRepairs + 1 }
  return null
}

/** Does a natural-language candidate's final answer match the verified one? */
export function candidateAgreesWithVerified(candidate: string, verified: string): boolean {
  const v = normalizeAnswer(verified)
  // Look at the candidate's last number / last line for its claimed answer.
  const nums = candidate.replace(/,/g, '').match(/-?\d+(\.\d+)?/g)
  if (nums && /^-?\d/.test(v)) return nums.some((n) => normalizeAnswer(n) === v)
  return normalizeAnswer(candidate.split(/\r?\n/).pop() ?? '').includes(v)
}
