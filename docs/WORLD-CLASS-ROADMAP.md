# World-class roadmap — making the local mesh compete with frontier

Thesis: **out-loop, not out-model.** A 7–30B local mesh beats its weight class through
scaffolding — verification, test-time compute, routing, retrieval. This doc is the gap
analysis (grounded in a six-dimension code audit, 2026-06-21) + the prioritized plan.

## Diagnosis

The machinery is largely built; the **high-leverage loops aren't closed**:
- Verification signals are **computed but not gated on** (speculative answers ship labeled, not blocked).
- Best-of-N (`deliberation`) is **off by default**, 3 candidates, reasoning-only.
- Training traces are **harvested but never distilled into weights** (`/api/tune` = 503 stub).
- Benchmark scripts exist but **no CI gate** — commits don't know if they closed the frontier gap.

The verifier is the engine: a reliable verifier powers best-of-N selection, low-confidence
gating, AND rejection-sampling training data. **That's the keystone.**

## Gaps (ranked by leverage)

1. **No verifier→selection loop** — signals exist (`value-judgment.ts`, `pln-judgment.ts`,
   `complexity-discipline.ts`); missing a unified accept/escalate/reject gate before dispatch +
   best-of-N on by default. *Highest leverage, mostly wiring.*
2. **No real code test-verify loop** — `code_execute` runs code but there's no
   generate→run-tests→rank-by-pass→repair cycle (the loop self-model claims but doesn't exist).
3. **No self-consistency** — single path; no majority voting for reasoning/math.
4. **No throughput leverage** — Ollama serializes; no speculative decoding / draft models /
   parallel sampling. This is what makes best-of-N affordable on CPU. Enabler for 1–3.
5. **No constrained decoding** — post-hoc JSON5 repair only (`tool-calls.ts`); Ollama's
   GBNF/`format=` grammar is unused. Kills malformed-tool-call failures at the source.
6. **Weak rerank/grounding for reasoning** — strong extractive QA + `sheafSearch` + MMR, but
   no cross-encoder rerank, no query rewrite/HyDE, no context compression.
7. **Learning loop never reaches weights** — QA-pair + remediation harvest exist; no
   rejection-sampling LoRA / distillation. `/api/tune` is a stub. *The compounding moat.*
8. **Frontier gap invisible** — MMLU/GSM8K scripts exist but off-CI; "worth" is a heuristic,
   not ground-truth. No SWE-bench/HumanEval, no frontier-delta gate.
9. **Routing state amnesiac** — bandit + capability-model wired and on, but reset every restart;
   no persistence / warm-start priors. Easy win.

## Plan

### Phase 1 — Close the verifier loop (immediate quality jump; mostly wiring)
- Unified **pre-dispatch critic**: fuse {VJ worth, PLN grounding, complexity barriers,
  extractive grounding, code test-pass} into one accept / escalate / clarify decision.
- **Best-of-N on by default**, scaled N, with the critic as selector (not just reasoning turns).
- **Real code test-verify-repair**: run tests, rank candidates by pass-rate, repair the best.
- **Self-consistency** voting for reasoning/math.
- **GBNF-constrained decoding** for tool calls + JSON output.
- **Persist + warm-start** the bandit / capability-model.

### Phase 2 — Make it affordable & measured
- **Speculative decoding** / draft models / parallel sampling for throughput.
- **Continuous eval gate** in CI: MMLU / GSM8K / HumanEval / SWE-bench-lite vs frontier
  baseline; replace synthetic "worth" with ground-truth where a benchmark oracle exists.
- **Retrieval**: cross-encoder rerank + query rewrite/HyDE + context compression.

### Phase 3 — The compounding moat
- Close the learning loop **into weights**: rejection-sampling LoRA / distillation from the
  already-harvested QA pairs + verify-repair traces; wire `/api/tune`.
- **Adaptive test-time-compute budget** (spend more when uncertain) + per-subgoal escalation.

## Evidence map (where each lever lives today)
- Verification: `value-judgment.ts`, `pln-judgment.ts`, `complexity-discipline.ts`, `logic-solver.ts` (INFER tier stubbed), `proof-fabric.ts`
- Test-time compute: `server.ts` deliberation (`NOETICA_DELIBERATION`, off), `dialogue-policy.ts` escalation, `orchestrator.ts` concurrency gate
- Routing/learning: `router.ts`, `capability-model.ts` (UCB1, in-memory), `qa-pairs.ts`, `remediation.ts`, `scripts/learn-loop.ts`, `/api/tune` (stub)
- Retrieval: `doc-store.ts` (`sheafSearch`), `retrieval.ts` (7 patterns + MMR), `extractive-qa.ts`, `cairnpath-adapter.ts`, `embed-sidecar/`
- Tool/structured: `tool-calls.ts` (JSON5 recovery), `TOOL_USE_INSTRUCTIONS`, no GBNF
- Eval: `scripts/mmlu-bench.ts`, `mmlu-brain-bench.ts`, `verified-vs-raw.ts`, `study.ts`, `/api/benchmark/summary` (ops only), `quality-sr.ts`
