/**
 * teacher-critique.ts — the AgentKB student→teacher Reason-Retrieve-Refine loop (×N).
 *
 * council.ts votes on ANSWERS; no arm ever reads another arm's reasoning STEPS and corrects them. AgentKB's
 * second contribution is exactly that: a stronger "teacher" reads the student's TRAJECTORY (not just its final
 * answer), retrieves its own micro-experiences over the verified-experience store, and emits a corrective
 * refinement. The student revises; repeat, bounded, until it converges.
 *
 * This module is the pure ORCHESTRATION — the LLM call and the experience retrieval are INJECTED (same pattern
 * as synapseiq-enrich / auto-kg), so the loop is deterministic and fully testable offline, and the production
 * wiring (council arm / reason-lane + the gated experience store) drops in without touching the control flow.
 *
 * On-thesis guards:
 *   • The teacher retrieves over the GATED experience store (procedural-memory.retrieveExperiences) — verified
 *     reasoning paths, not raw trajectory mimicry. Garbage critique can't enter from unverified memory.
 *   • Bounded rounds + convergence: a refinement that does not change the answer means the teacher had nothing
 *     to add → stop (no runaway ×N cost). maxRounds caps the worst case.
 *   • Every round is returned as a structured record so the caller can emit it onto the reasoning-evidence
 *     fabric (one ReasoningEvent per round) — the refinement itself is governed and replayable.
 */

/** What the student produced: the task, the reasoning path it took, and its answer. */
export interface StudentTrajectory {
  task: string
  steps: string[]      // the student's reasoning-event summaries, in order
  answer: string
}

/** One teacher pass: critique of the student's path + the revised answer it argues for. */
export interface TeacherCritique {
  critique: string         // what the student missed / should attend to (short)
  revisedAnswer: string    // the teacher's corrected answer (may equal the input → nothing to change)
}

export interface RefineRound {
  round: number
  retrieved: string[]      // micro-experiences the teacher retrieved this round (safe-trace summaries)
  critique: string
  answerBefore: string
  answerAfter: string
  changed: boolean
}

export interface RefineResult {
  finalAnswer: string
  rounds: RefineRound[]
  converged: boolean       // true if it settled before hitting maxRounds
  reason: string
}

export interface RefineDeps {
  /** Retrieve micro-experiences for a task (top-k summaries). Back this with the GATED experience store. */
  retrieve: (task: string, k: number) => Promise<string[]> | string[]
  /** The teacher LLM pass: given the trajectory + retrieved experiences, critique and revise. */
  critique: (trajectory: StudentTrajectory, retrieved: string[]) => Promise<TeacherCritique> | TeacherCritique
}

export interface RefineOpts { maxRounds?: number; retrieveK?: number }

/** Normalize an answer for convergence comparison (whitespace/case/punctuation-insensitive). For MCQ this
 *  collapses to the bare letter; for free-form it tolerates trivial rewording. */
function normAnswer(a: string): string {
  return String(a ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Run the bounded student→teacher Reason-Retrieve-Refine loop. The teacher retrieves over the verified-experience
 * store, critiques the student's trajectory, and proposes a revision; we accept it and feed the revised answer
 * back as the next round's student answer. Stops when a round leaves the answer UNCHANGED (converged) or after
 * maxRounds. Pure control flow — all generation/retrieval is in `deps`. Never throws on a deps hiccup: a failed
 * round is recorded and the loop returns the best answer so far (best-effort, like the rest of the fabric).
 */
export async function teacherStudentRefine(
  student: StudentTrajectory,
  deps: RefineDeps,
  opts: RefineOpts = {},
): Promise<RefineResult> {
  const maxRounds = Math.max(1, opts.maxRounds ?? 2)
  const retrieveK = Math.max(1, opts.retrieveK ?? 3)
  const rounds: RefineRound[] = []
  let current: StudentTrajectory = { ...student }

  for (let i = 0; i < maxRounds; i++) {
    let retrieved: string[] = []
    let crit: TeacherCritique
    try {
      retrieved = (await deps.retrieve(current.task, retrieveK)) || []
      crit = await deps.critique(current, retrieved)
    } catch (err) {
      rounds.push({ round: i + 1, retrieved, critique: `teacher pass failed: ${err instanceof Error ? err.message : String(err)}`, answerBefore: current.answer, answerAfter: current.answer, changed: false })
      return { finalAnswer: current.answer, rounds, converged: true, reason: 'teacher error → kept student answer (best-effort)' }
    }
    const before = current.answer
    const after = crit.revisedAnswer ?? before
    const changed = normAnswer(after) !== normAnswer(before)
    rounds.push({ round: i + 1, retrieved, critique: String(crit.critique ?? '').slice(0, 500), answerBefore: before, answerAfter: after, changed })

    if (!changed) {
      return { finalAnswer: before, rounds, converged: true, reason: `converged at round ${i + 1} (teacher left the answer unchanged)` }
    }
    // the revised answer becomes the student's answer; record the critique as a new reasoning step for next round.
    current = { task: current.task, steps: [...current.steps, `refined: ${String(crit.critique ?? '').slice(0, 120)}`], answer: after }
  }
  return { finalAnswer: current.answer, rounds, converged: false, reason: `stopped at maxRounds=${maxRounds} (still changing)` }
}

/** Did the loop actually improve on the student's first answer? (cosmetic helper for logging/boarding.) */
export function refinementChangedAnswer(student: StudentTrajectory, result: RefineResult): boolean {
  return normAnswer(student.answer) !== normAnswer(result.finalAnswer)
}
