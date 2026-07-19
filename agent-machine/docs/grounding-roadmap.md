# Grounding-fidelity roadmap

The moat axis: faithfulness / attribution / calibration — the measurement where
our harness is IN the loop (vs parametric-recall benchmarks we can't and needn't
win). Brain-agnostic throughout, so it plugs into the new brain.

## Done
- **Phase-0 audit** (`phase0-inline-binding-audit.md`) — verdict: generative paths POST-HOC, deterministic paths INLINE; routing-leak check PASS.
- **Metric-1 re-measured** on RAGTruth (600 resp / 4922 sent): sim F1 **0.215**, nli **0.187**, **combo 0.264**. Correction: NLI-alone is *worse* than lexical; combo (logistic over sem/lex/nli — the council pattern) is best. Post-hoc detection caps ~F1 0.26.
- **Detectors ported to prod** (`lib/research-verify.ts`): `verifyGroundingNLI` (entailment, DI engine), `verifyGroundingCombo` (the measured best), `makeLlmEntail` (mesh-judge). 8/8 tests.
- **Inline-binding contract + verifier** (`lib/grounded-answer.ts`): `GroundedAnswer{spans[{text,evidence_id,relation}]}` + `verifyInlineBinding` → P-RET-faithful (by construction) / P-RET-unfaithful (the frontier's silent fail) / P-GEN; `faithfulAttributionRate`.
- **Calibration plumbing**: `provenance_eval.py` combo mode now persists grounded-space weights → `canon/provenance-eval/combo-weights.json`.
- **Wiring readiness**: `replayCase` judge is async-tolerant; the replay path has a `NOETICA_GROUNDING=combo` opt-in (default lexical until validated).

## Next — gated on the eval env (torch + sentence-transformers + RAGTruth)
1. **Calibrate combo** — run `RAGTRUTH_DIR=… PROV_DETECTOR=combo python scripts/provenance_eval.py` → bakes `combo-weights.json`; load it in `verifyGroundingCombo`.
2. **Validate the prod entail engine** — add an `llmjudge` detector mode (the mesh model as entailer) so the *production* engine gets its own RAGTruth F1, not deberta's.
3. **Flip the gate** — once (1)+(2) produce real numbers, make combo the default on the offline/gate paths (replay, solution-store). Leave the intentional lexical fast-path in `graph-rag`/`graph-covariates` (no-LLM-cost by design).

## Next — gated on the NEW BRAIN
4. **Emit `GroundedAnswer`** — the brain produces `{span, evidence_id, relation}` at decode (structured output / constrained-from-graph-node). The `evidence_id` is `filename#chunkIndex`, already stable from the doc-store. This flips generative attribution from *correct* to *faithful*.
5. **P-RET tag from the binding** — replace the post-hoc `grounded` tag on generative paths with the inline verdict; wire `verifyInlineBinding` into the reasoning-evidence receipt.

## Then — the publishable asset (the risk-committee number)
6. Run the incumbent faithfulness benchmarks through the harness — **RAGTruth · ALCE · FACTS-Grounding · LegalBench-RAG · SURE-RAG** — and publish: %-claims-correctly-tagged-by-mode, citation-faithfulness rate, fabrication rate, calibration (ECE). These are **contamination-robust** (test faithful-to-provided-context, not recall) → they satisfy Rule #0 *and* measure the architecture. That's the categorical-superiority claim, made a number.
