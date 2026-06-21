# Neurosymbolic Learning Plan — knowledge types, verified compute, and PROMETHEUS (SR)

**Status:** Plan. Ties the golden brain + the 7 knowledge types + the verified-compute/chainer
solvers + PROMETHEUS (symbolic regression → HellGraph atoms + PLN) into one learning loop.

---

## What the question-type data tells us

Classifying the 2,328 MMLU questions by the 7 ARC knowledge types (Boratko et al. 2018) gives
the **dispatcher map** — what fraction of questions each solver must handle:

| solver | share | knowledge types |
|---|---|---|
| **retrieve** (golden lookup) | **63%** | BasicFacts · Definition · Purpose |
| **compute** (verified-compute engine) | **20%** | Algebraic |
| **experiment** (to build) | 6% | Experiments |
| **spatial** (to build) | 4% | Physical Model |
| **chain** (multi-hop chainer) | 4% | Causes & Processes |

This *explains the benchmark results*: retrieval is a wash on math because math is **compute-heavy
at the question level** (Algebraic), while it helps on biology (≈80% BasicFacts). It also says:
**get retrieval + compute right and you cover ~83%**; the rest needs the experiment/spatial solvers.

---

## The two halves and how PROMETHEUS bridges them

- **Neural** — the golden vectors: retrieval, the domain router, the knowledge-type router.
- **Symbolic** — the governing equations as HellGraph atoms, reasoned over by **PLN**; the
  verified-compute engine instantiates them.
- **PROMETHEUS** is the bridge. `prometheusd` is the symbolic-regression daemon: it **discovers
  governing equations from data** (SINDy/SR), gates/validates them (the prophet-platform
  `validate_prometheus_sindy_candidate` / `sr_run_artifact` / `gate_evaluation` pipeline), and
  **writes them back to HellGraph as first-class atoms** — stateful, continuous, PLN-integrated.
  Crucially it **describes dynamics, never controls** (no controlAuthority). It is how the
  *symbolic* side **grows from data** instead of being hand-curated.

---

## The learning loop

```
  GOLDEN INGEST            CLASSIFY               SOLVE + VERIFY            DISCOVER (gap)
  OCW brain → atomspace →  domain router    →     retrieve | compute  →    PROMETHEUS SR
  (tier/domain/            knowledge-type         | chain               →  (SINDy on data)
   knowledge-type tags)    router → solver        (dim-verified)        →  gate → atom in graph
        │                                                                        │
        └───────────────────────  PLN reasons over atoms  ◄──────────────────────┘
                          (golden facts + curated + discovered equations)
                                          │
                                  EXAM (MMLU/held-out) → find UNSOLVED types
                                  → retrieve more · discover via SR · refine classifier → loop
```

1. **Ingest** — golden vectors into `scope:"brain"`, tagged `domain` + `knowledge_type` +
   `material`; dependency DAG between type-ConceptNodes (`requires`).
2. **Classify** — problem → domain (router) × knowledge-type (router) → the solver.
3. **Solve + verify** — retrieve (golden, cited) / compute (verified-compute) / chain
   (multi-hop, dim-checked). Abstain when unverified.
4. **Discover** — when a problem has *data* but no known equation, **PROMETHEUS** runs SR/SINDy,
   gates the candidate (parsimony + dimensional + fit), and crystallizes it as a HellGraph atom.
   This is the "data → law" capability the catalog can't hand-author.
5. **Crystallize / reason** — discovered + curated equations + golden facts are atoms with truth
   values; **PLN** reasons over them, combining the symbolic with the neural (vector) evidence.
6. **Exam → feedback** — test on MMLU; for each *unsolved knowledge type*, decide: retrieve more
   golden, run PROMETHEUS SR, or improve the classifier. Iterate. (The Alexandrian Academy loop.)

---

## Phases

1. **Type-router live** — wire knowledge-type → solver; covers retrieve (63%) + compute (20%) +
   chain (4%) with what we already have. Measure coverage-at-confidence per type.
2. **Golden ingest** — `importBrainShard` with domain + knowledge-type tags; dependency DAG.
3. **PROMETHEUS curriculum** — run SR over the **data-discoverable core models** (the ~66% of the
   71 governing models that are sr/sindy-discoverable); each gated run that passes writes an atom.
4. **PLN integration** — discovered + curated equations as atoms; PLN combines them with golden
   facts and the vector evidence for the multi-step (chain) and experiment/spatial types.
5. **Close the loop** — exam → unsolved-type triage → retrieve / discover / refine → repeat.

## The guardrails (carried from the cosmic-structure spine)
- **Verified, not asserted** — every computed answer is dimension-checked + plug-back; every
  PROMETHEUS equation passes the SR gates before it becomes an atom. No faked physics numbers.
- **Cite the source** — golden atoms are citable; discovered atoms carry their SR-run provenance.
- **Describe, don't control** — PROMETHEUS (and the whole KB) describes dynamics; it never acts.
