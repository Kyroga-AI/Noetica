# Test Roadmap — IFTTT (results-conditional)

*The next test is chosen by the last result. This is the decision tree, not a fixed plan.*

## The meta-fork the corpus boards resolve
v3 (dedup) + v4 (equation recovery) answer the one strategic question that routes everything else:
**is our bottleneck KNOWLEDGE (corpus quality) or REASONING (technique)?**

- **IF** v4 closes most of the baseline→frontier gap (esp. math) **THEN** the bottleneck was *knowledge* →
  invest in corpus: the per-resource OCW scraper, more depts re-extracted, commonsense KG, more domains.
- **IF** v4 barely moves **THEN** the bottleneck is *reasoning* → invest in the neurosymbolic silos (#11–14).
- **Most likely both contribute** → the boards *quantify the split*, and we weight investment accordingly.

## Branch tree (per pending result)

### v3 — deduped brain vs v2
- **IF** v3 ≈ v2 → dedup is an *efficiency* win (40% leaner/faster, cheaper vectorize), not an accuracy lever →
  bank it, proceed to v4. *(most likely — exact-dup removal helps breadth/cost, not correctness directly)*
- **IF** v3 > v2 → retrieval *crowding* was hurting → near-dup (not just exact) dedup + dedup the domain/
  commonsense corpora too.
- **IF** v3 < v2 → (unlikely for exact dups) some "dup" carried signal → investigate hashing/normalization.

### v4 — equation recovery (the math test)
- **IF** college_math / abstract_algebra jump → the `�` corruption *was* the math bottleneck (the user's call) →
  **THEN** (a) re-extract ALL depts with pymupdf, (b) #12 brain-grounded compute is unblocked (clean math to
  ground on), (c) #14 iterative loop has clean math to expand over.
- **IF** math is flat → the math weakness is *reasoning/formalization*, not retrieval → prioritize #12 + the
  reasoning arms over more corpus work.
- **IF** the lift is *broad* (not just math) → extraction quality matters everywhere → re-extract all depts.

### compute — after #12 (brain-grounded, post-v4)
- **IF** on-fired > ~70% → enable the verified-compute **OVERRIDE** (the P0) → re-measure with override on.
- **IF** still < baseline → formalization is fundamentally hard here → keep it abstain/vote, **no override**;
  invest the reasoning budget in #14 instead.

### #14 — iterative query-graph loop (Think-on-Graph + HippoRAG, uncertainty-gated)
- **IF** it lifts uncertain-answer accuracy → promote it (uncertainty-gated) to production retrieval.
- **IF** no lift → diagnose: is it the *trigger* (firing on confident answers — tighten the entropy gate) or the
  *expansion* (graph noise — tighten the prune step)? Tune, then re-measure or shelve.

### #11 — VSA arm
- **IF** it beats baseline on MMLU (surprising) → wire to production.
- **IF** ≈/below (expected — prose MCQ is the wrong shape) → keep as instrument; redirect VSA to the task it
  fits (relational / hidden-state reasoning, the 15.4×-math paper) and test on a RAVEN/analogy bench.

### #13 — definition-mining → glossary lookup
- **IF** the lookup answers "what is X" cleanly → wire the clean-lookup path (the procedural/latency win).
- **IF** mined definitions are noisy → the OCW-extract regression returns → better mining (LLM-distilled defs).

### domain brains — medicine/legal (harness #228)
- **IF** the medicine brain lifts MedQA → the domain-brain method generalizes → expand to more domains.
- **IF** not → medical knowledge isn't retrievable as-chunked → fix chunking/extraction first.

## The cross-cutting promotion rule (every board)
beats-baseline **AND** generalizes-to-chat → **production** · wins-but-MCQ-specific (medprompt) → **board-only** ·
loses → **instrument** (fix or leave; never delete). Board roster ≠ production roster.

## Why this order is self-consistent
The reasoning silos (#11/#12/#14) all need **clean math in the brain** to ground/expand over — which is the v4
dependency. So: **corpus clean (v3/v4) → wire the silos (#11–14) → measure each → promote winners.** The corpus
boards also *tell us how much to invest* in reasoning vs corpus, so we don't guess the split — we measure it.
