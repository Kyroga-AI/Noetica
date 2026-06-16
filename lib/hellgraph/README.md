# HellGraph

Sociosphere's graph substrate and the system-of-record for **all** of Noetica:
conversations, messages, memory-mesh entries, evidence, sessions, models, and
SAE features live here as one typed metagraph. The chat thread *is* a subgraph;
"related" and recall views are queries; the Operate health panel is one read off
it.

## Model: a typed metagraph (OpenCog AtomSpace–compatible)

The canonical core (`atomspace.ts`) is **not** a binary graph — it is a
hypergraph + metagraph:

- Everything is an **Atom**, interned by content (structural hashing), so
  identical atoms collapse to one handle — uniqueness is guaranteed and
  ingestion is idempotent.
- A **Node** is `(type, name)`. A **Link** is `(type, ordered outgoing[])`.
  Links may point at other Links → arbitrary arity (hyper) over edges (meta).
- Every atom carries **Values**: a `TruthValue` (PLN), an `AttentionValue`
  (ECAN), and an arbitrary key→value store.
- An **incoming-set** index powers traversal and pattern matching.
- A **type-inheritance lattice** lets queries match by supertype.

RDF and property graphs are strict *subsets*, so they become projections:

```
binary edge   →  EvaluationLink( PredicateNode(label),
                                 ListLink( ConceptNode(from), ConceptNode(to) ) )
node labels   →  string Value "graph:labels"
node/edge props → Values "prop:<key>"
RDF triple    →  (from, predicate, to) read off EvaluationLinks
```

## Layout

| File | Role |
|---|---|
| `atomspace.ts` | Canonical metagraph: Atom model, interning, incoming set, type lattice, TruthValue/AttentionValue, append-only log + replay |
| `store.ts` | Binary labeled-property-graph **façade** over the AtomSpace (no independent state) |
| `types.ts` | Shared types (GraphNode/GraphEdge/Triple/LogEntry, query results) |
| `sparql.ts` | SPARQL 1.1 subset evaluator over the triple projection (Neptune/Blazegraph parity) |
| `gremlin.ts` | Gremlin/TinkerPop traversal engine over the property-graph projection |
| `patternMatcher.ts` | Native hypergraph Pattern Matcher (typed variables, conjunctive joins) — subsumes SPARQL BGP |
| `atomese.ts` | S-expression codec — lossless round-trip with real OpenCog |
| `ingest.ts` | Project Noetica activity (interactions, conversations, messages, memory) into the metagraph |
| `health.ts` | Derive live `GraphHealthStatus` / `TimeServiceStatus` from the store |
| `sidecar.ts` | HTTP client for the OpenCog sidecar (PLN/ECAN/Pattern Matcher) |
| `cogserver.ts` | Direct TCP federation with a running OpenCog CogServer |

## Three coequal query surfaces, one graph

```
POST /api/graph/query   { language: 'sparql',  query }
POST /api/graph/query   { language: 'gremlin', query }
POST /api/graph/query   { language: 'pattern', pattern }   # native hypergraph
GET  /api/graph/health                                      # live operational status
GET/POST /api/graph/atomese                                 # export / import Atomese
POST /api/graph/reason  { op: health|sync|pattern|pln|ecan } # OpenCog sidecar
POST /api/graph/ingest                                       # ingest one interaction
```

## OpenCog integration

Two federation paths, both lossless via Atomese:

1. **Sidecar** (`opencog-sidecar/`) — embedded real AtomSpace + PLN/ECAN/URE over
   HTTP. Preferred for reasoning. See that folder's README.
2. **CogServer** (`cogserver.ts`) — direct TCP Scheme protocol with an
   already-running OpenCog. No Python process.

Both degrade gracefully: if neither is online, HellGraph still serves storage,
SPARQL, Gremlin, and the TS Pattern Matcher.

## Durability

The AtomSpace is backed by an append-only JSONL log at
`~/.noetica/hellgraph/<space>.atomspace.jsonl`. The log is the source of truth;
in-memory indexes rebuild from it on boot, and the logical clock (sequence
number) is the Time Service's basis for point-in-time replay.
