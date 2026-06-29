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

/** What the student produced: the task, the reasoning path it took, and its answer (+ optional confidence). */
export interface StudentTrajectory {
  task: string
  steps: string[]      // the student's reasoning-event summaries, in order
  answer: string
  confidence?: number  // the student's certainty in its answer (e.g. self-consistency agreement), [0,1]
}

/** One teacher pass: critique of the student's path + the revised answer it argues for (+ optional confidence). */
export interface TeacherCritique {
  critique: string         // what the student missed / should attend to (short)
  revisedAnswer: string    // the teacher's corrected answer (may equal the input → nothing to change)
  confidence?: number      // the teacher's certainty in ITS revision, [0,1]
}

export interface RefineRound {
  round: number
  retrieved: string[]      // micro-experiences the teacher retrieved this round (safe-trace summaries)
  critique: string
  answerBefore: string
  answerAfter: string
  changed: boolean         // did the answer actually change (i.e. an override was ACCEPTED)?
  proposedChange?: boolean // did the teacher PROPOSE a different answer (before the gate)?
  overrideAccepted?: boolean
  studentConfidence?: number
  teacherConfidence?: number
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

export interface RefineOpts {
  maxRounds?: number
  retrieveK?: number
  // ── confidence-gated override (the board fix) ──────────────────────────────
  // agentkb1 showed the unguarded loop hurt: the teacher overturned CORRECT student answers more than wrong
  // ones (helped 4 / hurt 13). Borrowing Skrynnik 2021's adaptive-demonstration-decay idea: the teacher is a
  // demonstrator whose authority must be EARNED, not assumed. An override is accepted only when the teacher's
  // confidence beats the student's by a margin; the margin RISES with how much we trust the student
  // (`studentSkill`) and with each round (`authorityDecay`) — so a confident student is hard to overrule and the
  // loop can't oscillate. The gate engages only when BOTH confidences are supplied (else legacy accept-on-change).
  overrideMargin?: number   // base margin teacher.conf − student.conf must clear to override (default 0.1)
  studentSkill?: number     // prior trust in the student; added to the margin (Skrynnik decay analog), default 0
  authorityDecay?: number   // extra margin added per round, default 0 (teacher authority decays over rounds)
}

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
    const proposedChange = normAnswer(after) !== normAnswer(before)

    // CONFIDENCE GATE: a proposed override is accepted only if the teacher out-confides the student by the
    // effective margin (base + studentSkill + round·decay). When confidences are absent, fall back to legacy
    // accept-on-change so existing callers are unaffected.
    const tc = crit.confidence, sc = current.confidence
    const gated = proposedChange && tc !== undefined && sc !== undefined
    const effMargin = (opts.overrideMargin ?? 0.1) + (opts.studentSkill ?? 0) + i * (opts.authorityDecay ?? 0)
    const overrideAccepted = gated ? (tc! - sc!) >= effMargin : proposedChange
    const changed = proposedChange && overrideAccepted
    const finalAfter = changed ? after : before
    const gateNote = gated
      ? (overrideAccepted ? ` [override accepted Δconf ${(tc! - sc!).toFixed(2)}≥${effMargin.toFixed(2)}]`
                          : ` [override REJECTED Δconf ${(tc! - sc!).toFixed(2)}<${effMargin.toFixed(2)} — kept student]`)
      : ''
    rounds.push({ round: i + 1, retrieved, critique: (String(crit.critique ?? '').slice(0, 500) + gateNote).slice(0, 600), answerBefore: before, answerAfter: finalAfter, changed, proposedChange, overrideAccepted, studentConfidence: sc, teacherConfidence: tc })

    if (!changed) {
      // either the teacher agreed, or it proposed a change the gate rejected — settle on the student's answer.
      const why = proposedChange ? `teacher override rejected by confidence gate at round ${i + 1}` : `teacher left the answer unchanged at round ${i + 1}`
      return { finalAnswer: before, rounds, converged: true, reason: why }
    }
    // accepted override: the revised answer (with the teacher's confidence) becomes the student's for next round.
    current = { task: current.task, steps: [...current.steps, `refined: ${String(crit.critique ?? '').slice(0, 120)}`], answer: after, confidence: tc ?? current.confidence }
  }
  return { finalAnswer: current.answer, rounds, converged: false, reason: `stopped at maxRounds=${maxRounds} (still changing)` }
}

/** Did the loop actually improve on the student's first answer? (cosmetic helper for logging/boarding.) */
export function refinementChangedAnswer(student: StudentTrajectory, result: RefineResult): boolean {
  return normAnswer(student.answer) !== normAnswer(result.finalAnswer)
}
