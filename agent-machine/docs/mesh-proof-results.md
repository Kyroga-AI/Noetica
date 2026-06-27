# Mesh proof — recorded results

The competitive audit's #1 gap was that the frontier-parity *apparatus* (mesh-vs-frontier.ts, swe-lite-eval.ts,
head_to_head.py, the eval-fabric) had **never been run with saved results**. This file is the first recorded run.
It's updated as runs are recorded; every run is reproducible from the committed harness.

## Run 1 — 2026-06-27 · code suite (HumanEval-style) · on-device mesh, no frontier key

Command: `MESH_URL=http://127.0.0.1:11435/v1 MESH_MODEL=qwen2.5-coder:7b npx tsx scripts/mesh-vs-frontier.ts 8`
Graded vs INDEPENDENT hidden tests (never shown to the model), temp 0.2. Artifact: `mesh-vs-frontier.8q.json`.

| arm | pass@1 | avg latency |
|-----|--------|-------------|
| our mesh — qwen2.5-coder:7b | **8/8 (100%)** | 5.7s |
| our mesh + verify-repair | **8/8 (100%)** | 18.8s |

**Honest reading:** this proves the on-device mesh (a free 7B local model) is *competent* on this suite — but it does
NOT prove frontier *parity*, because a frontier model would also score ~8/8 on these easy problems, and no frontier
arm ran (no key set). 8/8 with no headroom means this suite can't discriminate. Two things make it a real parity
proof: (1) add a frontier arm — `client-proof.sh` now auto-loads the BYOK Anthropic/OpenAI key from the keychain,
so `ANTHROPIC_API_KEY` is one step away; (2) use a HARDER suite where the gap (and verify-repair's lift) actually
shows — see Run 2.

## Run 2 — 2026-06-27 · swe-lite-eval (bug-fix tasks) · baseline vs verify-repair

Command: `MESH_URL=http://127.0.0.1:11435/v1 npx tsx scripts/swe-lite-eval.ts` · model qwen2.5-coder:7b · 6 tasks · hidden tests.

| arm | pass@1 |
|-----|--------|
| baseline | **6/6 (100%)** |
| verify-repair | **6/6 (100%)** |

**Honest reading:** baseline already aces all 6 — so verify-repair shows **no lift here** (nothing to repair). Combined
with Run 1 (also 100%), the real signal is: `qwen2.5-coder:7b` solves 100% of *both* available verifiable suites at
baseline, which **supports** competence/parity-on-this-class-of-work — but **both suites lack headroom** to (a) show
verify-repair's marginal value or (b) discriminate the mesh from a frontier model. **Conclusion: the harnesses are too
easy to prove the interesting claim.** The next run needs genuinely hard tasks — real SWE-bench-lite instances (not 6
toy bug-fixes) and/or a frontier arm — which is where both the verify-repair lift and any frontier gap become visible.
This is the honest state: the apparatus now has *recorded* runs (gap #1's "never run" is closed), and the finding is
that the suites need to be harder before the parity claim can be made externally.

## How to record a full head-to-head (the decisive run)

```
# frontier arms switch on when keys are present; client-proof loads them from the keychain
export ANTHROPIC_API_KEY=...   # or let client-proof.sh pull it
cd agent-machine && MESH_MODEL=qwen2.5-coder:14b npx tsx scripts/mesh-vs-frontier.ts 20
```

Per the estate's own honest assessment (`research-gap-backlog.md`): on **verifiable** work (code/math, execution as
oracle) the technique-not-horsepower thesis holds and parity is plausible; on **open-ended knowledge** (MMLU-Pro)
there's a real ~10–15pt backbone gap (qwen2.5-7b is a generation old) closeable by a newer backbone + distillation,
not technique alone. Record both kinds of run before making the parity claim externally.
