# Provenance-Fidelity: the measurement we own, and the discipline that earns it

This is the spec for the axis where our harness is *in* the measurement loop — faithfulness, attribution,
calibration — as opposed to MMLU, where the harness contributes nothing and we top out at parity (board:
composite 60.7%, brain +0.3). It exists because a reviewer's critique was right on the load-bearing points,
and this document turns those corrections into our standard rather than letting enthusiasm skip them.

The single non-negotiable: **a published ontology gives us the label vocabulary, not a classifier.** The KKO/
Peirce grounding tells us *what* the epistemic categories are; it does not tell us *how we know* a given span
was abduced rather than retrieved or confabulated. That detector is the hard problem, its accuracy is its own
measured number, and `scripts/provenance_eval.py` produces it. Everything below is downstream of that.

## 1. Two orthogonal axes (do not collapse them)

> Tag codes follow the build spec's formal schema (§1 of the handoff). Each scored span carries a `(P, I)` pair;
> segmentation forces each scored unit to be single-provenance, single-inference.

A claim has an independently-checkable value on each of two axes. Flattening them into one tag set is both
less rigorous and easier to game.

| | **Axis P — Provenance** (where content came from) | **Axis I — Inference type** (how it was reached) |
|---|---|---|
| values | `P-RET` retrieved (pointer-bound) · `P-GEN` generated (no pointer) | `I-NON` assertive · `I-DED` deductive · `I-IND` inductive · `I-ABD` abductive |
| ground truth | span pointer-bound to evidence? — RAGTruth labels this | the reasoning step type — needs its own labeled set |
| our checker | retrieval-span overlap + NLI entailment (`verify`) | the operation-router + compute certification |
| canonical anchor | Wikidata Q-ID + CSKG relation (a *P-axis* guarantee only) | `kko:Methodeutic` typing of the derivation |
| critical error cell | `P-GEN → labeled P-RET` (confabulation-as-grounded; must be ~0) | `I-ABD → labeled I-DED` (hypothesis-as-necessity) |

They are genuinely orthogonal: a claim can be `(P-RET, I-DED)`, `(P-GEN, I-ABD)`, `(P-RET, I-NON)`, etc.
**The Wikidata/CSKG attribution is a P-axis guarantee and says nothing about the I axis** — do not let the
strength of P-axis attribution paper over the open detector on the I axis.

`I-ABD` is simultaneously the highest-value tag for regulated use (inference-to-best-explanation is exactly
where confident hallucination lives) and the hardest to detect. It is the last cell to fall, and we report its
detector accuracy separately rather than assuming the ontology confers it. Phase 0 (the inline-binding audit,
`docs/phase0-inline-binding-audit.md`) gates whether `P-RET` is trustworthy by construction per generation path.

## 2. The metrics (each a number, not an adjective)

1. **Epistemic-tagging confusion matrix** — per-tag precision/recall against human ground truth.
   `scripts/provenance_eval.py` on RAGTruth, provenance axis first. The demo-killer obligation: construct a case
   where the system tags a confabulation `retrieved` or a parametric guess `deductive`, and show the matrix
   catches it. The SHACL gate enforces that tags are *well-formed*, not that they are *true*; this matrix is the
   truth check.
2. **Verified-compute coverage fraction** — *not* "our numbers are right." The honest claim is
   "certified-correct on X% of numeric answers, with the verification method (sympy + dimensional homogeneity +
   plug-back) published." It is right-by-construction on the reducible subset and catches a specific error class
   (dimensionally inconsistent / fails plug-back); it does **not** catch a dimensionally-consistent wrong formula
   on correct inputs. Report coverage and the caught/uncaught error classes, bounded.
3. **Calibration** — ECE + risk-coverage curve from the reliability gate (already a curve: 59→73% accuracy at
   ~60% coverage). Calibration is the property a risk committee signs, and it is a measured artifact, not a claim.

## 3. The sequence (run → validate → co-govern → publish — never publish-first)

A measurement standard earns authority from *demonstrated validity*, not architectural elegance. Publishing the
standard before it has been validated against anything is how a technically-superior eval gets dismissed as
untested homework. The order is fixed:

1. **Run** the incumbent benchmarks (RAGTruth / ALCE / FACTS-Grounding / FinanceBench) through our harness.
2. **Validate**: show our machinery agrees with human hallucination judgments where they overlap *and* captures
   the extra axes (inference-type, verified-compute) they miss. Produce sane numbers on the incumbents first.
3. **Co-govern** before publishing (see §4).
4. **Publish** the standard — only now, with validity demonstrated.

## 4. Credibility structure (defuse the vendor-won-benchmark trap)

Every property we measure is one we chose because we are good at it. A sophisticated evaluator — the GC / CRO /
CDO we sell to — will note that a vendor-authored, vendor-won benchmark is shaped to the product. The
standards-play only works with three things, and without them "we defined how faithfulness is measured" reads as
"we defined a test we pass":

- **(a) third-party governance / co-authorship** — a law school, a medical board, or an existing standards body
  that cannot be accused of working for us.
- **(b) published losses** — documented cases where we *lose* on our own benchmark.
- **(c) incumbent-fair metrics** — metrics on which the frontier models can be scored fairly, not metrics only
  our architecture can satisfy.

## 5. Bounded claims (say the true, strong version)

- ❌ "reproducible to the bit" → ✅ **"scoring is bit-reproducible against a versioned output manifest."** Neural
  generation is not bit-reproducible without pinned temperature/seeds/deterministic-kernels/batch-invariance and
  accepted GPU-FP-determinism costs, and is fragile even then. A buyer who re-runs and gets a different generation
  treats "to the bit" as falsified. The *scoring* over a fixed output set is deterministic — claim that.
  (`provenance_eval.py` emits the manifest: input SHA-256, embedding/NLI model, threshold, git rev.)
- ❌ "we provably improve on your failure cells" → ✅ same, **plus a held-out guard** showing improvement
  generalizes beyond the optimized cells. The self-improving loop has a Goodhart surface ("so you're teaching to
  the test on my data"); without a held-out generalization check, the convergence story becomes a liability the
  moment a regulator asks whether the system is getting *safer* or just getting better at the *measured set*.

## 6. What the parity tension is *not*

The board topping at 60.7% on MMLU does not contradict a parity-or-better claim. They are different arenas. MMLU
is parametric recall where the harness contributes nothing — unwinnable and irrelevant, and the 60.7 *settles*
the "wrong headline" question with data. The parity-or-better claim lives in the faithfulness / verified-compute /
domain tier, where the harness is in the loop — and that arena is still open because the numbers from §3 step 1
are what decide it. No contradiction; two boards.
