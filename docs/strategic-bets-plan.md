# Strategic bets — plan (2026-07-20)

Three roadmap "moat" moves. Encouragingly, each already has partial infra in the repo, so these are
**finish / wire / expand**, not greenfield. Recommended sequence at the bottom.

---

## Bet A — Close the verifier→selection loop  *(keystone)*

**Why:** "Verified local mesh" only *means* something if the verifier's judgment actually **drives the
answer** and **feeds learning** — automatically, every substantive turn. This is the differentiator no
"local LLM wrapper" has.

**What already exists**
- `agent-machine/lib/best-of-n.js` — `selectBestOfN` (selection primitive)
- `lib/quality-sr.js` — `recordQualitySample`, `worthTrend`, `analyzeDrivers` (quality signal)
- Deliberation: `candidates` + `worth` + `selected_rank` (shown in the Answer inspector today)
- Verification: `research-verify.js` (`verifyGrounding`), critic verdicts
- Learning loop: eval-capture (failures) + procedural-memory (successes) + `/api/learning/*`

**The gap:** these are wired piecemeal. best-of-N isn't the default path; the verifier's score doesn't
auto-select; losers/failures don't reliably flow back into learning. The three loops (select · verify ·
learn) aren't unified behind one selector.

**Plan**
1. **Generate→verify→select as the default** for substantive turns: sample N candidates → score each
   with the existing verifier (grounding + critic + `worth`) → `selectBestOfN` picks the winner. Gate to
   *hard* turns (high uncertainty / low first-pass worth) to control local-model latency + cost.
2. **Close the learning arm:** auto-capture losers + low-worth answers to eval-cases; winners' patterns
   to procedural-memory; surface "fixed X of N" via the existing `/api/learning/replay`.
3. **Calibrate:** worth thresholds, N, and the escalation trigger. Surface the selection in the gutter /
   Answer inspector (already partially there).

**Effort:** Medium. Mostly `server.ts` chat loop + defaults + calibration; small surfacing. All local.
**Risk:** N-candidate latency on local models → gate best-of-N, don't run it on every turn.

---

## Bet B — Cloud-mesh proof harness  *(GTM weapon)*

**Why:** Walk into a client and prove, on the spot, that the sovereign mesh matches GPT-5.5 / Claude 5 on
**their own** prompts. Pure sales leverage.

**What already exists:** `deploy/gcp-frontier-proof.md`; frontier-proof references in `EvaluateSurface`,
`GovernSurface`, `server.ts` (a benchmark board exists).

**The gap:** a one-click, client-facing live head-to-head over the client's prompts with a clean scoreboard.

**Plan**
1. **Harness:** runner takes a prompt set → fans to mesh + (optionally) frontier APIs → scores with the
   **verifier from Bet A** → tabulates quality / latency / cost / sovereignty.
2. **Client-proof surface** in Evaluate: paste or pick prompts, run, live scoreboard (mesh vs frontier).
3. **Signed proof bundle** (reuse Export Proof) the client keeps.

**Effort:** Small–Medium (partial infra; mostly a surface + runner). **Depends on A** for credible scoring.
**Note:** needs frontier API keys at demo time (client's or ours).

---

## Bet C — Typed action layer  *(chat → agent that DOES)*

**Why:** Move from talking to safe, typed, reversible actions — the leap from assistant to operator.

**What already exists:** `execute_action` tool (L4-gated), scope-d authorization + `TOOL_ACTION_CLASS`,
purpose-binding, containment kill-switch, plan-mode approval gate. **The safety spine is already here.**

**The gap:** a real **action catalog** (typed, parameterized actions beyond the generic `execute_action`),
**reversibility / undo**, and a **preview→approve** UX per action.

**Plan**
1. **Action registry:** typed action defs (schema · action-class · reversible? · preview); agent emits typed
   action *proposals*, not ad-hoc tool calls.
2. **Preview + approve + undo** in chat (extend the existing plan-mode gate to per-action typed previews).
3. **Audit + evidence:** every action sealed via the existing governance/evidence fabric.

**Effort:** Large — a quarter. Biggest scope; overlaps Dispatch + scope-d + plan mode.
**Dependency:** benefits from A (verified proposals) and the existing scope-d gate.

---

## Recommended sequence

1. **A — verifier→selection loop** first. The keystone; all local; medium effort; **B and C both lean on
   its scoring/verification.**
2. **B — cloud-mesh proof** as a fast follow. Reuses A's scoring; small; immediate GTM value.
3. **C — typed action layer** last. Its own quarter; builds on the A+B foundation.

**Rationale:** A is the foundation the other two stand on — verification/scoring (B) and verified action
proposals (C). Sequence them so each reuses the last. B can slot in opportunistically before a client
demo even if C hasn't started.

---

## Cross-cutting notes
- Verify-in-packaged-build still outstanding for the *shipped* features (Dispatch/Routines/metachat/gutter)
  — worth a pass before or alongside A, since A touches the same chat loop.
- Everything here is local-first; B is the only one that reaches frontier APIs (and only to *beat* them).
