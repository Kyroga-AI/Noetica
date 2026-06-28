# Biperpedia-style semantic search & graph-aware retrieval — design

**Status:** draft / design — 2026-06-24
**Owner:** Michael
**Thesis:** Local model size is a commoditizing, RAM-bound, losing axis. The graph (HellGraph + GAIA + GDS) is the only thing competitors don't have. So we **win on retrieval, not on model size** — a great retrieval layer lets a small fast model (qwen3:8b) punch far above its weight. This is the Biperpedia insight: structure the knowledge well enough and the generation step gets easy.

This doc covers two asks:
1. **Non-KB search** (web / external results, when we're *not* generating or retrieving from our own KB): apply Biperpedia-like entity→attribute semantic structuring to results instead of flat keyword ranking.
2. **KB retrieval**: same semantic structuring, **plus** "bring up the right stuff in the graph" — traverse the entity neighborhood, not just return cosine-nearest chunks.

---

## 1. Background: what Biperpedia actually was

Google's Biperpedia (2014) mined an ontology of ~1.6M **attributes** (entity → attribute → value) from the query stream + web text, with **attribute synonyms** ("CEO" ≈ "chief executive" ≈ "who runs") and **attribute relationships**. It wasn't a model — it was a *schema for facts* that made lookup do the work generation would otherwise do. The lesson for us: invest in an **attribute layer over our entities**, not in a bigger LLM.

## 2. Current state — the bones already exist

| Capability | Where | State |
|---|---|---|
| Hybrid lexical+vector retrieval | `lib/hybrid-retrieve.ts` (bm25) + `lib/doc-store.ts` (cosine) | live |
| Multi-pattern retrieval (beliefs/graph/temporal/study-brain) | `lib/retrieval.ts` `retrieve()` | live |
| Graph neighborhood expansion (EXPAND→DEDUP→RANK→CAP) | **CairnPath**, `NOETICA_CAIRNPATH_RETRIEVAL=1` | **built, default OFF** |
| Graph analytics (PageRank/Louvain/betweenness) | `/api/graph/analytics` (GDS) | live |
| Stewardship ontology (entity types/relations) | **GAIA**, `/api/graph/ontology` | live |
| Entity recognition on ingest | `extractEntities` / `ingestEntities` (HellGraph) | live |
| Relevance floor (don't inject irrelevant context) | `extractive-qa.ts` `MIN_COVERAGE`; self-doc filter; general-lane skip | **just landed (#283)** |

**The gaps:** (a) no **attribute** layer — we have entities + relations, not "what attributes does this entity type have + their synonyms"; (b) graph-neighborhood expansion is **off**; (c) external/web results get **no** entity-attribute structuring.

## 3. Foundational fix (Phase 0) — embedder reliability

> Discovered 2026-06-24: the Rust `noetica-embed` sidecar runs healthy on **:8126**, but the live query-embed path (`embedText` in `lib/ollama.ts`) posts to **Ollama's `nomic-embed-text`** instead. Ollama cold-loads nomic on first use and times out at 8s → retrieval silently degrades to lexical-only and turns stall ~16-30s. **Retrieval quality and latency both gate on this.**

Action: route `embedText` to the Rust sidecar (:8126) as the primary, Ollama as fallback — **but only after confirming vector-space consistency**: stored chunk vectors must be embedded with the *same* model as query vectors. If `noetica-embed` uses a different model than `nomic-embed-text`, either (a) make the sidecar serve nomic, or (b) re-embed the corpus with the sidecar's model behind a version flag. This is a prerequisite — everything below assumes embeds are fast and reliable.

## 4. Design

### 4a. Query understanding: `query → (entity, attribute, intent)`
Extend the existing `intent-router` + `extractEntities` to also extract the **attribute** being asked about, then expand it via the attribute ontology's synonyms. Output a structured query:
```
{ entities: ["Hurricane Helene"], attribute: "year" (≈ "date","when"), intent: research_lookup }
```
This is the join point for both modes.

### 4b. The attribute ontology (the moat)
A new layer over GAIA: for each entity **type**, the attributes it can have, their synonyms, value types, and relationships.
- **Schema:** `AttributeNode { name, synonyms[], valueType, appliesToTypes[], relatedAttributes[] }` as first-class HellGraph atoms, so PLN/ECAN can revise/decay confidence like any other knowledge.
- **Mining sources (sovereign, no query stream):** (1) the user's own corpus + chat history (what attributes they actually ask about), (2) structure already in ingested docs (headings, tables, key:value), (3) GAIA's relation vocabulary as a seed, (4) optional one-time bootstrap from an open attribute set. Mine offline, like the brain corpus.
- **Use:** synonym expansion at query time; "adjacent attributes you'll ask next" as follow-up suggestions; column structure for result clustering.

### 4c. Mode 1 — external/web results (non-KB)
When answering from web search (not KB): don't return a flat ranked list. **Cluster results by `(entity, attribute, value)`** and rank by attribute relevance to the parsed query. Surface the *answer* (the value for the asked attribute) up top, with adjacent attributes as structured context. Reranking runs on the fast local model + embeddings; no extra cloud calls.

### 4d. Mode 2 — KB retrieval + graph neighborhood
Today: cosine-nearest chunks (+ crude `flat-0.7 BFS`). Target: hybrid retrieve **then** expand into the graph via **CairnPath** (EXPAND→DEDUP→RANK→CAP) — once a query hits an entity node, pull its GDS-ranked neighborhood (relations, co-occurring entities, connected chunks) so the answer carries the *connected* context, not just the lexically-nearest passage.
- **Turn CairnPath on by default**, gated by a **relevance floor** (we just learned the hard way that injecting low-relevance graph context makes the model anchor/refuse — see #283). Only inject expanded nodes whose score clears the floor; cap the count.
- Rank expanded neighbors by GDS importance (PageRank) × query relevance.

## 5. Phased plan

- **Phase 0 — foundational (do first):** embedder reliability (§3) + the relevance-floor principle everywhere (partly landed in #283). *Without fast/reliable embeds, none of the rest feels good.*
- **Phase 1 — cheap, high-value:** flip CairnPath graph-neighborhood **on by default** with a relevance floor + GDS-importance ranking. Code largely exists; this is "bring up the right stuff in the graph" with low new surface area.
- **Phase 2 — the moat:** build the attribute ontology (§4b) + `query→(entity,attribute)` understanding (§4a), then apply it to web-result reranking (§4c) and KB retrieval (§4d).

## 6. How this resolves the other two strategy questions

- **Model:** with retrieval this good, an 8b interactive model is *enough* — you're not settling, you're moving the intelligence into the layer you own. (Tiering landed in #283: 8b interactive / 14b reasoning+code.)
- **On-device vision:** a wash *as understanding*, a win *as OCR* — use native macOS Vision for text-from-image, make general VLM understanding cloud-augmented. Orthogonal to this retrieval work.

## 7. Open questions / risks
- **Vector-space consistency** is the gating risk for §3 — must verify before switching embedders.
- **Attribute mining without a query stream** — our sovereign constraint means we mine from the user's own corpus/chats + doc structure; quality scales with usage. Acceptable; it compounds.
- **Relevance-floor tuning** — too high starves grounding, too low re-introduces the #283 over-anchoring. Make floors env-tunable + measured against a small eval set.
- **Graph noise** — HellGraph is currently dominated by dev/test exhaust ([[noetica-graph-gds]]); neighborhood expansion must run over a clean-set or it surfaces junk.
