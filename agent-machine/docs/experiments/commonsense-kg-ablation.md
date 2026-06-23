# Commonsense-KG Ablation — Experiment Design

**Status:** design only (no execution). The artifact we align + measure against.
**Method:** the board discipline applied to an architecture decision — *build every variant as an ablatable
condition, stage by cost, let the numbers assign each its role.* We do NOT pick corpus vs graph vs training
a priori; they are **layers that compose**, so the question is the marginal lift of each and whether they
stack or interfere. See `memory: feedback_board_keep_all_promote_winners`.

## The question
Do our stashed commonsense/world-knowledge assets (CSKG + ConceptNet + ATOMIC + WordNet + DBpedia, plus
domain ontologies) lift our small model (qwen2.5:7b), and *how* are they best used? The literature gives
three non-exclusive uses — input corpus, graph index, training data — and a structural insight (paths /
multi-hop). This ablation measures all of them.

## Conditions (the arms)
| Arm | What | Layer |
|-----|------|-------|
| **A0** baseline | 7B, no commonsense | control |
| **A1** +corpus | flat CSKG/ConceptNet text → dense RAG (cheap; fetcher built in PR #222) | retrieval-corpus |
| **A2** +graph-index | entity-link query → 1–2 hop subgraph / HippoRAG PPR → inject paths | retrieval-structure |
| &nbsp;&nbsp;A2a core-only | CSKG only | knob #2 |
| &nbsp;&nbsp;A2b layered | CSKG + UMLS/MeSH (med) + legal taxonomy + MSC (math) | knob #2 |
| **A3** +distilled | 7B SFT on ATOMIC/CSKG triples (COMET-style knowledge model) | weights |
| **A4** stacked | A1 + A2 + A3 together | all |

**Knobs (measured, not chosen):**
- **#2 core vs layered** → A2a vs A2b (are domain ontologies worth the schema-merge cost?).
- **#3 symbolic depth** → 1-hop vs 2–3 hop paths; subgraph size cap (the Cyc question, answered empirically).

## Benchmarks (clean-eval, pinned seed, reproducible — same as the board)
- **Primary / defensible:** CommonsenseQA, SocialIQA (single-hop) · StrategyQA, OpenBookQA (multi-hop).
- **Secondary / Noetica-true:** a custom **cross-domain multi-hop** set (medical→commonsense→physics), authored,
  held-out, clean-eval'd. Standard multi-hop is everyday-knowledge hops; only the custom set tests the
  cross-domain hop a unified core KG is supposed to unlock.
- **Control:** a STEM slice from the existing board — commonsense must not *hurt* STEM (interference check).

## Metrics
- Accuracy per arm per bench.
- **Marginal lift:** A1−A0, A2−A1, A3−A0. **Interaction:** A4 vs Σ(marginals) → do the layers stack or are
  they redundant? (the actual scientific payoff).
- A2 retrieval quality: hit-rate of the gold concept/path in the retrieved subgraph.
- Cost: latency + $ per arm — "worth it" includes cost, so a +1% that doubles latency may not promote.

## Stage gates (stage by cost — this is staging, NOT picking)
- **Stage 1 (cheap, ~days):** A0, A1, A2a on CommonsenseQA + SocialIQA.
  **GATE:** if nothing beats A0 beyond noise → commonsense doesn't move our 7B; keep A1 as the everyday-lane
  fallback only and STOP. (Honest kill criterion.)
- **Stage 2 (medium, only if Stage-1 lift):** A2b (layered) + depth knob + StrategyQA/OpenBookQA + the custom probe.
  **GATE:** does graph (A2) beat corpus (A1)? does layered beat core? does depth pay?
- **Stage 3 (expensive, gated on Stage 1–2):** A3 distillation fine-tune, then A4 stacked.
  **GATE:** run only if commonsense clearly matters AND retrieval alone leaves a gap distillation could fill.

## Promotion rule
Same as the board: each layer earns a place in the product by **measured marginal lift**; losers stay
measurable (never deleted), winners wire into the everyday/knowledge lanes. The end state is *probably* the
full stack — but each layer is justified, not assumed.

## Build prerequisites (what each stage needs — none built/run yet)
- **A1:** vectorize the commonsense field from the stashed raw datasets (`fetch_commonsense_corpus.py`, PR #222;
  raw archives in `gs://sourceos-artifacts-socioprophet/datasets/commonsense/raw/`).
- **A2:** entity-linking corpus↔CSKG nodes; HippoRAG PPR (roadmap #3); canonical glossary/KGTK schema
  (roadmap #6). A2b also needs UMLS/MeSH + legal taxonomy + MSC ingested to the same schema.
- **A3:** SFT pipeline (`distill_prep.py` exists) over ATOMIC/CSKG triples → COMET-style.
- **Benches:** fetch CommonsenseQA/SocialIQA/StrategyQA/OpenBookQA into the eval bank (extends the
  `fetch_mmlu_subjects.py` pattern); author + clean-eval the custom cross-domain set.

## Risks / cautions (from the literature)
- Commonsense lift is small for strong models, **larger for small** — our case (the "technique not horsepower"
  thesis), but still measure rather than assume.
- **Whole-KG injection hurts**; precise subgraph retrieval (query entities' 1–2 hop neighborhood) is required —
  the QA-GNN / KAPING pattern.
- **Custom-bench self-flattery** — clean-eval, held-out, and cross-checked against the standard benches.
- **Schema merge (A2b) is the hard part.** Cyc lesson: don't over-engineer the symbolic graph — thin index +
  neural reasoning. Keep A2 a retrieval index, not an inference ontology.

## References (canonical)
CSKG (Ilievski et al. 2021) · ConceptNet (Speer et al. 2017) · ATOMIC (Sap 2019) / COMET (Bosselut 2019) /
COMET-ATOMIC²⁰²⁰ (Hwang 2021) · KagNet (Lin 2019) · QA-GNN (Yasunaga 2021) · GreaseLM (Zhang 2022) ·
KAPING (Baek 2023) · GraphRAG (Edge/Microsoft 2024) · HippoRAG (Gutiérrez 2024). Cyc (Lenat) as cautionary tale.
