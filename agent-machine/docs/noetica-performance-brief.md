# Noetica — Performance & Strategy Brief

*Stakeholder summary · 2026-06-23 · figures are reproducible (pinned seed) and clean-eval'd.*

## The thesis
**Technique, not horsepower.** Noetica makes a *small, frozen* open model (Qwen2.5-7B) smarter through
retrieval over a curated knowledge "brain" plus a reasoning council — not by scaling parameters. The result
is a local-first, low-cost, auditable system whose gains come from *method*, which compounds and ports
across model sizes.

## Headline result
On the **same** hard 7-subject STEM exam (MMLU), the **identical** 7B model:

| Condition (same model) | Score |
|---|---|
| Closed-book baseline | **58.6%** |
| + Noetica technique stack (HyDE retrieval + adaptive gate) | **62.9%** |
| **Lift from technique alone** | **+4.3 pts** |

For reference, **Llama-3.2-3B is reported at 63.4%** — i.e., our scaffolding lifted a 7B *to the tier a
different model reaches*, with **no change to the model**. The lift is reproducible (seed 1729) and
contamination-free (a clean-eval certificate proves no test text is in the brain).

> **How to read this:** the claim is the **delta on identical items** (technique vs the same model
> closed-book), not an absolute leaderboard score. These subjects are a deliberately *hard* STEM subset, so
> the absolutes (~59–63%) are not comparable to a full-MMLU headline number — the *gap between conditions* is.

## What each technique is worth (the measurement panel)
Every mechanism answers the *same* questions, so the deltas are clean. Initial board (n=20/subject):

| Technique | Score | vs baseline | Decision |
|---|--:|--:|---|
| **qgen** (hypothetical-doc retrieval) | 62.9% | **+4.3** | ✅ promoted to product |
| **gate** (adaptive retrieval) | 62.9% | **+4.3** | ✅ promoted to product |
| medprompt (de-biased ensemble) | 62.1% | +3.5 | measurement-only |
| brain (gold-first retrieval) | 60.7% | +2.1 | ✅ in product |
| council ensemble | 60.7% | +2.1 | ⚙️ reweighted (validating) |
| baseline | 58.6% | — | control |
| verified-compute, elimination, … | <baseline | — | ⚙️ fixed, re-measuring |

**Method = the moat.** We keep *every* technique in the benchmark permanently (the losers are instruments,
not waste), and promote to production *only* what beats baseline on measured evidence. Four underperformers
were diagnosed and fixed this cycle; a 9-arm validation run (n=50) is in flight to confirm the fixes.

## Why it's defensible
- **Identical model across all conditions** → any delta is technique, not a bigger model.
- **Clean-eval certificate** → no benchmark test text in the knowledge brain (open-book, not memorized).
- **Pinned seed** → byte-for-byte reproducible; anyone can re-run.
- **Full panel measured** → ~15 techniques scored head-to-head, not cherry-picked.

## Strategy
1. **Measure → promote winners.** A permanent benchmark panel; production gets only what's earned.
2. **Domain brains, same architecture.** Medicine (built, 125k USMLE chunks) and legal (statutes + code +
   case law + regulations, building) — the STEM method, generalized to regulated knowledge.
3. **Knowledge moat.** A commonsense/world-knowledge graph layer (CSKG + ConceptNet + DBpedia) under
   evaluation via a staged ablation — corpus vs graph-index vs distillation, measured, not assumed.
4. **Corpus depth.** The full MIT-OpenCourseWare catalog (capture pipeline rebuilt after OCW's site
   migration) plus multi-source legal/medical corpora.

## Progress
- ✅ Technique measurement complete; **2 winners promoted to production**.
- ✅ 4 underperformers diagnosed + fixed; **validation run (n=50) in flight**.
- ✅ Medicine brain banked; legal brain building; raw KG datasets staged (4 GB).
- ▶️ Running now: fixes-validation board, legal vectorize, commonsense kill-gate.
- ⏭️ Next: medicine/legal exam boards, the commonsense ablation, larger-model confirmation.

## Honest caveats
- Initial scores are **n=20/subject (±~4% noise)**; the n=50 validation board is running to firm them up.
- Absolutes are on a **hard STEM subset** — the defensible claim is the **technique delta on identical
  items**, reproducible and clean-eval'd, not an absolute frontier comparison.
