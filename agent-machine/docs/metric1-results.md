# Metric 1 — Epistemic-Tagging Confusion Matrix (results of record)

The foundational number of the provenance-fidelity eval (spec build-order item 2). Provenance axis (`P-RET` vs
`P-GEN`) measured against RAGTruth's human span labels, held-out test, threshold calibrated on train only.
Embedding = MiniLM; NLI = `cross-encoder/nli-deberta-v3-small`. Every row is manifest-pinned in
`canon/provenance-eval/` (input SHA-256 + model + threshold + git rev → scoring is bit-reproducible).

## The detectors (provenance axis, RAGTruth held-out)

| detector | precision | recall | F1 | Cohen's κ | what it is |
|---|---|---|---|---|---|
| `sim` (token-overlap) | 0.16 | 0.48 | **0.24** | 0.14 | **= the deployed `lib/research-verify.ts:verifyGrounding`** |
| `nli-single` (entailment, best premise) | 0.11 | 0.83 | 0.19 | 0.04 | source-entails-claim, top-1 of top-k |
| `nli-union` (entailment, joined premise) | 0.11 | 0.78 | 0.19 | 0.04 | source-entails-claim, top-k joined |
| `combo` (learned logistic over sem/lex/nli) | _pending_ | _pending_ | _pending_ | _pending_ | the council/CISC combiner |

## Recall by hallucination type (where each detector wins)

| label type | `sim` | `nli-single` |
|---|---|---|
| Evident Baseless Info | 0.44 | 0.86 |
| Subtle Baseless Info | 0.38 | 0.94 |
| Evident Conflict | 0.60 | 0.74 |
| Subtle Conflict | 0.33 | 1.00 |

## The three findings that matter

1. **Metric 1 grades the deployed verifier.** The `sim` detector is byte-for-byte the production grounding gate
   `research-verify.ts:verifyGrounding` — split into sentences, mark grounded iff ≥50% content tokens appear in
   source. Its docstring asserts it "reliably catches the failure that matters." Measured against human labels:
   **F1 0.24, recall 0.48, precision 0.16** — it misses more than half of hallucinated sentences and over-flags
   faithful ones ~5:1. The gate that decides "is this answer trustworthy to reuse?" is far weaker than it claims.

2. **The multi-premise hypothesis is rejected.** Joining premises did not recover NLI precision (0.108 vs 0.105),
   so the precision collapse is **not** an aggregation artifact. Strict entailment is the wrong proxy for
   faithfulness: a faithful summary sentence is frequently not *strictly entailed* by the source, so a general
   NLI model over-flags by construction. `sim` and `nli` catch **different** hallucinations — `sim` the fabricated
   specifics / conflicts (low token overlap), `nli` the baseless additions (not entailed) — which is exactly why
   a **learned combination** (the `combo` row) is the principled detector and why it maps to our council/CISC arm.

3. **No detector is yet a trustworthy judge (the §4 gate).** Cohen's κ vs human labels tops out at **0.14
   ("slight")** for `sim`; the NLI detectors sit at 0.04. None approaches "substantial" (0.61). Per spec §4, every
   judge-scored metric must therefore report its κ, and the next detector build must be **faithfulness-tuned**,
   not a repurposed token-overlap or general-NLI judge. This is a measured mandate.

## How this couples to Phase 0

The Phase 0 audit (`docs/phase0-inline-binding-audit.md`) found all generative paths **POST-HOC** bound — the
"grounded" tag is assigned by exactly this post-hoc token match, not by inline evidence binding. Metric 1
quantifies how weak that post-hoc gate is (F1 0.24). Together: the architecture is post-hoc (Phase 0) *and* the
post-hoc check is weak (Metric 1). The fix is two-pronged — inline binding (Phase 0.4 build) **and** a
faithfulness-tuned detector (Metric 1 mandate).
