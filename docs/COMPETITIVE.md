# Noetica vs the Local-AI / RAG Field

> Honest head-to-head, June 2026. Competitor claims are web-verified and current; Noetica is graded against its actual code. Our gaps are marked, not hidden.

## The one-line pitch

**The only local-AI system that *proves* its computed answers. Everyone else gives you citations to check yourself.**

The entire field — from a 143k-star Open WebUI to the Perplexity king — shows you **where text came from**. None of them can show that an answer is **correct**. Grounding is not verification. That gap is structural, and it is ours alone.

## The empty column

Across **11 competitor systems** (Onyx, GraphRAG/LightRAG/HippoRAG, privateGPT, localGPT, OntoGPT, NotebookLM, AnythingLLM, Jan, Open WebUI, GPT4All, Perplexity), two capabilities are **❌ everywhere**:

| | Noetica | The entire field |
|---|---|---|
| **Verifiable / computed answers** (`replayClass=exact`, 49 verified operators) | ✅ | ❌ |
| **Governance / attestation of correctness** (hash-chained receipts, replayable, sealable) | ✅ | ❌ |

privateGPT's audit is **commercial-gated** (Zylon). localGPT's "verification" is an **LLM grading itself**. Perplexity's benchmarks are **self-published marketing**. OntoGPT grounds to an ontology — provenance, not proof. They all know verification is the frontier. **They're faking it. We compute it.**

## Where Noetica already wins on their turf (not just the moat)

- **The graph-RAG trinity in one governed runtime.** Microsoft GraphRAG's community summarization, HippoRAG's personalized-PageRank, *and* LightRAG's deferred query-time work — the research line ships these as three separate libraries you wire yourself; Noetica has all three behind one runtime, without GraphRAG's GPT-4 indexing cost.
- **Retrieval that beats the local-app crowd.** 3-signal fusion (semantic + BM25 + exact-term, RRF) with reranking — exceeds the single-stage cosine top-k of AnythingLLM/GPT4All/Jan, matches Open WebUI's hybrid+rerank, and adds a PoisonedRAG defense for free.
- **Adaptive (CRAG) retrieval.** Skips retrieval when the model is already confident — the measured fix where naive always-retrieve RAG *regressed* accuracy. No local-app peer does this; they all always-retrieve.
- **Encrypted vectors at rest** (AES-256-GCM) — defeats vec2text embedding inversion. "We only store embeddings" is a false privacy boundary everywhere else in the field.
- **A real, reproducible, multi-arm benchmark harness.** Onyx's is unreleased, NotebookLM's good numbers are third-party-informal, Perplexity's are marketing. Noetica measures itself, seed-pinned — and the benchmark is *itself* spec-conformant replayable evidence.
- **Reasoning over RAG for known facts.** No-retrieval CoT + self-consistency measured **+24pp** over baseline where RAG actively hurt — exactly how SOTA solves reasoning, which none of the RAG-only peers do.

## Honest gaps we're closing

| Gap | Reality | Move |
|---|---|---|
| One-click setup | AnythingLLM/Jan/GPT4All win the first 5 minutes; Noetica is dev-grade | **Ship the packaged desktop installer** + bundled Ollama + default brain. The moat is invisible until evaluation is frictionless — this is distribution, the capability exists. |
| Citation UX | Onyx/NotebookLM lead with inline `[1][2]`; our retrieval machinery is stronger but the front-door isn't | **Surface `grounding_status` + chunk provenance as inline citations** — the data already flows; promote it. |
| Verified-compute is invisible | The moat is buried in metadata | **A visible answer badge: "Computed · replay-exact · attested"** — make the proof the product surface, the way Perplexity made citations its identity. |
| Connector breadth | Onyx has 50+ auto-syncing connectors | **SHIPPED:** every connector/ingest run now emits an open, tamper-evident, *sealable* `ConnectorReceipt` (sha256 manifest hash, spec-conformant) — Onyx's audit is Enterprise-paywalled; ours is cryptographic and open. We win on *governed* ingestion, not raw count, and lean on Composio's 100+ for breadth behind it. |
| Multi-user / RBAC | Onyx/AnythingLLM have workspaces | **SHIPPED:** scoped multi-seat — each seat is a cryptographic `sovereign-id` Ed25519 scope facet bound to an `AccessProfile`, gating ingestion by collection + trust-level, deny-by-default for unknown seats, single-user unchanged. Sovereignty-keyed, not enterprise-RBAC theater. |

**We reject:** GraphRAG-style GPT-4-cost global indexing (we have the cheaper equivalents), SOC-2/SSO theater (not the sovereignty buyer), audio-overview arms race (match canon-grounded study-guides + quizzes; skip the rest).

## The bottom line

Onyx loses on *verifiable answers* (it's enterprise search, not computation) **and on governed ingestion** (its audit is paywalled; ours is open, cryptographic, and sealable per connector run). GraphRAG loses on *replay/attestation*. privateGPT's governance is *paywalled*. localGPT's verification is *the model grading itself*. NotebookLM loses on *sovereignty* (Google's cloud). Open WebUI is the most popular and the most polished — and still can't prove a single answer. **Different enemies, one undefended flank: none of them can prove an answer is correct.** That is the hill, and we already hold it. The work is making everyone see it.
