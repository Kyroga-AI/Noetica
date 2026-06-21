# Operational Knowledge Tier — troubleshooting the platform

**Status:** Plan. To troubleshoot the estate, the agent needs three connected tiers, not one.
The estate is already RDF (sociosphere.ttl + ontogenesis), which maps natively to the atomspace
— so we import the TTL as the skeleton and attach docs + academic knowledge to it.

---

## Three tiers, one graph

| tier | scope | what | source (mostly exists) |
|---|---|---|---|
| **ESTATE** | `estate` | what's deployed: repos × techStack × up/downstream contracts × component × governance | **sociosphere.ttl** (workspace ontology) + **ontogenesis** (Domains: kubernetes, cyber, security-tools…) |
| **OPERATIONAL** | `ops` | how the tools work: man pages, language/protocol/platform docs, design docs/ADRs | **NEW capture** (man pages local; docs/specs pulled) |
| **GOLDEN** | `brain` | the academic principles | OCW brain (see golden-vectors-atomspace.md) |

They connect through the **academic-domain** axis: a tool → its domain → the golden education.

---

## The estate is already RDF — import it, don't rebuild it

`sociosphere.ttl` (`ss:` ontology) models `Repository` / `RepoRole` with `role`, `org`,
`techStack`, `upstreamContract`, `downstreamContract`, `pinnedRev`, `glossaryRef`,
`governanceStatus`, `component`. `ontogenesis` adds the layered domain ontology (Upper/Middle/
Lower/Domains; System-architecture, Registries, Action-ontology, KG-lifecycle, Semantic-mapping).

**RDF ↔ atomspace is direct:** triple → atom+link, `owl:Class` → ConceptNode, `techStack`/
`*Contract`/`component` → typed links. So: **import the TTL as the structural skeleton**, then
the OPERATIONAL doc vectors and GOLDEN education attach to the matching nodes. The atomspace is a
graph DB *and* a vector store — the TTL gives the graph, the docs/education give the vectors.

---

## What to capture (the operational layer)

The tech stack is *already enumerated* in `techStack` (Python, TypeScript, Go, Rust, TOML, JSON,
YAML, …) and the `mcp-a2a-zero-trust` component, so capture is scoped to the real estate:

1. **man pages** — 1,169+ on the box: `/usr/share/man/man{1,2,3,5,7,8}` (CLIs, syscalls, configs,
   protocols, daemons). The immediate operational reference.
2. **language docs** — official + stdlib/API for the estate languages (Python, TS, Go, Rust).
3. **protocol specs** — RFCs / specs for the protocols in use (HTTP, gRPC, TLS, **MCP/A2A**,
   RDF/SPARQL/SHACL, etc.).
4. **platform docs** — GCP, Kubernetes, Docker, Ollama, Tauri.
5. **design docs / ADRs** — the estate's own `docs/` + ADRs (already local).

Pipeline: extract → chunk → embed (same nomic) → tag → atomspace `scope:"ops"`.

---

## Tagging (extends the schema)

Each ops chunk carries: `tier: operational`, `subject` (tool/lang/protocol, e.g. `gcloud`,
`tcp`, `typescript`), `man_section` (1/2/3/5/7/8 if applicable), `domain` (academic — maps to
ontogenesis + golden), `knowledge_type`.

**One honest extension:** the ARC 7-type taxonomy is for *science questions*; troubleshooting docs
are mostly **how-to**, which ARC lacks. Add an **8th type: `Procedural`** (how to do X / use a
flag / fix an error) → routes to the **ops retrieval + the verified-compute/chain** for multi-step
fixes. Definition/BasicFacts still cover "what is X / what does flag Y do."

### Tool → academic domain (the bridge)
`gcloud`/`kubectl` → distributed systems · `tcp`/`http`/`tls` → networking · TypeScript/Rust →
PL/compilers (→ SynapseIQ) · RDF/SPARQL/OWL/SHACL → knowledge representation · Postgres → databases
· crypto/TLS → cryptography · ollama/embeddings → ML. Each domain links to the golden EECS/math
education *and* the ontogenesis domain ontology.

---

## Troubleshooting flow (what this buys the agent)

```
  symptom → ESTATE (sociosphere): which component · its techStack · up/downstream contracts
         → OPERATIONAL (ops): man pages + docs for those tools — the immediate "how it works / fix"
         → GOLDEN (brain): the academic principle behind it (networking, crypto, PL…)
         → verified fix: cite the man page / spec; chain multi-step via the Procedural router
```
The TTL contracts make it *causal*: a downstream failure walks `upstreamContract` to find the
real culprit, not just the symptom.

---

## Phases

1. **Import the estate TTL** (sociosphere + ontogenesis) into the atomspace as the skeleton —
   ConceptNodes for repos/components/tools, typed contract links.
2. **Capture man pages** (local, fast) → `scope:"ops"`, tagged subject/section/domain/`Procedural`.
3. **Capture the stack docs + protocol specs** for the enumerated techStack; attach to the matching
   estate nodes via `documents` links.
4. **Bridge to academic domains** — `tool --domain--> ConceptNode` shared with the golden tier.
5. **Wire the troubleshooting walk** — symptom → component → contracts → docs → principle, cited.

## Guardrails (carried through)
- **Cite the source** — every fix points to the man page / spec / ADR it came from.
- **Describe, don't control** — the KB diagnoses and proposes; it does not execute changes on the
  estate. (Same `controlAuthority` discipline as PROMETHEUS.)
