# Graph intelligence: composable query algebra, bounded rendering, structural motifs

**Status:** draft / design — 2026-06-24
**Owner:** Michael
**Why now:** We have a graph (HellGraph + GDS + GAIA) but we're using it ad-hoc. To be smart we need three things we don't have: a **composable query layer** (primitives that combine), **bounded visualization** (never render 10M), and **structural pattern detection** (shapes that signal meaning). This doc frames all three.

---

## Graph-first: ingestion + exploration as a PRIMARY surface (not a chat side-panel)
The product is not "a chat app with a graph widget" — people want to **load knowledge and explore it as a graph**. Two pillars:

**1. Non-blocking bulk ingestion (step 1 BUILT — `lib/ingest-queue.ts`, `/api/ingest/queue` + `/api/ingest/status`).** Drag in a folder of docs and keep working — each upload enqueues instantly and a background worker parses/chunks/embeds/grounds it serially, reporting per-doc status (`queued → parsing → ingesting → done/failed`, with chunk + entity counts). The UI surfaces this as:
- an **upload table / queue** (filename · status · chunks · entities · error) that fills in live as docs complete, and
- a **parsed-vs-pending overlay on the graph** — done docs appear as real nodes; queued/parsing ones show as ghost/placeholder nodes so you can *see* the graph growing.

Remaining for this pillar: the frontend table + overlay (consumes the two endpoints above); a disk-backed spool for very large bulk imports; optional parallelism once embeds move off Ollama (see [[noetica-embedder]]).

**2. A graph EXPLORER ("Graph Studio") as a first-class workspace.** The graph gets its own surface (like Notes/Canvas), not just the chat sidebar: load → see it grow → query it with the algebra below → filter/group/aggregate → spot motifs → clean orphans. The chat becomes *one* way to talk to the graph; direct manipulation is the other.

*How others do it (the patterns to steal):*
- **Obsidian graph view** — the gold standard for personal-knowledge exploration: a *local* graph (the neighborhood around the current note) AND a *global* graph, color/group by tag/folder, a depth slider, and filters. Lesson: local-neighborhood view + global view are different tools; ship both.
- **Neo4j Bloom** — a dedicated visual app: *search-to-graph* (type an entity, it seeds the canvas), *expand* a node's neighborhood on double-click, and **"perspectives"** = saved views scoped by entity type/category with per-type styling. Lesson: saved perspectives/lenses by type are what make a big graph navigable.
- **Linkurious / GraphXR / Memgraph Lab / Kùzu Explorer** — enterprise investigation: a query editor beside the canvas, timeline + geo overlays, layout controls, and analytics (centrality/community) as visual overlays. Lesson: pair a canvas with a query panel and analytics overlays.
- **Gephi / Cytoscape** — offline analysis studios: layout algorithms + metrics + filters. Lesson: layout + metric overlays matter for sense-making.

The common shape is always the same and it is NOT a sidebar: **search → seed → expand**, **saved perspectives/lenses** (by type/community), a **filter/query panel**, **bounded layout + rendering**, **analytics/motif overlays**, and **direct manipulation** (click → inspect → edit/merge/delete). Our Graph Studio = that shape, powered by the query algebra, bounded rendering, and motif detection in the rest of this doc, with the ingestion queue/table built in (drop docs → watch them land as nodes). The chat's existing side-panel becomes the *mini-map*; the Studio is the full workspace.

## The core idea: a graph query ALGEBRA, not one-off queries
Today each graph question is bespoke. Instead, expose a small set of **primitives that compose** — so "the known questions people ask" become one-liners built from the same parts, and new questions are just new compositions.

### The primitives (the basis)
| Primitive | Meaning | Backed by |
|---|---|---|
| `type(T)` / `class(C)` / `family(F)` | filter to an entity type / GAIA class / family | GAIA ontology |
| `where(prop, op, val)` | property predicate (confidence > 0.5, created_at > …) | atom properties |
| `neighbors(seed, depth, rel?)` | traverse the neighborhood | CairnPath EXPAND→DEDUP→RANK→CAP |
| `path(a, b)` | shortest/least-cost path | graph BFS |
| `rank(metric)` | order by centrality (pagerank/betweenness/degree) | **GDS (already live)** |
| `community()` | partition into clusters | **Louvain (already live)** |
| `count()` / `sum(prop)` / `groupBy(dim)` | aggregation | reducer over the result set |
| `match(motif)` | structural pattern (hub/bridge/clique/cycle/orphan) | motif detector (new) |

### Composition is the point
```
class('Person').rank('pagerank').top(20)                  // key people
type('Concept').community().count()                       // concepts per cluster
neighbors('Hurricane Helene', 2).type('Document')         // docs near an entity
groupBy('type').count()                                   // the type histogram (also feeds the timeline)
match('bridge').where('betweenness', '>', 0.4)            // critical connectors / single points of failure
type('*').where('degree','==',0)                          // orphans to clean
```
Each returns a node/edge set + scalars, so they pipe. This is the layer that makes the graph *usable* and is the join point with the Biperpedia attribute work ([[biperpedia-search-design]]).

### A catalog of "known questions" (built FROM the primitives)
Ship these as named, one-click queries (and let the agent call them as tools):
- **Key entities** = `rank('pagerank').top(N)`
- **Communities / themes** = `community()` (the 7 we already show)
- **Bridges / load-bearing nodes** = `rank('betweenness').top(N)`
- **Orphans / dangling** = `where('degree','==',0)` → the cleanup queue
- **By type / class / family** = `groupBy('type')` etc.
- **Knowledge gaps** = `where('confidence','<',θ)` or ungrounded entities
- **Hubs** = `where('degree','>',θ)` → over-connected (often noise/exhaust)
- **Recent growth** = `where('created_at', 'in', window).groupBy('type')` → feeds the timeline striations

## Bounded visualization (never render the whole graph)
The graph is dominated by dev/test exhaust ([[noetica-graph-gds]]) and will only grow. The viz must be **resolution-bounded**:
- **Hard cap** rendered elements (e.g. top-N by importance for the current filter); show "showing 200 of 7,908 — zoom/filter to refine". Never feed 10⁶ edges to the renderer.
- **Semantic zoom / LOD:** at low zoom render **community super-nodes** (one node per Louvain cluster, sized by membership); expand a cluster into its members on zoom-in or click. This is how you keep it legible at any scale.
- **Bounded zoom controls:** min/max zoom clamp, "fit to bounds", and zoom-to-selection — instead of the current unbounded mouse-wheel (the "wild west"). Pan bounded to content + margin.
- **Edge budgeting:** when an edge type would exceed the budget, aggregate parallel/weak edges into a single weighted edge.

## Structural pattern detection (shapes that signal things)
The topology *is* the insight. Detect motifs and map them to meaning:
| Motif | Structural signature | What it signals |
|---|---|---|
| **Hub** | very high degree | a key concept — or exhaust/noise if degree is pathological |
| **Bridge / cut-vertex** | high betweenness, removal disconnects | a critical dependency / single point of failure |
| **Clique / dense community** | high local clustering | a tight topic or a duplicated cluster to merge |
| **Star** | one center, many leaves | a source doc and its projections |
| **Chain** | low-degree path | a reasoning/derivation lineage |
| **Orphan / island** | degree 0 or tiny disconnected component | ungrounded knowledge → cleanup |
| **Anomaly** | degree/centrality outlier vs its class | something worth a human look |
Surface these in the "Knowledge Health" panel as *insights* ("3 bridges, 41 orphans, 2 duplicate-looking cliques") with one-click actions (inspect / merge / delete / relabel) — which also answers the "can't click nodes to clean/sort" gap.

## Phasing
1. **Viz reliability (now):** bounded zoom (clamp + fit) + a hard render cap with a "showing X of Y" notice. Small, immediately felt, stops the wild-west zoom and the 10M-edge risk.
2. **LOD / semantic zoom:** community super-nodes that expand on zoom/click.
3. **Query algebra:** implement the primitive set + the named-query catalog over GDS/GAIA; expose as `/api/graph/query` + agent tools + UI chips.
4. **Motif detection + cleanup actions:** the insight panel + node/edge inspector with merge/delete/relabel.

## Open questions
- Run the algebra over a **clean-set** (exclude dev/test exhaust) by default, else every query surfaces junk.
- Where does the algebra live — server (`/api/graph/query`, reusable by agent + UI) or client? Server, so the agent can compose graph queries as tools.
- Motif thresholds must be **relative to class** (a "hub" among Documents ≠ among Concepts), and tunable.
