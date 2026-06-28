# Phase 0 — Inline-Attribution-Binding Audit (the gate)

**Verdict in one line:** every **generative** path is **POST-HOC** bound; only the **deterministic** paths
(extractive-QA, canon direct-recall, verified-compute) are **INLINE-BOUND**. Therefore the
attribution-faithfulness metric (Metric 2b) is *supported only on the deterministic paths* and is **"build it"**
for the generative paths. No cross-path routing leak was found.

This is a white-box trace of `~/dev/Noetica/agent-machine`. Each verdict cites the code that justifies it.

## Per-path verdict

| Path | Verdict | Mechanism | Code |
|---|---|---|---|
| Retrieval → context → generation → verify | **POST-HOC** | chunks injected as unstructured prompt text; free-form generation; grounding checked *after* by token overlap | `doc-store.ts:221`, `server.ts:6269-6277`, `research-verify.ts:27` |
| Brain arm (study-brain + MMLU board) | **POST-HOC** | `BrainHit` keeps only `slug` (no chunk id); context injected as `[n] text…`; free-form answer; "grounded" comes from the reliability gate (agreement×density), not chunk binding | `study-brain.ts:118`, `mmlu-brain-bench.ts:376`, `reliability-gate.ts:74` |
| Canon route — `reason`/`retrieve` | **POST-HOC** | `route.grounding` (defs + equations) injected as context prefix; answer free-form; tag is the *route type*, not a span pointer | `canon-route.ts:43-51` |
| Reasoning-evidence receipt | **N/A (logging)** | records that generation happened (event trace, `traceHash` over event refs); no per-span evidence captured at generation | `reasoning-evidence.ts:132-168` |
| **Extractive-QA** | **INLINE-BOUND** | sentences ranked *with their source chunk index* (`source: i+1`), emitted verbatim with `[source]`; no generation step | `extractive-qa.ts:54-86` |
| **Canon `define`/`calc`** | **INLINE-BOUND** | answer pulled directly from the glossary / computed deterministically; the grounding *is* the source | `canon-route.ts:58-79` |
| Verified-compute | **INLINE-BOUND** | sympy + dimensional homogeneity + plug-back; the certificate *is* the derivation | `compute_arm.py`, `model_verify.py` |

## Routing-leak check — PASS

The only places that set `grounded = true` are extractive-QA (`extractive-qa.ts:86`), the post-hoc verifier
(`research-verify.ts:42`), and verified-compute. Free-form parametric generation does **not** carry a
`grounded`/`retrieved` tag — `route: 'reason'` (the no-canon-match fallback, `canon-route.ts:43`) injects no
grounding and is not labeled retrieved. So a parametric guess cannot currently masquerade as `P-RET` *through the
tag*. (Metric 1's `P-GEN → labeled P-RET` cell is the empirical re-check of this claim and must stay ~0.)

## Why this matters — the Metric 1 connection

The production grounding verifier `research-verify.ts:verifyGrounding` is **identical** to the eval's `sim`
detector: split the answer into sentences, mark a sentence grounded iff ≥50% of its content tokens appear in the
source. Its docstring claims it "reliably catches the failure that matters." **Metric 1 measured exactly this
function on RAGTruth's human labels: F1 0.24 (precision 0.16, recall 0.48).** So the audit and the confusion
matrix tell one story:

- *Architecturally* (Phase 0): the generative "grounded" tag is a **post-hoc token match**, not an inline binding.
- *Empirically* (Metric 1): that post-hoc token match catches **<48%** of hallucinated sentences and over-flags
  faithful ones 5:1.
- *The upgrade direction* (Metric 1 NLI arm): replacing token-overlap with **entailment** (the verify-layer
  concept) lifts recall on the missed cell — Baseless additions — from **0.38 → 0.86**.

## The build (Phase 0.4) — make generative binding inline

To make Metric 2b supportable on the generative paths, the highest-value single build is to bind evidence inline
at decode time, not match it afterward:

1. **Structured-output binding** — generation emits `{span, evidence_id, relation}` per grounded span (the
   evidence id is `filename#chunkIndex` from `doc-store.ts`, already stable at retrieval), so the pointer is the
   generator's *input*, not a post-hoc guess.
2. **Constrained decoding from graph nodes** — grounded spans are decoded *from* the canon/CSKG node (Q-ID +
   relation), making the pointer the generator's condition by construction.

Until that ships, the attribution claim is scoped: **"faithful (inline-bound) attribution on extractive,
glossary-recall, and verified-compute answers; correct-but-post-hoc attribution on generative answers."** That is
the honest, defensible boundary — and it is exactly the boundary a frontier RAG API cannot draw at all.
