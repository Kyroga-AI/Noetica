# The Alexandrian Academy Knowledge Graph

The unified structure the recovery work is building toward. STEM knowledge — recovered from MIT's gold corpus,
grounded in authoritative references, and interlinked by domain — as one graph that serves the brain, the
tests, the note cards, verified-compute, the glossaries, and the entity layer.

## The layers (bottom → top)

```
  GOLD CORPUS            MIT exam / solution / lecture / pset text (per course)
       │  each chunk points to → its domain lookups (this is the index we build)
       ▼
  DOMAIN LOOKUP          per (domain, course, topic): the canonical references that apply
       │
       ▼
  CANONICAL HIERARCHY    course ─▶ topic ─▶ equation ─▶ form
       │                 8.01 Mechanics ─▶ kinematics ─▶ v=v0+at ─▶ clean form + sympy
       ▼
  GROUNDING              AP/SAT formula sheets (seed) · Wikidata P2534 / Wikipedia (verify symbols) ·
       │                 symbol-map (math symbol → sympy/MATLAB/Wolfram, the executable bridge)
       ▼
  GLOSSARY + ENTITIES    every canonical equation & concept becomes a glossary entry (name→def+form) AND a
                         graph entity (linked to topic, domain, course, Wikidata) → concept-defs + the KG
```

## How a piece of gold text flows
1. A gold chunk (e.g., an 8.01 exam problem) is **classified to its domain + course + topics**.
2. That selects the **domain lookup**: the canonical equations/terms expected for those topics + course level.
3. The chunk's formulas/terms **fuzzy-link** to the canonical hierarchy (cross-course consensus for the form).
4. The matched canonical equations/concepts are **grounded** (AP seed → Wikidata/Wikipedia symbol-verify →
   symbol-map executable form).
5. Those grounded equations + concepts **flow into the glossary** (name → definition + clean form) and the
   **entity graph** (equation/concept nodes, edges to topic/domain/course) — so retrieval, the note card,
   compute, and Think-on-Graph all draw from the same recovered, verified knowledge.

## Two recovery problems (the per-course scorecard proved both)
- **Extraction mangling** — `F=m!a!`, flattened 2D math → fix at the source with **Marker/Nougat** (PDF→LaTeX).
- **Canon coverage** — the corpus is MIT-*graduate*; the AP canon is *intro*. Grad courses recover 0% because
  their equations aren't seeded. Extend the canon to graduate topics, built from Wikipedia/DBpedia, **tiered**:
  AP for intro/eval, grad references for advanced courses.

## The pieces (built) and where they sit
| component | layer | status |
|---|---|---|
| `canon/canonical-equations.json` | canonical hierarchy (seed) | ✓ AP/SAT, per-domain, topic-tagged |
| `canon/symbol-map.json` | grounding → executable | ✓ symbol → sympy/MATLAB/Wolfram |
| `clean-formulas.py` | gold → canonical link | ✓ CPU signature fuzzy-link |
| `validate-canon.py` | grounding (verify) | ✓ Wikidata P2534 (sparse → +Wikipedia fallback) |
| `course-consensus.py` | cross-course recovery | ✓ course-spread separates equations from artifacts |
| `course-recovery.py` | per-course scorecard | ✓ which classes failed (→ grad-coverage gap) |
| `grow-canon.py` | canon growth | ✓ recover+verify+add (works post-re-extraction) |
| `build-notecard.py` | note card | ✓ raw miner |
| `concept-defs.ts` | glossary | ✓ exists; **wire canon → glossary** (TODO) |
| `graph-ppr.ts` / `cskg.ts` | entity graph | ✓ exist; **wire canon → entities** (TODO) |
| Marker/Nougat re-extract | extraction fix | **TODO — the structural lever** |
| course→topic map + grad canon tier | coverage | **TODO** |

## Build order
1. **(C) Intro/eval focus** — recover the intro courses that match the MMLU board (AP canon + course→topic),
   feed the note card + compute. Smallest lever that moves the actual eval.
2. **canon → glossary + entities** — emit every grounded canonical equation/concept into concept-defs and the
   KG (this message's ask: "make it to the glossaries and entity extractions").
3. **(A) Marker/Nougat re-extraction** — structural recovery across the whole corpus (GPU).
4. **(B) Graduate canon tier** — Wiki/DBpedia-built references for the advanced courses; grow continuously.

KPI throughout: per-domain and per-course **recovery rate** (currently ~0.4% — our failure to recover MIT, not
MIT's failure). Drive it up. Keep going.
