# Tiered memory: the world-class substrate for documents, knowledge, and retrieval

**Status:** draft / north-star architecture — 2026-06-25
**Owner:** Michael
**Why this doc:** Today documents live *inside* HellGraph as `DocumentChunk` atoms (text + 768-dim vector + provenance) right next to memory/knowledge. That's the root of the bloat (130 docs = 460 chunk atoms swelling the graph to 27k nodes), the O(n) `nodesByLabel('DocumentChunk')` scans on every retrieval, the pollution, and the contention that helped wedge Ollama under bulk load. This is the target architecture that fixes all of it at the foundation — the north star behind the Library, the embedder fix, the collection scopes, and the provenance/reasoning-mode work, so we stop patching toward it blind.

The shape is how the frontier actually does it (Microsoft **GraphRAG**, **HippoRAG**, **RAPTOR**, LightRAG) — and we already own ~80% of the primitives, so this is *assembly*, not invention.

---

## 1. The principle: separate tiers by what each is good at
Heavy + flat (chunks, vectors) belong in a store built for approximate-nearest-neighbour recall. Sparse + structured (entities, relations, claims) belong in a graph. The document becomes a *thin bridge node* between them. Provenance binds every layer.

```
RAW        content-addressed blob store — immutable original bytes; re-derive anything   [HAVE: blob-store.ts]
VECTORS    per-collection ANN index — chunk text + embeddings; fast semantic recall      [BUILD: extract from graph]
GRAPH      entities · relations · claims · memory — the REASONING layer (HellGraph)       [HAVE: AtomSpace, demote docs]
SUMMARIES  chunk → doc → collection → community — hierarchical, for global questions       [BUILD: on Louvain]
```

**The single highest-leverage change:** pull chunks + vectors OUT of HellGraph into a per-collection ANN store. The graph keeps only a lightweight `Document` node (filename, scope, metadata) + the extracted entities/relations. Effects:
- **Bloat/pollution gone** — the knowledge graph stays clean; chunks don't drown it.
- **Speed** — per-collection ANN index instead of scanning every atom (kills the O(n) pattern that helped the wedge).
- **Scoping is native** — collections map 1:1 to per-collection indexes; deleting a collection = dropping its index.
- **Pairs with the embedder fix** — vectors flow from the Rust `noetica-embed` sidecar into the doc store, off Ollama entirely (ends the embed↔generate contention).

## 2. Retrieval — the fused, multi-signal pipeline (where world-class lives)
Not flat vector RAG. Per query:
1. **Query → entities** (extractEntities) + the parsed (entity, attribute, intent) — the join with [[biperpedia-search-design]].
2. **Three retrievers in parallel, scoped to the active collection(s) + core:**
   - **Dense** — vector ANN over the scoped chunk index.
   - **Sparse** — BM25 (have: hybrid-retrieve.ts).
   - **Graph multi-hop (HippoRAG)** — *personalized PageRank from the query's entities* across the knowledge graph to pull in multi-hop-connected facts a vector search structurally can't reach. **Have: PageRank (GDS).**
3. **GraphRAG community summaries** for GLOBAL questions ("the theme across all these docs") — summarize **Louvain communities** offline; local questions hit chunks, global hit community summaries. **Have: Louvain (GDS).**
4. **Reciprocal-rank fusion → rerank** (have: reranker) → answer **with provenance + stated/inferred/deduced/retrieved labels** (the moat; see §5).

## 3. The living layer — what makes it MEMORY, not a search index
World-class memory is not static:
- **Entity resolution on ingest** — "Joseph's mother" in doc A = doc B → one canonical entity (fix the dedup + the broken Document→entity `GROUNDS` linkage that makes the Library show 0 entities/doc).
- **Decay** unused atoms — **have: ECAN.**
- **Consolidate** successful patterns — **have: the learning loop (eval-capture + procedural-memory).**
- **Refresh communities** incrementally as the graph grows.
This is the "dreaming / decay / consolidation" frontier (see [[noetica-competitive-gaps-2026h1]]) — the machinery already exists.

## 4. Where we are now (inventory — so the path is real, not aspirational)
| Tier / capability | Status |
|---|---|
| Raw blob store (content-addressed, encrypted) | ✅ have (`blob-store.ts`) |
| Chunk + vector storage | ⚠️ as graph atoms (`DocumentChunk`) — the thing to extract |
| Knowledge graph (entities/relations) | ✅ HellGraph AtomSpace |
| Entity→doc linkage (`GROUNDS`) | ❌ broken (interned entities, no per-doc edge) → Library shows 0 entities/doc |
| ANN index (HNSW) | ❌ none — vector search scans atoms |
| Hybrid sparse (BM25) | ✅ have |
| Graph centrality (PageRank/betweenness) | ✅ GDS |
| Community detection (Louvain) | ✅ GDS |
| Community summaries (RAPTOR/GraphRAG) | ❌ build on Louvain |
| Reranker | ✅ have |
| Decay / attention (ECAN) | ✅ have |
| Consolidation (learning loop) | ✅ have |
| Embedder off Ollama (Rust sidecar) | ⚠️ exists (:8126) but retrieval still uses Ollama nomic |
| Collection scopes | ✅ just shipped |
| Provenance + reasoning-mode labels | ⚠️ pieces (rag-trust, retrieval traces); not unified |

## 5. The unfair advantage — don't copy GraphRAG, beat it
Every frontier RAG has vectors + a graph. **None has a neurosymbolic reasoning layer (AtomSpace + PLN deduction + ECAN attention) or per-fact provenance, fully local + sovereign.** The world-class move for *us*:
- Vector store → fast recall.
- Graph → what only a graph can do: **symbolic multi-hop reasoning + PLN deduction + attention-decay.**
- **Provenance + reasoning-mode labels** bind it: every answer is *"retrieved from node X / deduced via rule Y,"* verifiable — the moat the pitch review flagged as the real differentiator.

"GraphRAG + HippoRAG + a real symbolic reasoning layer + provenance, 100% on-device" is a thing **no one ships.**

## 6. The phased path (from here to the north star)
1. **Foundation — embedder consolidation.** Route ALL embeds (ingest + query) through the Rust `noetica-embed` sidecar (one model, one vector space); re-embed the corpus behind a version flag. Ends the Ollama contention/wedging at the source. ([[noetica-embedder]])
2. **Extract the vector tier.** Move chunk text + vectors out of HellGraph into a per-collection ANN store (HNSW). `Document` becomes a thin graph node + a pointer to its chunk index. Retrieval reads the ANN store, not atoms.
3. **Fix entity resolution + the `GROUNDS` linkage.** Per-doc entity edges so the Library shows entities-per-doc and the graph traversal works.
4. **Fused retrieval.** Dense + BM25 + HippoRAG PageRank → RRF → rerank, scoped by collection.
5. **Hierarchical summaries.** Community summaries on Louvain → global-question answering (GraphRAG).
6. **Unify provenance + reasoning-mode labels** across the answer path (the moat made whole).

Each step is independently shippable and each removes a class of bug we've been firefighting. Steps 1–3 alone fix the bloat, the speed, the wedging, and the Library's entity gap.

## 7. Open questions / risks
- **Which ANN store** — embedded (sqlite-vec / usearch / a small Rust HNSW beside `noetica-embed`) to stay sovereign + zero-dep, vs. a heavier lib. Prefer embedded + Rust-native (matches the embedder sidecar).
- **Migration** — existing `DocumentChunk` atoms must move to the vector store without losing retrieval; do it lazily (read-from-both during transition) like the at-rest encryption migration.
- **Graph–vector consistency** — the `Document` node, its chunks (vector store), and its entities (graph) must stay in sync on delete/re-ingest; the collection scope is the unit of consistency.
- **Don't over-build** — world-class is the PRINCIPLE (separated tiers + fused retrieval + living maintenance + provenance), not "ship all six steps at once." 1–3 are the foundation; 4–6 compound.

Related: [[graph-intelligence-design]] (query algebra + explorer over this substrate), [[biperpedia-search-design]] (the attribute layer feeding query→entity understanding), [[noetica-embedder]] (the foundational embed fix), [[noetica-chat-refusal-and-oom]] (why the all-in-graph model bit us).
