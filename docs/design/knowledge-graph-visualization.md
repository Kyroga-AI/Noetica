# Knowledge graph visualization — design reference

Source: [`components/graph/SurfaceGraph.tsx`](../../components/graph/SurfaceGraph.tsx)

This is the rendering behind every knowledge-graph view in the app (sidebar mini-view, the
full-page Knowledge Graph explorer, and the Operate surface). One component, three call sites,
different chrome around it. Written for design/UI reference when building the new skin around
this visualization — it documents *how it renders today*, not a spec for how it should look.

## How it renders

**No charting library** — it's a hand-rolled SVG force simulation (no D3, no Canvas). Everything
is plain React state + `requestAnimationFrame`.

### Data in
Fed by `/api/graph/surface` (and `/api/graph/analytics` for the optional metrics overlay). Two shapes:
```ts
GraphNode { id, label, category, kind?, featured?, degree?, grounded? }
GraphLink { source, target, primary?, epistemic?, dimension? }
```

### The physics (per animation frame)
1. **Charge repulsion** — every node pushes every other node away (O(n²), fine ≤120 nodes).
   Featured nodes push harder (4400 vs 2900).
2. **Link springs** — connected nodes pull toward a target distance (200px for "primary" edges,
   150px otherwise).
3. **Anchor + centering** — layout-seeded nodes (radial/hierarchy modes) get pulled toward their
   seed position; everything drifts gently toward canvas center.
4. **Collision** — overlapping nodes push apart.
5. Velocity decays each frame (`0.6`), simulation "cools" via an alpha decay (`0.0228`) until it
   settles.

### Layout modes (`layout` prop)
- **`force`** — pure organic settling, no seed position
- **`radial`** — BFS distance rings from the most-connected node
- **`hierarchy`** — top-down BFS layers (like an org chart)

### Color system (three independent schemes, pick one)
- **By entity class** (`KIND_COLOR`) — Concept=violet, Action=orange, Document=blue, Code=blue,
  Service=teal, Session=amber, Person=pink, Org=purple, Entity=green, Cluster=red
- **By community** (`COMMUNITY_COLORS`) — 12-color cycling palette for Louvain graph-clustering
  output
- **Edge color by semantic dimension** (`DIM_COLOR`) — taxonomic/causation/temporal/etc., 14
  distinct hues so relationship *type* is visually scannable, not just presence

### Visual encoding on top of position/color
- **Node size**: either fixed by `degree` (bigger = more connections) or `sqrt(pagerank)` for an
  "importance" mode
- **Glow filter** (`spNodeGlow`, Gaussian blur + merge) on every node — soft halo, not flat circles
- **Bridge ring**: dashed cyan ring around high-betweenness "connector" nodes
- **Canon ring**: solid violet ring for nodes grounded in the authored knowledge base
- **Path highlight**: gold ring + thick gold edges for a shortest-path chain between two selected
  nodes
- **Inferred edges**: dashed + 45% opacity (vs solid/80% for confirmed) — trust level is visible,
  not hidden
- **Labels**: featured/hub nodes show full text; small nodes get a "disemvowelled" abbreviation
  (`customer_data` → `custmr_dta`) so labels never truncate mid-word

### Interactions
- **Drag** a node → pins it (`fx`/`fy`) exactly where dropped; pulling a cluster apart keeps it
  apart
- **Click** (no drag) → drill-down callback (`onNodeClick`)
- **Wheel** → zoom toward cursor, clamped 0.4×–6×
- **Drag empty space** → pan
- **Double-click empty space** → releases all pins + resets zoom/pan

### Where it's embedded
Three call sites, same component, different chrome around it:
[`GraphRailPanel.tsx`](../../components/rail/panels/GraphRailPanel.tsx) (sidebar mini-view),
[`KnowledgeGraphSurface.tsx`](../../components/surfaces/KnowledgeGraphSurface.tsx) (full-page
explorer with filters/legend/proposals), and
[`OperateSurface.tsx`](../../components/surfaces/OperateSurface.tsx).
