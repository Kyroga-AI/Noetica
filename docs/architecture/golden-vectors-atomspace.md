# Golden Vectors in the Atomspace — education brain vs. chat

**Status:** Design (settled direction). The OCW education vectors are a *golden* knowledge
tier and must live in a separate space from chat/working memory. This doc fixes how they sit
in hellgraph's atomspace and how retrieval uses them.

---

## The principle

The education vectors (MIT-OCW brain) and chat vectors are different *kinds* of memory.
Mixing them in one vector pool degrades both. Keep them in **separate scopes**, bridged by a
shared **concept ontology** — grounded by graph edges, not by vector proximity.

| | GOLDEN tier (education) | WORKING tier (chat) |
|---|---|---|
| scope | `brain` | `chat:<session>` |
| atom label | `DocumentChunk` | `EpisodicChunk` |
| lifecycle | **immutable**, computed once | mutable, churns |
| truth value | high confidence, fixed | contextual |
| attention | persistent (no decay) | episodic decay |
| provenance | citable MIT source | hearsay until grounded |
| role | what the agent *studied* | what it's *doing now* |

Why the split is correct, not just tidy:

1. **Trust/provenance** — a golden vector is a citable source (course · material · slug); an
   answer can say "per 18.06 lecture notes." Chat is hearsay until grounded.
2. **Retrieval quality** — the education space has real per-domain structure (measured); chat
   is a different distribution. One kNN pool lets "something we said Tuesday" outrank the
   canonical source.
3. **Stability** — golden is computed once, immutable, portable (the brain-injection product
   edge). Chat decays. One index with two lifecycles is a maintenance trap.
4. **Cognitive correctness** — this is the **declarative/semantic vs. episodic/working**
   memory split real cognitive architectures keep separate. (And it maps to the matter/form
   spine: golden = the formed, actualized knowledge; chat = the working substrate that takes
   its form *from* it. See `agent-machine/scripts/intent_algebra_spine.md`.)

---

## Layout

```
  GOLDEN TIER  (scope "brain")               WORKING TIER  (scope "chat:<session>")
  DocumentChunk atoms                         EpisodicChunk atoms
  · immutable · high-conf TV                  · mutable · decaying attention
  · tags: source, domain, material, slug      · tags: session, turn, user
        │                                              │
        └──────────►  CONCEPT BRIDGE  ◄────────────────┘
              ConceptNode per canonical-22 domain
              + per governing model (23×6 / core_models)
        golden chunk --[member-of]--> ConceptNode
        chat ref     --[mentions]----> ConceptNode
```

The two tiers **never share a vector pool** — they share an *ontology*. A chat turn about
"eigenvalues" is not embedded next to the golden eigenvalue chunks; it gets a `mentions` link
to the `linear_algebra` ConceptNode, which is `member-of`-linked to the golden chunks.
Grounding by edge, not by proximity — this is the atomspace earning its keep over a flat
vector DB.

---

## Atom schema

**Golden chunk** (`DocumentChunk`, scope `brain`):
```jsonc
{
  "label": "DocumentChunk",
  "text": "...", "embedding": "<base64 f32 768>",
  "tier": "golden",
  "source": "ocw",
  "slug": "18-06-linear-algebra-spring-2010",
  "domain": "linear_algebra",          // canonical-22
  "material": "lecture|exam|solution|reference",
  "doc_id": "<slug>", "filename": "...", "chunk_index": 0,
  "tv": { "strength": 1.0, "confidence": 0.95 },   // high, fixed
  "av": { "sti": "persistent" }                     // never decays
}
```
**Working chunk** (`EpisodicChunk`, scope `chat:<session>`):
```jsonc
{
  "label": "EpisodicChunk",
  "text": "...", "embedding": "...",
  "tier": "working", "session": "...", "turn": 42, "user": "...",
  "tv": { "strength": 0.6, "confidence": 0.4 },
  "av": { "sti": "decaying" },
  "mentions": ["ConceptNode:linear_algebra"]        // the bridge
}
```
**ConceptNode** (the bridge): one per canonical-22 domain + per governing model; carries the
domain name and links to its golden members (`member-of`) and chat references (`mentions`).

---

## Retrieval policy

- **STEM answer** — domain-router picks the domain → `semanticSearch(scope:"brain", domain=X)`
  → **golden-only, cited**. Chat cannot pollute it.
- **Conversational recall** — `semanticSearch(scope:"chat:<session>")` only.
- **Grounded chat** — chat retrieval walks its `mentions` edges into the golden tier and
  weights golden hits above anything from the working tier.

Filter contract: every search takes `{ scope, tier?, domain?, material? }`. "golden physics
exams only" = `{scope:"brain", tier:"golden", domain:"physics", material:"exam"}`.

---

## How it plugs into the stack

- **domain_router** routes a query → the golden scope/domain.
- **core_models / the 23×6 grid** are ConceptNodes in the golden tier.
- **the verified-compute engine** cites golden sources for its inputs.
- Golden is the **declarative substrate**; chat is a thin, grounded, decaying overlay.

---

## Build order (when the brain finishes vectorizing)

1. `importBrainShard` the OCW brain into `scope:"brain"` with `tier/source/domain/material` tags.
2. Create canonical-22 + governing-model **ConceptNodes**; link golden chunks via `member-of`.
3. Keep chat in `scope:"chat:*"` with episodic decay; add `mentions` links.
4. Wire the retrieval filter contract (`{scope,tier,domain,material}`); router → golden-scoped, cited.

## What hellgraph already gives us vs. add
- **Have:** `importBrainShard`, `semanticSearch(q,k,embed,{scope})`, the `DocumentChunk` label.
- **Add:** the `tier/source/domain/material` tags + filter, the `EpisodicChunk` label with decay,
  the `ConceptNode` bridge + `member-of`/`mentions` links, and persistent vs. decaying attention.
